import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAutomationEvents } from "../src/automation/index.js";
import {
  AutomationEventsError,
  isAutomationEventsError,
} from "../src/automation/errors.js";
import { createDataClient } from "../src/client/index.js";
import {
  TrustedDataRoot,
  createWorkspaceDataScope,
} from "../src/scope/index.js";

const actor = { kind: "automation", id: "os-scheduler" } as const;
const authorization = { mode: "local-operator" } as const;

function workspaceScope(workspaceId = "sales") {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-automation-"));
  mkdirSync(join(rootPath, "workspaces", workspaceId, "data"), {
    recursive: true,
  });
  const root = TrustedDataRoot.fromExistingDirectory(rootPath);
  const scope = createWorkspaceDataScope(root, workspaceId);
  return {
    rootPath,
    scope,
    cleanup(): void {
      rmSync(rootPath, { recursive: true, force: true });
    },
  };
}

function automationSetup() {
  const fix = workspaceScope();
  const client = createDataClient({
    scope: fix.scope,
    actor: { ...actor },
    authorization: { ...authorization },
  });
  assert.equal(
    client.spaces.create({
      spaceId: "crm",
      name: "CRM",
      authority: "local_canonical",
    }).ok,
    true,
  );
  assert.equal(
    client.schemas.create({
      spaceId: "crm",
      entity: "deals",
      name: "Deals",
      fields: {
        title: { type: "string", required: true },
        stage: {
          type: "enum",
          values: ["lead", "proposal", "won"],
          default: "lead",
        },
      },
    }).ok,
    true,
  );
  return { fix, client };
}

