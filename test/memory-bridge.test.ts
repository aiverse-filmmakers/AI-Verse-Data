import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDataClient } from "../src/client/index.js";
import { createMemoryBridge } from "../src/memory/index.js";
import {
  MemoryBridgeError,
  isMemoryBridgeError,
} from "../src/memory/errors.js";
import {
  TrustedDataRoot,
  createWorkspaceDataScope,
} from "../src/scope/index.js";

const actor = { kind: "human", id: "memory-proposer" } as const;
const authorization = { mode: "local-operator" } as const;

function workspaceScope(workspaceId = "sales") {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-memory-"));
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

function memorySetup() {
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

test("stable references round-trip and evidence re-opens live records", () => {
  const { fix, client } = memorySetup();
  try {
    const company = client.records.createWithReceipt({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "memory:company:1",
      data: { name: "Acme" },
    });
    assert.equal(company.ok, true);
    const deal = client.records.createWithReceipt({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "memory:deal:1",
      data: {
        title: "Big deal",
        value: 18000,
        stage: "proposal",
        company: company.result.record.recordId,
      },
    });
    assert.equal(deal.ok, true);

    const bridge = createMemoryBridge(client);
    const reference = bridge.references.forRecord({
      spaceId: "crm",
      entity: "deals",
      recordId: deal.result.record.recordId,
      recordVersion: deal.result.record.version,
      eventId: deal.result.receipt.eventId,
      receiptId: deal.result.receipt.receiptId,
    });
    assert.equal(reference.sourceType, "ai-verse-data");
    assert.equal(reference.workspaceId, "sales");
    assert.ok(reference.uri.startsWith("data://sales/crm/deals/"));
    assert.ok(reference.uri.includes(`@${deal.result.record.version}`));

    const parsed = bridge.references.parse(reference.uri);
    assert.deepEqual(parsed, reference);

    const evidence = bridge.evidence.lookupRecord({
      spaceId: "crm",
      entity: "deals",
      recordId: deal.result.record.recordId,
      includeReceipt: true,
      idempotencyKey: "memory:deal:1",
      eventId: deal.result.receipt.eventId,
      receiptId: deal.result.receipt.receiptId,
    });
    assert.equal(evidence.ok, true);
    assert.equal(
      evidence.result.record.recordId,
      deal.result.record.recordId,
    );
    assert.equal(evidence.result.reference.workspaceId, "sales");
    assert.ok(evidence.result.receipt !== null);

    const otherDeal = client.records.createWithReceipt({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "memory:deal:other-receipt",
      data: {
        title: "Other deal",
        value: 19000,
        stage: "proposal",
        company: company.result.record.recordId,
      },
    });
    assert.equal(otherDeal.ok, true);
    assert.throws(
      () =>
        bridge.evidence.lookupRecord({
          spaceId: "crm",
          entity: "deals",
          recordId: deal.result.record.recordId,
          includeReceipt: true,
          receiptId: otherDeal.result.receipt.receiptId,
        }),
      (error: unknown) => {
        assert.ok(isMemoryBridgeError(error));
        assert.equal((error as MemoryBridgeError).code, "MEMORY_INVALID");
        return true;
      },
    );
    assert.throws(
      () =>
        bridge.evidence.lookupRecord({
          spaceId: "crm",
          entity: "deals",
          recordId: deal.result.record.recordId,
          includeReceipt: true,
          idempotencyKey: "memory:deal:other-receipt",
        }),
      (error: unknown) => isMemoryBridgeError(error),
    );

    const byRef = bridge.evidence.lookupByReference(reference.uri);
    assert.equal(byRef.ok, true);
    assert.ok("record" in byRef.result);

    assert.equal(
      (bridge as unknown as Record<string, unknown>)["writeMemory"],
      undefined,
    );
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("event evidence resolves by event, receipt, and idempotency key", () => {
  const { fix, client } = memorySetup();
  try {
    const company = client.records.create({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "memory:company:evt",
      data: { name: "Evt Co" },
    });
    assert.equal(company.ok, true);
    const deal = client.records.createWithReceipt({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "memory:deal:evt",
      data: {
        title: "Evt deal",
        value: 5000,
        stage: "won",
        company: company.result.recordId,
      },
    });
    assert.equal(deal.ok, true);

    const bridge = createMemoryBridge(client);
    const byEvent = bridge.evidence.lookupEvent({
      eventId: deal.result.receipt.eventId,
    });
    assert.equal(byEvent.ok, true);
    assert.equal(byEvent.result.event.eventId, deal.result.receipt.eventId);

    const byReceipt = bridge.evidence.lookupEvent({
      receiptId: deal.result.receipt.receiptId,
    });
    assert.equal(byReceipt.ok, true);
    assert.equal(
      byReceipt.result.event.eventId,
      deal.result.receipt.eventId,
    );

    const byKey = bridge.evidence.lookupEvent({
      idempotencyKey: "memory:deal:evt",
    });
    assert.equal(byKey.ok, true);
    assert.equal(byKey.result.event.eventId, deal.result.receipt.eventId);

    assert.throws(
      () => bridge.evidence.lookupEvent({}),
      (error: unknown) => {
        assert.ok(isMemoryBridgeError(error));
        assert.equal((error as MemoryBridgeError).code, "MEMORY_INVALID");
        return true;
      },
    );
    assert.throws(
      () =>
        bridge.evidence.lookupEvent({
          eventId: deal.result.receipt.eventId,
          receiptId: deal.result.receipt.receiptId,
        }),
      (error: unknown) => isMemoryBridgeError(error),
    );
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("candidates propose without writing Memory and carry provenance", () => {
  const { fix, client } = memorySetup();
  try {
    const company = client.records.create({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "memory:company:cand",
      data: { name: "Cand Co" },
    });
    assert.equal(company.ok, true);
    const deal = client.records.createWithReceipt({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "memory:deal:cand",
      data: {
        title: "Blocked deal",
        value: 9000,
        stage: "proposal",
        company: company.result.recordId,
      },
    });
    assert.equal(deal.ok, true);

    const bridge = createMemoryBridge(client);
    const recordCandidate = bridge.candidates.proposeRecordCandidate({
      spaceId: "crm",
      entity: "deals",
      recordId: deal.result.record.recordId,
      title: "Deal stalled in proposal",
      summary: "Enterprise deal remained in proposal; legal review suspected.",
    });
    assert.equal(recordCandidate.ok, true);
    assert.equal(recordCandidate.result.kind, "record_reference");
    assert.equal(recordCandidate.result.reference.recordId, deal.result.record.recordId);
    assert.equal(recordCandidate.result.recordCount, 1);
    assert.deepEqual(recordCandidate.result.scope, { workspaceId: "sales" });
    assert.ok(Date.parse(recordCandidate.result.proposedAt) > 0);
    assert.equal(recordCandidate.result.expiresAt, null);

    const eventCandidate = bridge.candidates.proposeEventCandidate({
      eventId: deal.result.receipt.eventId,
      title: "Deal won transition",
      summary: "Won event with future value for win-rate recall.",
    });
    assert.equal(eventCandidate.ok, true);
    assert.equal(eventCandidate.result.kind, "event_reference");
    assert.equal(
      eventCandidate.result.reference.eventId,
      deal.result.receipt.eventId,
    );

    const aggregateCandidate = bridge.candidates.proposeAggregateCandidate({
      query: { spaceId: "crm", entity: "deals", limit: 10 },
      aggregate: {
        spaceId: "crm",
        entity: "deals",
        metrics: [
          { op: "count", as: "openCount" },
          { op: "sum", field: "value", as: "openValue" },
        ],
      },
      title: "Pipeline snapshot",
      summary: "Current open pipeline for historical comparison.",
    });
    assert.equal(aggregateCandidate.ok, true);
    assert.equal(aggregateCandidate.result.kind, "aggregate_summary");
    assert.ok(aggregateCandidate.result.recordCount >= 1);

    const eventsBefore = client.provenance.listEvents({ spaceId: "crm" });
    assert.equal(eventsBefore.ok, true);
    const countBefore = eventsBefore.result.items.length;
    bridge.candidates.proposeRecordCandidate({
      spaceId: "crm",
      entity: "deals",
      recordId: deal.result.record.recordId,
      title: "Second proposal",
      summary: "Proposing again must not write Memory or Data events.",
    });
    const eventsAfter = client.provenance.listEvents({ spaceId: "crm" });
    assert.equal(eventsAfter.ok, true);
    assert.equal(eventsAfter.result.items.length, countBefore);
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("malformed references, cross-workspace, and closed client fail closed", () => {
  const { fix, client } = memorySetup();
  try {
    const bridge = createMemoryBridge(client);
    assert.throws(
      () => bridge.references.parse("memory://sales/crm/deals/x"),
      (error: unknown) => {
        assert.ok(error instanceof MemoryBridgeError);
        assert.equal(error.code, "MEMORY_INVALID");
        return true;
      },
    );
    assert.throws(
      () => bridge.references.parse("data://sales/crm/deals/"),
      (error: unknown) => isMemoryBridgeError(error),
    );
    assert.throws(
      () =>
        bridge.evidence.lookupByReference("data://support/crm/deals/abc@1"),
      (error: unknown) => isMemoryBridgeError(error),
    );
    assert.throws(
      () =>
        bridge.candidates.proposeRecordCandidate({
          spaceId: "crm",
          entity: "deals",
          recordId: "missing",
          title: "Missing",
          summary: "Missing records fail closed without a candidate.",
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        return true;
      },
    );
    assert.throws(
      () => createMemoryBridge(null as unknown as ReturnType<typeof createDataClient>),
      (error: unknown) => {
        assert.ok(error instanceof MemoryBridgeError);
        return true;
      },
    );

    client.close();
    assert.equal(bridge.closed, true);
    assert.throws(
      () =>
        bridge.evidence.lookupRecord({
          spaceId: "crm",
          entity: "deals",
          recordId: "whatever",
        }),
      (error: unknown) => {
        assert.ok(error instanceof MemoryBridgeError);
        assert.equal(error.code, "MEMORY_CLOSED");
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
    const secondBridge = createMemoryBridge(secondClient);
    assert.throws(
      () =>
        secondBridge.evidence.lookupRecord({
          spaceId: "crm",
          entity: "deals",
          recordId: "whatever",
        }),
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
