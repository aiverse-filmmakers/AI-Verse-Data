import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createBrainDataAdapter } from "../src/brain/index.js";
import {
  BrainDataAdapterError,
  isBrainDataAdapterError,
} from "../src/brain/errors.js";
import { createDataClient } from "../src/client/index.js";
import {
  TrustedDataRoot,
  createWorkspaceDataScope,
} from "../src/scope/index.js";

const actor = { kind: "bot", id: "brain-reader" } as const;
const authorization = {
  mode: "host-bound",
  capabilityRefs: ["data:crm:deals:read"],
} as const;

function workspaceScope(workspaceId = "sales") {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-brain-"));
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

function brainSetup() {
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
      entity: "companies",
      name: "Companies",
      fields: { name: { type: "string", required: true } },
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
        value: { type: "number", min: 0, default: 0 },
        stage: {
          type: "enum",
          values: ["lead", "proposal", "won"],
          default: "lead",
        },
        company: { type: "reference", entity: "companies", required: true },
      },
    }).ok,
    true,
  );
  return { fix, client };
}

test("bounded query plus aggregates answer with provenance and no goal copy", () => {
  const { fix, client } = brainSetup();
  try {
    const company = client.records.create({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "brain:company:1",
      data: { name: "Acme" },
    });
    assert.equal(company.ok, true);
    for (const [key, value, stage] of [
      ["brain:deal:1", 40, "proposal"],
      ["brain:deal:2", 60, "won"],
      ["brain:deal:3", 42, "proposal"],
    ] as const) {
      const created = client.records.create({
        spaceId: "crm",
        entity: "deals",
        idempotencyKey: key,
        data: {
          title: `Deal ${key}`,
          value,
          stage,
          company: company.result.recordId,
        },
      });
      assert.equal(created.ok, true);
    }

    const brain = createBrainDataAdapter(client);
    const answer = brain.query.ask({
      spaceId: "crm",
      entity: "deals",
      where: { field: "stage", op: "eq", value: "proposal" },
      orderBy: [{ field: "value", direction: "desc" }],
      limit: 10,
    });
    assert.equal(answer.ok, true);
    assert.equal(answer.result.page.items.length, 2);
    assert.equal(answer.result.provenance.recordCount, 2);
    assert.deepEqual(answer.result.provenance.scope, {
      workspaceId: "sales",
    });
    assert.deepEqual(answer.result.provenance.actor, {
      kind: "bot",
      id: "brain-reader",
    });
    assert.ok(Date.parse(answer.result.provenance.answeredAt) > 0);
    assert.ok(
      !("objective" in answer.result.page) &&
        !("goal" in answer.result.page),
    );

    const summary = brain.query.summarize({
      spaceId: "crm",
      entity: "deals",
      where: { field: "stage", op: "eq", value: "proposal" },
      metrics: [
        { op: "count", as: "openCount" },
        { op: "sum", field: "value", as: "openValue" },
      ],
    });
    assert.equal(summary.ok, true);
    assert.equal(summary.result.values["openCount"], 2);
    assert.equal(summary.result.values["openValue"], 82);

    const listed = brain.records.list({
      spaceId: "crm",
      entity: "deals",
      limit: 50,
    });
    assert.equal(listed.ok, true);
    assert.equal(listed.result.records.length, 3);
    assert.equal(listed.result.provenance.recordCount, 3);

    const one = brain.records.get({
      spaceId: "crm",
      entity: "deals",
      recordId: listed.result.records[0]!.recordId,
    });
    assert.equal(one.ok, true);
    assert.equal(one.result.provenance.recordCount, 1);
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("spaces, schemas, events, receipts, and health stay read-only with provenance", () => {
  const { fix, client } = brainSetup();
  try {
    const company = client.records.create({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "brain:company:ro",
      data: { name: "ReadOnly Co" },
    });
    assert.equal(company.ok, true);
    const deal = client.records.createWithReceipt({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "brain:deal:ro",
      data: {
        title: "Readable deal",
        value: 10,
        stage: "lead",
        company: company.result.recordId,
      },
    });
    assert.equal(deal.ok, true);
    const hidden = client.records.createWithReceipt({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "brain:company:hidden",
      data: { name: "Hidden Co" },
    });
    assert.equal(hidden.ok, true);
    const brain = createBrainDataAdapter(client);

    const spaces = brain.spaces.list();
    assert.equal(spaces.ok, true);
    assert.equal(spaces.result.length, 1);
    const summarized = brain.spaces.summarize({ spaceId: "crm" });
    assert.equal(summarized.ok, true);
    assert.equal(summarized.result.schemaCount, 1);

    const schemas = brain.schemas.list({ spaceId: "crm" });
    assert.equal(schemas.ok, true);
    assert.equal(schemas.result.length, 1);
    assert.equal(schemas.result[0]?.entity, "deals");
    const entity = brain.schemas.summarize({
      spaceId: "crm",
      entity: "deals",
    });
    assert.equal(entity.ok, true);
    assert.equal(entity.result.currentVersion, 1);
    assert.ok(entity.result.summary.fieldCount >= 4);

    const events = brain.provenance.listEvents({ spaceId: "crm" });
    assert.equal(events.ok, true);
    assert.ok(events.result.page.items.length >= 1);
    assert.ok(events.result.provenance.recordCount >= 1);

    const receipt = brain.provenance.getReceiptByIdempotencyKey(
      "brain:deal:ro",
    );
    assert.equal(receipt.ok, true);
    assert.equal(
      receipt.result.receipt.recordId,
      deal.result.record.recordId,
    );
    const byId = brain.provenance.getReceipt(
      receipt.result.receipt.receiptId,
    );
    assert.equal(byId.ok, true);

    assert.throws(
      () => brain.provenance.getReceipt(hidden.result.receipt.receiptId),
      (error: unknown) => {
        assert.ok(isBrainDataAdapterError(error));
        assert.equal(
          (error as BrainDataAdapterError).code,
          "BRAIN_PERMISSION_DENIED",
        );
        return true;
      },
    );
    assert.throws(
      () =>
        brain.schemas.get({
          spaceId: "crm",
          entity: "companies",
        }),
      (error: unknown) => {
        assert.ok(isBrainDataAdapterError(error));
        assert.equal(
          (error as BrainDataAdapterError).code,
          "BRAIN_PERMISSION_DENIED",
        );
        return true;
      },
    );

    const facts = brain.health.diagnostics();
    assert.equal(facts.ok, true);
    assert.ok(facts.result.sqliteVersion.length > 0);
    const migration = brain.health.migrationStatus();
    assert.equal(migration.ok, true);
    assert.equal(migration.result.state, "current");
    assert.equal(brain.health.metadata().workspaceId, "sales");

    assert.equal(
      (brain as unknown as Record<string, unknown>)["recordsCreate"],
      undefined,
    );
    assert.equal(
      typeof (brain.records as unknown as Record<string, unknown>)["create"],
      "undefined",
    );
    assert.equal(
      typeof (brain as unknown as Record<string, unknown>)["transactions"],
      "undefined",
    );
    assert.equal(
      typeof (brain as unknown as Record<string, unknown>)["bulk"],
      "undefined",
    );
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("query ceilings fail closed and errors stay stable", () => {
  const { fix, client } = brainSetup();
  try {
    const brain = createBrainDataAdapter(client);
    assert.throws(
      () =>
        brain.query.ask({
          spaceId: "crm",
          entity: "deals",
          limit: 500,
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        return true;
      },
    );
    assert.throws(
      () =>
        brain.records.list({
          spaceId: "crm",
          entity: "nope",
          limit: 10,
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        return true;
      },
    );
    assert.throws(
      () =>
        // @ts-expect-error mutations are not exposed on the read-only surface
        brain.records.create({
          spaceId: "crm",
          entity: "deals",
          idempotencyKey: "brain:denied",
          data: {},
        }),
      (error: unknown) => error instanceof TypeError,
    );
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("isolation, closed client, and invalid adapter fail closed", () => {
  const { fix, client } = brainSetup();
  const otherPath = fix.rootPath;
  void otherPath;
  try {
    const brain = createBrainDataAdapter(client);
    client.close();
    assert.equal(brain.closed, true);
    assert.throws(
      () => brain.records.list({ spaceId: "crm", entity: "deals" }),
      (error: unknown) => {
        assert.ok(isBrainDataAdapterError(error));
        assert.equal(
          (error as BrainDataAdapterError).code,
          "BRAIN_CLOSED",
        );
        return true;
      },
    );
    assert.throws(
      () =>
        createBrainDataAdapter(
          // @ts-expect-error null clients are never accepted
          null,
        ),
      (error: unknown) => {
        assert.ok(error instanceof BrainDataAdapterError);
        assert.equal(error.code, "BRAIN_INVALID");
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
    const secondBrain = createBrainDataAdapter(secondClient);
    assert.throws(
      () => secondBrain.spaces.get({ spaceId: "crm" }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        return true;
      },
    );
  } finally {
    secondClient.close();
    second.cleanup();
  }
});