test("committed events poll as facts with receipts and cursors", () => {
  const { fix, client } = automationSetup();
  try {
    const first = client.records.createWithReceipt({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "auto:deal:1",
      data: { title: "One", stage: "lead" },
    });
    assert.equal(first.ok, true);
    const second = client.records.createWithReceipt({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "auto:deal:2",
      data: { title: "Two", stage: "proposal" },
    });
    assert.equal(second.ok, true);
    const updated = client.records.updateWithReceipt({
      spaceId: "crm",
      entity: "deals",
      recordId: second.result.record.recordId,
      expectedVersion: 1,
      idempotencyKey: "auto:deal:2:won",
      patch: { stage: "won" },
    });
    assert.equal(updated.ok, true);

    const auto = createAutomationEvents(client);
    const described = auto.subscriptions.describe({
      spaceId: "crm",
      entity: "deals",
    });
    assert.equal(described.ok, true);
    assert.equal(described.result.filter.spaceId, "crm");

    const page = auto.events.poll({ spaceId: "crm", entity: "deals" });
    assert.equal(page.ok, true);
    assert.ok(page.result.envelopes.length >= 3);
    for (const envelope of page.result.envelopes) {
      assert.ok(envelope.event.eventId.length > 0);
      assert.deepEqual(envelope.scope, { workspaceId: "sales" });
      assert.ok(Date.parse(envelope.emittedAt) > 0);
    }
    const won = page.result.envelopes.find(
      (envelope) =>
        envelope.event.eventType === "record.updated" &&
        envelope.event.recordId === second.result.record.recordId,
    );
    assert.ok(won !== undefined);
    assert.ok(won.receipt !== null);

    const notice = auto.policy.notice();
    assert.equal(notice.ok, true);
    assert.equal(notice.result.rule, "no-scheduler-in-data");

    assert.equal(
      (auto as unknown as Record<string, unknown>)["scheduler"],
      undefined,
    );
    assert.equal(
      typeof (auto as unknown as Record<string, unknown>)["trigger"],
      "undefined",
    );
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("filters scope to space, entity, record, and event type", () => {
  const { fix, client } = automationSetup();
  try {
    const first = client.records.create({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "auto:filter:1",
      data: { title: "Keep", stage: "lead" },
    });
    assert.equal(first.ok, true);
    const auto = createAutomationEvents(client);

    const createdOnly = auto.events.poll({
      spaceId: "crm",
      entity: "deals",
      eventTypes: ["record.created"],
    });
    assert.equal(createdOnly.ok, true);
    assert.ok(createdOnly.result.envelopes.length >= 1);
    assert.ok(
      createdOnly.result.envelopes.every(
        (envelope) => envelope.event.eventType === "record.created",
      ),
    );

    const byRecord = auto.events.poll({
      spaceId: "crm",
      entity: "deals",
      recordId: first.result.recordId,
    });
    assert.equal(byRecord.ok, true);
    assert.ok(byRecord.result.envelopes.length >= 1);
    assert.ok(
      byRecord.result.envelopes.every(
        (envelope) => envelope.event.recordId === first.result.recordId,
      ),
    );

    const empty = auto.events.poll({
      spaceId: "crm",
      entity: "deals",
      eventTypes: ["record.deleted"],
    });
    assert.equal(empty.ok, true);
    assert.equal(empty.result.envelopes.length, 0);

    const receipt = auto.receipts.byKey("auto:filter:1");
    assert.equal(receipt.ok, true);
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("cursors page forward and replay stays duplicate-free", () => {
  const { fix, client } = automationSetup();
  try {
    for (const key of ["auto:page:1", "auto:page:2", "auto:page:3"] as const) {
      assert.equal(
        client.records.create({
          spaceId: "crm",
          entity: "deals",
          idempotencyKey: key,
          data: { title: key, stage: "lead" },
        }).ok,
        true,
      );
    }
    const auto = createAutomationEvents(client);
    const before = auto.events.poll({ spaceId: "crm" });
    assert.equal(before.ok, true);
    const countBefore = before.result.envelopes.length;
    assert.ok(countBefore >= 3);

    const replayed = client.records.create({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "auto:page:1",
      data: { title: "auto:page:1", stage: "lead" },
    });
    assert.equal(replayed.ok, true);
    const after = auto.events.poll({ spaceId: "crm" });
    assert.equal(after.ok, true);
    assert.equal(after.result.envelopes.length, countBefore);

    if (after.result.nextCursor !== null) {
      const next = auto.events.poll(
        { spaceId: "crm" },
        after.result.nextCursor,
      );
      assert.equal(next.ok, true);
    }
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("malformed filters, isolation, closed client, invalid adapter fail closed", () => {
  const { fix, client } = automationSetup();
  try {
    const auto = createAutomationEvents(client);
    assert.throws(
      () => auto.events.poll({ spaceId: "CRM" }),
      (error: unknown) => {
        assert.ok(error instanceof AutomationEventsError);
        assert.equal(error.code, "AUTOMATION_INVALID");
        return true;
      },
    );
    assert.throws(
      () =>
        auto.events.poll({
          spaceId: "crm",
          entity: "deals",
          recordId: "x",
          eventTypes: ["record.merged" as unknown as "record.created"],
        }),
      (error: unknown) => isAutomationEventsError(error),
    );
    assert.throws(
      () => auto.events.poll({ entity: "deals", recordId: "x" }),
      (error: unknown) => isAutomationEventsError(error),
    );
    assert.throws(
      () =>
        createAutomationEvents(
          null as unknown as ReturnType<typeof createDataClient>,
        ),
      (error: unknown) => {
        assert.ok(error instanceof AutomationEventsError);
        return true;
      },
    );

    client.close();
    assert.equal(auto.closed, true);
    assert.throws(
      () => auto.events.poll({ spaceId: "crm" }),
      (error: unknown) => {
        assert.ok(error instanceof AutomationEventsError);
        assert.equal(error.code, "AUTOMATION_CLOSED");
        return true;
      },
    );
  } finally {
    fix.cleanup();
  }

  const second = workspaceScope("support");
  const secondClient = createDataClient({
    scope: second.scope,
    actor: { ...actor },
    authorization: { ...authorization },
  });
  try {
    const secondAuto = createAutomationEvents(secondClient);
    const empty = secondAuto.events.poll({ spaceId: "crm" });
    assert.equal(empty.ok, true);
    assert.equal(empty.result.envelopes.length, 0);
  } finally {
    secondClient.close();
    second.cleanup();
  }
});
