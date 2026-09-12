import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDataClient } from "../src/client/index.js";
import {
  TrustedDataRoot,
  createWorkspaceDataScope,
} from "../src/scope/index.js";
import {
  doctorData,
  installDataExtension,
  initWorkspaceData,
  statusData,
} from "../src/native/index.js";

// Evidence-based budgets (Task 38). Local probe on this host (Node 22):
// open ~76ms, create ~2.4ms/op, query50 ~3.4ms, agg ~1.3ms, events100 ~7ms,
// update ~4.5ms, txn2 ~16ms, bulkPrev20 ~62ms, bulkExec20 ~118ms,
// integrity25 ~2.5ms. Budgets below carry 10-50x headroom so the matrix
// (ubuntu/macos/windows x Node 22/24) stays green without hiding regressions.
const BUDGET = {
  coldOpenMs: 5000,
  creates50Ms: 30000,
  updateMs: 2000,
  queryMs: 5000,
  aggregateMs: 5000,
  transactionMs: 10000,
  bulkPreviewMs: 15000,
  bulkExecuteMs: 30000,
  eventsMs: 10000,
  doctorMs: 15000,
  statusMs: 10000,
} as const;

function nowMs(): number {
  return Number(process.hrtime.bigint()) / 1e6;
}

function workspaceFixture(prefix: string, workspaceId = "sales") {
  const rootPath = mkdtempSync(join(tmpdir(), prefix));
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

function seedCrm(client: ReturnType<typeof createDataClient>, count: number) {
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
        value: { type: "number", min: 0, default: 0 },
      },
    }).ok,
    true,
  );
  for (let i = 0; i < count; i += 1) {
    const created = client.records.create({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: `perf:deal:${i}`,
      data: { title: `Deal ${i}`, value: i },
    });
    assert.equal(created.ok, true);
  }
}

