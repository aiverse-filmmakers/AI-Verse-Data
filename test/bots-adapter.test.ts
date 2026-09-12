import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createBotsDataAdapter } from "../src/bots/index.js";
import {
  BotsDataAdapterError,
  isBotsDataAdapterError,
} from "../src/bots/errors.js";
import type { BotsDataCapabilityLease } from "../src/bots/errors.js";
import { createDataClient } from "../src/client/index.js";
import {
  TrustedDataRoot,
  createWorkspaceDataScope,
} from "../src/scope/index.js";

const botActor = { kind: "bot", id: "sales-lead" } as const;
const workerActor = { kind: "worker", id: "worker-1" } as const;

const FULL_CAPS = [
  "data:crm:companies:read",
  "data:crm:companies:create",
  "data:crm:companies:update",
  "data:crm:deals:read",
  "data:crm:deals:create",
  "data:crm:deals:update",
  "data:crm:deals:delete",
];

function workspaceScope(workspaceId = "sales") {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-bots-"));
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

function botClient(
  scope: ReturnType<typeof createWorkspaceDataScope>,
  caps: readonly string[] = FULL_CAPS,
) {
  return createDataClient({
    scope,
    actor: { ...botActor },
    authorization: { mode: "host-bound", capabilityRefs: [...caps] },
  });
}

function lease(
  overrides: Partial<BotsDataCapabilityLease> = {},
): BotsDataCapabilityLease {
  return {
    workspaceId: "sales",
    principal: { kind: "bot", id: "sales-lead" },
    taskId: "task-1",
    capabilities: [...FULL_CAPS],
    ...overrides,
  };
}

function bootstrap(client: ReturnType<typeof createDataClient>) {
  const space = client.spaces.create({
    spaceId: "crm",
    name: "CRM",
    authority: "local_canonical",
  });
  assert.equal(space.ok, true);
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
}

test("allowed lease operations succeed with task-linked receipts and bot provenance", () => {
  const fix = workspaceScope();
  const client = botClient(fix.scope);
  try {
    bootstrap(client);
    const adapter = createBotsDataAdapter(client, lease());
    const company = adapter.records.createWithReceipt({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "bots:company:1",
      data: { name: "Acme" },
    });
    assert.equal(company.ok, true);
    assert.equal(company.result.receipt.taskId, "task-1");
    assert.deepEqual(company.result.receipt.principal, {
      kind: "bot",
      id: "sales-lead",
    });
    assert.ok(company.result.receipt.receipt.receiptId.startsWith("rcpt_"));
    assert.equal(company.result.receipt.receipt.actor.kind, "bot");
    assert.equal(company.result.receipt.receipt.actor.id, "sales-lead");

    const fetched = adapter.records.get({
      spaceId: "crm",
      entity: "companies",
      recordId: company.result.record.recordId,
    });
    assert.equal(fetched.ok, true);

    const page = adapter.query.query({
      spaceId: "crm",
      entity: "companies",
      limit: 10,
    });
    assert.equal(page.ok, true);
    assert.equal(page.result.items.length, 1);

    const replay = adapter.records.createWithReceipt({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "bots:company:1",
      data: { name: "Acme" },
    });
    assert.equal(replay.ok, true);
    assert.deepEqual(
      replay.result.record.recordId,
      company.result.record.recordId,
    );
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("adapter closed state tracks the underlying client after secure wrapping", () => {
  const fix = workspaceScope();
  const client = botClient(fix.scope);
  try {
    bootstrap(client);
    const adapter = createBotsDataAdapter(client, lease());
    assert.equal(adapter.closed, false);
    client.close();
    assert.equal(adapter.closed, true);
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("read-only lease denies writes and wrong-entity access", () => {
  const fix = workspaceScope();
  const readCaps = ["data:crm:deals:read"] as const;
  const client = createDataClient({
    scope: fix.scope,
    actor: { ...botActor },
    authorization: { mode: "host-bound", capabilityRefs: [...readCaps] },
  });
  try {
    bootstrap(client);
    const seeded = client.records.create({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "bots:seed:company",
      data: { name: "Seed" },
    });
    assert.equal(seeded.ok, true);
    const adapter = createBotsDataAdapter(client, lease({
      capabilities: [...readCaps],
    }));
    assert.throws(
      () =>
        adapter.records.create({
          spaceId: "crm",
          entity: "deals",
          idempotencyKey: "bots:denied:create",
          data: {
            title: "No",
            value: 1,
            stage: "lead",
            company: seeded.result.recordId,
          },
        }),
      (error: unknown) => {
        assert.ok(isBotsDataAdapterError(error));
        assert.equal(
          (error as BotsDataAdapterError).code,
          "CAPABILITY_DENIED",
        );
        return true;
      },
    );
    assert.throws(
      () =>
        adapter.records.get({
          spaceId: "crm",
          entity: "companies",
          recordId: seeded.result.recordId,
        }),
      (error: unknown) => isBotsDataAdapterError(error),
    );
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("wrong task binding, expiry, and workspace mismatch fail closed", () => {
  const fix = workspaceScope();
  const client = botClient(fix.scope);
  try {
    bootstrap(client);
    const adapter = createBotsDataAdapter(client, lease());
    const company = adapter.records.create({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "bots:expire:seed",
      data: { name: "Seed" },
    });
    assert.equal(company.ok, true);

    const expiredLease = lease({
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const expired = createBotsDataAdapter(client, expiredLease);
    assert.throws(
      () =>
        expired.records.get({
          spaceId: "crm",
          entity: "companies",
          recordId: company.result.recordId,
        }),
      (error: unknown) => {
        assert.ok(isBotsDataAdapterError(error));
        assert.equal((error as BotsDataAdapterError).code, "LEASE_EXPIRED");
        return true;
      },
    );

    assert.throws(
      () => createBotsDataAdapter(client, lease({ workspaceId: "support" })),
      (error: unknown) => {
        assert.ok(isBotsDataAdapterError(error));
        assert.equal(
          (error as BotsDataAdapterError).code,
          "LEASE_WORKSPACE_MISMATCH",
        );
        return true;
      },
    );

    assert.throws(
      () =>
        createBotsDataAdapter(
          client,
          lease({ principal: { kind: "worker", id: "worker-1" } }),
        ),
      (error: unknown) => {
        assert.ok(isBotsDataAdapterError(error));
        assert.equal(
          (error as BotsDataAdapterError).code,
          "PRINCIPAL_MISMATCH",
        );
        return true;
      },
    );
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("model-written capability strings never grant access", () => {
  const fix = workspaceScope();
  const client = botClient(fix.scope, ["data:crm:deals:read"]);
  try {
    bootstrap(client);
    assert.throws(
      () =>
        createBotsDataAdapter(
          client,
          lease({ capabilities: ["data:crm:deals:create"] }),
        ),
      (error: unknown) => {
        assert.ok(isBotsDataAdapterError(error));
        assert.equal(
          (error as BotsDataAdapterError).code,
          "CAPABILITY_DENIED",
        );
        return true;
      },
    );
    assert.throws(
      () =>
        createBotsDataAdapter(
          client,
          lease({ capabilities: ["data:crm:deals:escalate"] }),
        ),
      (error: unknown) => {
        assert.ok(isBotsDataAdapterError(error));
        assert.equal((error as BotsDataAdapterError).code, "LEASE_INVALID");
        return true;
      },
    );
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("worker provenance, transactions, bulk, and artifact refs stay linked", () => {
  const fix = workspaceScope();
  const workerCaps = [
    "data:crm:companies:read",
    "data:crm:companies:create",
    "data:crm:deals:read",
    "data:crm:deals:create",
  ];
  const workerClient = createDataClient({
    scope: fix.scope,
    actor: { ...workerActor },
    authorization: { mode: "host-bound", capabilityRefs: [...workerCaps] },
  });
  try {
    bootstrap(workerClient);
    const adapter = createBotsDataAdapter(
      workerClient,
      lease({
        principal: { kind: "worker", id: "worker-1" },
        taskId: "task-worker-7",
        artifactRef: "artifact-7",
        capabilities: [...workerCaps],
      }),
    );
    const company = adapter.records.createWithReceipt({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "bots:worker:company",
      data: { name: "Worker Co" },
    });
    assert.equal(company.ok, true);
    assert.equal(company.result.receipt.taskId, "task-worker-7");
    assert.equal(company.result.receipt.artifactRef, "artifact-7");
    assert.equal(company.result.receipt.receipt.actor.kind, "worker");

    const txn = adapter.transactions.executeWithReceipt({
      idempotencyKey: "bots:worker:txn",
      operations: [
        {
          operation: "data.record.create",
          payload: {
            spaceId: "crm",
            entity: "deals",
            idempotencyKey: "bots:worker:txn:deal",
            data: {
              title: "Worker deal",
              value: 30,
              stage: "lead",
              company: company.result.record.recordId,
            },
          },
        },
      ],
    });
    assert.equal(txn.ok, true);
    assert.equal(txn.result.receipt.taskId, "task-worker-7");
    assert.equal(txn.result.receipt.artifactRef, "artifact-7");

    const preview = adapter.bulk.preview([
      {
        operation: "data.record.create",
        payload: {
          spaceId: "crm",
          entity: "deals",
          idempotencyKey: "bots:worker:bulk:1",
          data: {
            title: "Bulk worker",
            value: 5,
            stage: "lead",
            company: company.result.record.recordId,
          },
        },
      },
    ]);
    assert.equal(preview.ok, true);
    const executed = adapter.bulk.execute({
      idempotencyKey: "bots:worker:bulk:exec",
      expectedPreviewDigest: preview.result.previewDigest,
      operations: [
        {
          operation: "data.record.create",
          payload: {
            spaceId: "crm",
            entity: "deals",
            idempotencyKey: "bots:worker:bulk:1",
            data: {
              title: "Bulk worker",
              value: 5,
              stage: "lead",
              company: company.result.record.recordId,
            },
          },
        },
      ],
    });
    assert.equal(executed.ok, true);
    assert.equal(executed.result.receipt.taskId, "task-worker-7");

    const byKey = adapter.provenance.getReceiptByIdempotencyKey(
      "bots:worker:company",
    );
    assert.equal(byKey.ok, true);
    assert.equal(byKey.result.actor.kind, "worker");
  } finally {
    workerClient.close();
    fix.cleanup();
  }
});

test("leases reject malformed shapes and error codes stay stable", () => {
  const fix = workspaceScope();
  const client = botClient(fix.scope);
  try {
    bootstrap(client);
    assert.throws(
      () =>
        createBotsDataAdapter(
          client,
          lease({ taskId: "" }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof BotsDataAdapterError);
        assert.equal(error.code, "LEASE_INVALID");
        return true;
      },
    );
    assert.throws(
      () =>
        createBotsDataAdapter(
          client,
          lease({ capabilities: [] }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof BotsDataAdapterError);
        return true;
      },
    );
    assert.throws(
      () =>
        createBotsDataAdapter(
          client,
          // @ts-expect-error human principals are never leased here
          lease({ principal: { kind: "human", id: "someone" } }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof BotsDataAdapterError);
        return true;
      },
    );
  } finally {
    client.close();
    fix.cleanup();
  }
});