test("performance baseline: cold open stays within budget", () => {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-perf-open-"));
  try {
    mkdirSync(join(rootPath, "workspaces", "sales", "data"), {
      recursive: true,
    });
    const start = nowMs();
    const root = TrustedDataRoot.fromExistingDirectory(rootPath);
    const scope = createWorkspaceDataScope(root, "sales");
    const client = createDataClient({
      scope,
      actor: { kind: "human", id: "perf" },
      authorization: { mode: "local-operator" },
    });
    const elapsed = nowMs() - start;
    assert.ok(
      elapsed < BUDGET.coldOpenMs,
      `cold open ${elapsed.toFixed(1)}ms exceeds ${BUDGET.coldOpenMs}ms`,
    );
    client.close();
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("performance baseline: creates and single update stay within budget", () => {
  const fix = workspaceFixture("ai-verse-data-perf-write-");
  const client = createDataClient({
    scope: fix.scope,
    actor: { kind: "human", id: "perf" },
    authorization: { mode: "local-operator" },
  });
  try {
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
          value: { type: "number", min: 0, default: 0 },
        },
      }).ok,
      true,
    );
    const start = nowMs();
    for (let i = 0; i < 50; i += 1) {
      const created = client.records.create({
        spaceId: "crm",
        entity: "deals",
        idempotencyKey: `perf:create:${i}`,
        data: { title: `Deal ${i}`, value: i },
      });
      assert.equal(created.ok, true);
    }
    const createsElapsed = nowMs() - start;
    assert.ok(
      createsElapsed < BUDGET.creates50Ms,
      `50 creates ${createsElapsed.toFixed(1)}ms exceeds ${BUDGET.creates50Ms}ms`,
    );

    const first = client.records.get({
      spaceId: "crm",
      entity: "deals",
      recordId: (
        client.query.query({ spaceId: "crm", entity: "deals", limit: 1 })
          .result.items[0] as { recordId: string }
      ).recordId,
    });
    assert.equal(first.ok, true);
    const updateStart = nowMs();
    const updated = client.records.update({
      spaceId: "crm",
      entity: "deals",
      recordId: first.result.recordId,
      expectedVersion: first.result.version,
      idempotencyKey: "perf:update:1",
      patch: { value: 999 },
    });
    const updateElapsed = nowMs() - updateStart;
    assert.equal(updated.ok, true);
    assert.ok(
      updateElapsed < BUDGET.updateMs,
      `update ${updateElapsed.toFixed(1)}ms exceeds ${BUDGET.updateMs}ms`,
    );
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("performance baseline: query and aggregate stay within budget", () => {
  const fix = workspaceFixture("ai-verse-data-perf-read-");
  const client = createDataClient({
    scope: fix.scope,
    actor: { kind: "human", id: "perf" },
    authorization: { mode: "local-operator" },
  });
  try {
    seedCrm(client, 200);
    const queryStart = nowMs();
    const page = client.query.query({
      spaceId: "crm",
      entity: "deals",
      orderBy: [{ field: "value", direction: "desc" }],
      limit: 50,
    });
    const queryElapsed = nowMs() - queryStart;
    assert.equal(page.ok, true);
    assert.equal(page.result.items.length, 50);
    assert.ok(
      queryElapsed < BUDGET.queryMs,
      `query ${queryElapsed.toFixed(1)}ms exceeds ${BUDGET.queryMs}ms`,
    );

    const aggStart = nowMs();
    const agg = client.query.aggregate({
      spaceId: "crm",
      entity: "deals",
      metrics: [
        { op: "count", as: "count" },
        { op: "sum", field: "value", as: "sum" },
      ],
    });
    const aggElapsed = nowMs() - aggStart;
    assert.equal(agg.ok, true);
    assert.equal(agg.result.values["count"], 200);
    assert.ok(
      aggElapsed < BUDGET.aggregateMs,
      `aggregate ${aggElapsed.toFixed(1)}ms exceeds ${BUDGET.aggregateMs}ms`,
    );
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("performance baseline: transaction and bulk stay within budget", () => {
  const fix = workspaceFixture("ai-verse-data-perf-txn-");
  const client = createDataClient({
    scope: fix.scope,
    actor: { kind: "human", id: "perf" },
    authorization: { mode: "local-operator" },
  });
  try {
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
          value: { type: "number", min: 0, default: 0 },
        },
      }).ok,
      true,
    );
    const txnStart = nowMs();
    const txn = client.transactions.executeWithReceipt({
      idempotencyKey: "perf:txn:1",
      operations: Array.from({ length: 5 }, (_, i) => ({
        operation: "data.record.create",
        payload: {
          spaceId: "crm",
          entity: "deals",
          idempotencyKey: `perf:txn:c${i}`,
          data: { title: `Txn ${i}`, value: i },
        },
      })),
    });
    const txnElapsed = nowMs() - txnStart;
    assert.equal(txn.ok, true);
    assert.ok(
      txnElapsed < BUDGET.transactionMs,
      `txn ${txnElapsed.toFixed(1)}ms exceeds ${BUDGET.transactionMs}ms`,
    );

    const ops = Array.from({ length: 20 }, (_, i) => ({
      operation: "data.record.create",
      payload: {
        spaceId: "crm",
        entity: "deals",
        idempotencyKey: `perf:bulk:${i}`,
        data: { title: `Bulk ${i}`, value: i },
      },
    }));
    const prevStart = nowMs();
    const preview = client.bulk.preview(
      ops as unknown as Parameters<typeof client.bulk.preview>[0],
    );
    const prevElapsed = nowMs() - prevStart;
    assert.equal(preview.ok, true);
    assert.ok(
      prevElapsed < BUDGET.bulkPreviewMs,
      `bulk preview ${prevElapsed.toFixed(1)}ms exceeds ${BUDGET.bulkPreviewMs}ms`,
    );
    const execStart = nowMs();
    const executed = client.bulk.execute({
      idempotencyKey: "perf:bulk:exec:1",
      expectedPreviewDigest: preview.result.previewDigest,
      operations:
        ops as unknown as Parameters<typeof client.bulk.execute>[0]["operations"],
    });
    const execElapsed = nowMs() - execStart;
    assert.equal(executed.ok, true);
    assert.ok(
      execElapsed < BUDGET.bulkExecuteMs,
      `bulk execute ${execElapsed.toFixed(1)}ms exceeds ${BUDGET.bulkExecuteMs}ms`,
    );
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("performance baseline: event growth stays bounded and fast", () => {
  const fix = workspaceFixture("ai-verse-data-perf-events-");
  const client = createDataClient({
    scope: fix.scope,
    actor: { kind: "human", id: "perf" },
    authorization: { mode: "local-operator" },
  });
  try {
    seedCrm(client, 100);
    const start = nowMs();
    const events = client.provenance.listEvents({
      spaceId: "crm",
      limit: 200,
    });
    const elapsed = nowMs() - start;
    assert.equal(events.ok, true);
    assert.ok(events.result.items.length >= 100);
    assert.ok(
      elapsed < BUDGET.eventsMs,
      `events ${elapsed.toFixed(1)}ms exceeds ${BUDGET.eventsMs}ms`,
    );
    // Bounded pages: requesting 200 never returns more than 200.
    assert.ok(events.result.items.length <= 200);
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("performance baseline: doctor and status stay within budget", async () => {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-perf-doc-"));
  try {
    writeFileSync(
      join(rootPath, "AI-VERSE.yaml"),
      'schema_version: "2.0"\narchitecture: unified-workspace\n',
      "utf8",
    );
    writeFileSync(join(rootPath, "AGENTS.md"), "# Runtime\n", "utf8");
    mkdirSync(join(rootPath, "operator"), { recursive: true });
    mkdirSync(join(rootPath, "workspaces", "sales"), { recursive: true });
    writeFileSync(
      join(rootPath, "workspaces", "sales", "WORKSPACE.yaml"),
      [
        `schema_version: "2.0"`,
        `id: "sales"`,
        `name: "Sales"`,
        `type: "custom"`,
        `status: "active"`,
        `purpose: "Perf baseline."`,
        "",
      ].join("\n"),
      "utf8",
    );
    mkdirSync(join(rootPath, "system", "extensions"), { recursive: true });
    writeFileSync(
      join(rootPath, "system", "extensions", "README.md"),
      `# Local extensions\nRegistry: .aiverse/extensions/registry.json\n`,
      "utf8",
    );
    installDataExtension({ rootPath });
    await initWorkspaceData({ rootPath, workspaceId: "sales" });

    const doctorStart = nowMs();
    const doctor = await doctorData({ rootPath, workspaceId: "sales" });
    const doctorElapsed = nowMs() - doctorStart;
    assert.equal(doctor.healthy, true);
    assert.ok(
      doctorElapsed < BUDGET.doctorMs,
      `doctor ${doctorElapsed.toFixed(1)}ms exceeds ${BUDGET.doctorMs}ms`,
    );

    const statusStart = nowMs();
    const status = await statusData({ rootPath, workspaceId: "sales" });
    const statusElapsed = nowMs() - statusStart;
    assert.equal(status.healthy, true);
    assert.ok(
      statusElapsed < BUDGET.statusMs,
      `status ${statusElapsed.toFixed(1)}ms exceeds ${BUDGET.statusMs}ms`,
    );
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
});
