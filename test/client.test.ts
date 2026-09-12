import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DataClientError, createDataClient } from "../src/client/index.js";
import type { BulkMutationOperation } from "../src/protocol/index.js";
import {
  TrustedDataRoot,
  createWorkspaceDataScope,
} from "../src/scope/index.js";
import { openScopedDataDatabase } from "../src/scope/index.js";
import { SqliteStorageDriver } from "../src/storage/index.js";

const actor = { kind: "human", id: "client-tester" } as const;
const authorization = { mode: "local-operator" } as const;

function tempRoot(prefix: string): {
  readonly rootPath: string;
  cleanup(): void;
} {
  const rootPath = mkdtempSync(join(tmpdir(), prefix));
  return {
    rootPath,
    cleanup(): void {
      rmSync(rootPath, { recursive: true, force: true });
    },
  };
}

function workspaceClient(workspaceId = "sales") {
  const tmp = tempRoot("ai-verse-data-client-");
  mkdirSync(join(tmp.rootPath, "workspaces", workspaceId, "data"), {
    recursive: true,
  });
  const root = TrustedDataRoot.fromExistingDirectory(tmp.rootPath);
  const scope = createWorkspaceDataScope(root, workspaceId);
  const client = createDataClient({ scope, actor, authorization });
  return { tmp, scope, client };
}

function bootstrap(client: ReturnType<typeof createDataClient>) {
  const space = client.spaces.create({
    spaceId: "crm",
    name: "CRM",
    authority: "local_canonical",
  });
  assert.equal(space.ok, true);
  const companySchema = client.schemas.create({
    spaceId: "crm",
    entity: "companies",
    name: "Companies",
    fields: { name: { type: "string", required: true } },
  });
  assert.equal(companySchema.ok, true);
  const dealSchema = client.schemas.create({
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
  });
  assert.equal(dealSchema.ok, true);
}

test("client full CRUD with receipts, OCC conflict, and idempotent replay", () => {
  const { tmp, client } = workspaceClient();
  try {
    bootstrap(client);
    assert.equal(client.health.metadata().workspaceId, "sales");

    const company = client.records.createWithReceipt({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "client:company:create",
      data: { name: "Acme" },
    });
    assert.equal(company.ok, true);
    assert.equal(company.result.record.version, 1);
    assert.ok(company.result.receipt.receiptId.startsWith("rcpt_"));

    const replay = client.records.createWithReceipt({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "client:company:create",
      data: { name: "Acme" },
    });
    assert.equal(replay.ok, true);
    assert.deepEqual(replay.result.record, company.result.record);
    assert.equal(replay.result.receipt.requestId, company.result.receipt.requestId);

    const deal = client.records.createWithReceipt({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "client:deal:create",
      data: {
        title: "Big deal",
        value: 100,
        stage: "proposal",
        company: company.result.record.recordId,
      },
    });
    assert.equal(deal.ok, true);

    assert.throws(
      () =>
        client.records.update({
          spaceId: "crm",
          entity: "deals",
          recordId: deal.result.record.recordId,
          expectedVersion: 99,
          idempotencyKey: "client:deal:stale",
          patch: { value: 999 },
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /version|concurrency/i);
        return true;
      },
    );

    const updated = client.records.updateWithReceipt({
      spaceId: "crm",
      entity: "deals",
      recordId: deal.result.record.recordId,
      expectedVersion: 1,
      idempotencyKey: "client:deal:update",
      patch: { value: 120 },
    });
    assert.equal(updated.ok, true);
    assert.equal(updated.result.record.version, 2);

    const fetched = client.records.get({
      spaceId: "crm",
      entity: "deals",
      recordId: deal.result.record.recordId,
    });
    assert.equal(fetched.ok, true);
    assert.equal(fetched.result.version, 2);

    const listed = client.records.list({
      spaceId: "crm",
      entity: "deals",
      limit: 50,
    });
    assert.equal(listed.ok, true);
    assert.equal(listed.result.length, 1);

    const deleted = client.records.removeWithReceipt({
      spaceId: "crm",
      entity: "deals",
      recordId: deal.result.record.recordId,
      expectedVersion: 2,
      idempotencyKey: "client:deal:delete",
    });
    assert.equal(deleted.ok, true);
    assert.ok(deleted.result.record.deletedAt !== null);
  } finally {
    client.close();
    tmp.cleanup();
  }
});

test("client query, aggregate, transactions, and provenance envelopes", () => {
  const { tmp, client } = workspaceClient();
  try {
    bootstrap(client);
    const company = client.records.create({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "client:q:company",
      data: { name: "Acme" },
    });
    assert.equal(company.ok, true);

    const first = client.records.create({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "client:q:deal-1",
      data: {
        title: "One",
        value: 40,
        stage: "proposal",
        company: company.result.recordId,
      },
    });
    const second = client.records.create({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "client:q:deal-2",
      data: {
        title: "Two",
        value: 60,
        stage: "won",
        company: company.result.recordId,
      },
    });
    assert.equal(first.ok && second.ok, true);

    const page = client.query.query({
      spaceId: "crm",
      entity: "deals",
      where: { field: "stage", op: "eq", value: "won" },
      orderBy: [{ field: "value", direction: "desc" }],
      limit: 10,
    });
    assert.equal(page.ok, true);
    assert.equal(page.result.items.length, 1);
    assert.equal(page.protocol, "ai-verse-data/0.1");
    assert.equal(page.operation, "data.query");
    assert.deepEqual(page.scope, { workspaceId: "sales" });
    assert.deepEqual(page.warnings, []);
    assert.match(page.requestId, /^req_/);

    const aggregate = client.query.aggregate({
      spaceId: "crm",
      entity: "deals",
      metrics: [
        { op: "count", as: "count" },
        { op: "sum", field: "value", as: "sum" },
      ],
    });
    assert.equal(aggregate.ok, true);
    assert.equal(aggregate.result.values["count"], 2);
    assert.equal(aggregate.result.values["sum"], 100);

    const txn = client.transactions.executeWithReceipt({
      idempotencyKey: "client:txn:1",
      operations: [
        {
          operation: "data.record.create",
          payload: {
            spaceId: "crm",
            entity: "deals",
            idempotencyKey: "client:txn:create",
            data: {
              title: "Txn deal",
              value: 25,
              stage: "lead",
              company: company.result.recordId,
            },
          },
        },
      ],
    });
    assert.equal(txn.ok, true);
    assert.equal(txn.result.result.operations.length, 1);
    assert.ok(txn.result.receipt.receiptId.startsWith("rcpt_"));

    const events = client.provenance.listEvents({ spaceId: "crm" });
    assert.equal(events.ok, true);
    assert.ok(events.result.items.length > 0);
    const exactEvent = client.provenance.getEvent(events.result.items[0]!.eventId);
    assert.equal(exactEvent.ok, true);
    assert.equal(
      exactEvent.result.eventId,
      events.result.items[0]!.eventId,
    );
    assert.ok(events.result.items.length >= 4);
    assert.equal(events.operation, "data.events.list");

    const byKey = client.provenance.getReceiptByIdempotencyKey(
      "client:q:deal-1",
    );
    assert.equal(byKey.ok, true);
    assert.ok(byKey.result.receiptId.startsWith("rcpt_"));

    const byId = client.provenance.getReceipt(byKey.result.receiptId);
    assert.equal(byId.ok, true);
    assert.equal(byId.result.receiptId, byKey.result.receiptId);

    const txnReceipts = client.provenance.listTransactionReceipts(
      txn.result.receipt.transactionId ?? "txn_missing",
    );
    assert.equal(txnReceipts.ok, true);
    assert.ok(txnReceipts.result.length >= 1);
  } finally {
    client.close();
    tmp.cleanup();
  }
});

test("client bulk digest gate, ceilings, and stale preview", () => {
  const { tmp, client } = workspaceClient();
  try {
    bootstrap(client);
    const company = client.records.create({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "client:bulk:company",
      data: { name: "Acme" },
    });
    assert.equal(company.ok, true);

    const operations: readonly BulkMutationOperation[] = [
      {
        operation: "data.record.create",
        payload: {
          spaceId: "crm",
          entity: "deals",
          idempotencyKey: "client:bulk:1",
          data: {
            title: "Bulk one",
            value: 10,
            stage: "lead",
            company: company.result.recordId,
          },
        },
      },
      {
        operation: "data.record.create",
        payload: {
          spaceId: "crm",
          entity: "deals",
          idempotencyKey: "client:bulk:2",
          data: {
            title: "Bulk two",
            value: 20,
            stage: "lead",
            company: company.result.recordId,
          },
        },
      },
    ];

    const preview = client.bulk.preview(operations);
    assert.equal(preview.ok, true);
    assert.equal(preview.result.operationCount, 2);
    assert.equal(preview.result.atomicity, "all-or-nothing");
    assert.match(preview.result.previewDigest, /^[0-9a-f]{64}$/);

    assert.throws(
      () =>
        client.bulk.execute({
          idempotencyKey: "client:bulk:exec-stale",
          expectedPreviewDigest: "0".repeat(64),
          operations,
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /stale|digest|preview/i);
        return true;
      },
    );

    const executed = client.bulk.execute({
      idempotencyKey: "client:bulk:exec",
      expectedPreviewDigest: preview.result.previewDigest,
      operations,
    });
    assert.equal(executed.ok, true);
    assert.equal(executed.result.transaction.operations.length, 2);

    const tooMany: readonly BulkMutationOperation[] = Array.from(
      { length: 51 },
      (_, index) => ({
        operation: "data.record.create",
        payload: {
          spaceId: "crm",
          entity: "deals",
          idempotencyKey: `client:bulk:ceiling:${index}`,
          data: {
            title: `Ceiling ${index}`,
            value: 1,
            stage: "lead",
            company: company.result.recordId,
          },
        },
      }),
    );
    assert.throws(
      () => client.bulk.preview(tooMany),
      (error: unknown) => error instanceof DataClientError,
    );

    const tooManyTxn = Array.from({ length: 51 }, (_, index) => ({
      operation: "data.record.create" as const,
      payload: {
        spaceId: "crm",
        entity: "deals",
        idempotencyKey: `client:txn:ceiling:${index}`,
        data: {
          title: `Txn ceiling ${index}`,
          value: 1,
          stage: "lead",
          company: company.result.recordId,
        },
      },
    }));
    assert.throws(
      () =>
        client.transactions.execute({
          idempotencyKey: "client:txn:ceiling",
          operations: tooManyTxn,
        }),
      (error: unknown) => error instanceof DataClientError,
    );
  } finally {
    client.close();
    tmp.cleanup();
  }
});

test("client schema migration preview tale with approval split", () => {
  const { tmp, client } = workspaceClient();
  try {
    bootstrap(client);
    const company = client.records.create({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "client:mig:company",
      data: { name: "Acme" },
    });
    assert.equal(company.ok, true);
    client.records.create({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "client:mig:deal",
      data: {
        title: "Migrate me",
        value: 10,
        stage: "lead",
        company: company.result.recordId,
      },
    });

    const preview = client.schemas.previewMigration({
      spaceId: "crm",
      entity: "deals",
      expectedSchemaVersion: 1,
      changes: [
        {
          op: "add_field",
          field: "owner",
          definition: { type: "string", required: true },
        },
      ],
      backfills: [{ field: "owner", mode: "set_if_missing", value: "unassigned" }],
      owner: { kind: "human", id: "client-tester" },
      reason: "Client migration tale",
    });
    assert.equal(preview.ok, true);
    assert.equal(preview.result.destructive, false);
    assert.equal(preview.result.approvalRequired, false);
    assert.match(preview.result.previewDigest, /^[0-9a-f]{64}$/);

    const executed = client.schemas.executeMigrationWithReceipt({
      spaceId: "crm",
      entity: "deals",
      expectedSchemaVersion: 1,
      changes: [
        {
          op: "add_field",
          field: "owner",
          definition: { type: "string", required: true },
        },
      ],
      backfills: [{ field: "owner", mode: "set_if_missing", value: "unassigned" }],
      owner: { kind: "human", id: "client-tester" },
      reason: "Client migration tale",
      idempotencyKey: "client:migration:1",
      expectedPreviewDigest: preview.result.previewDigest,
    });
    assert.equal(executed.ok, true);
    assert.equal(executed.result.result.toSchemaVersion, 2);
    assert.ok(executed.result.receipt.receiptId.startsWith("rcpt_"));

    const destructivePreview = client.schemas.previewMigration({
      spaceId: "crm",
      entity: "deals",
      expectedSchemaVersion: 2,
      changes: [{ op: "remove_field", field: "stage" }],
      owner: { kind: "human", id: "client-tester" },
    });
    assert.equal(destructivePreview.ok, true);
    assert.equal(destructivePreview.result.destructive, true);
    assert.equal(destructivePreview.result.approvalRequired, true);

    assert.throws(
      () =>
        client.schemas.executeMigration({
          spaceId: "crm",
          entity: "deals",
          expectedSchemaVersion: 2,
          changes: [{ op: "remove_field", field: "stage" }],
          owner: { kind: "human", id: "client-tester" },
          idempotencyKey: "client:migration:destructive-no-approval",
          expectedPreviewDigest: destructivePreview.result.previewDigest,
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /approv/i);
        return true;
      },
    );
  } finally {
    client.close();
    tmp.cleanup();
  }
});

test("client error-code stability, isolation, and reopen", () => {
  const { tmp, client } = workspaceClient();
  try {
    bootstrap(client);
    assert.throws(
      () =>
        createDataClient({
          scope: client.scope,
          actor: { kind: "robot", id: "x" } as unknown as {
            kind: "human";
            id: string;
          },
          authorization,
        }),
      (error: unknown) => {
        assert.ok(error instanceof DataClientError);
        assert.equal(error.code, "CLIENT_INVALID");
        return true;
      },
    );
    assert.throws(
      () =>
        createDataClient({
          scope: client.scope,
          actor,
          authorization: { mode: "self-granted" } as unknown as {
            mode: "local-operator";
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof DataClientError);
        assert.equal(error.code, "AUTHORIZATION_INVALID");
        return true;
      },
    );

    client.close();
    assert.equal(client.closed, true);
    assert.throws(
      () => client.spaces.list(),
      (error: unknown) => {
        assert.ok(error instanceof DataClientError);
        assert.equal(error.code, "CLIENT_CLOSED");
        return true;
      },
    );

    const driver = new SqliteStorageDriver();
    const reopened = openScopedDataDatabase(driver, client.scope);
    try {
      assert.equal(reopened.database.metadata().binding?.workspaceId, "sales");
    } finally {
      reopened.database.close();
    }

    const otherRoot = TrustedDataRoot.fromExistingDirectory(tmp.rootPath);
    const otherScope = createWorkspaceDataScope(otherRoot, "support");
    mkdirSync(join(tmp.rootPath, "workspaces", "support", "data"), {
      recursive: true,
    });
    const other = createDataClient({
      scope: otherScope,
      actor,
      authorization,
    });
    try {
      assert.equal(other.health.metadata().workspaceId, "support");
      assert.throws(
        () => other.spaces.get({ spaceId: "crm" }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          return true;
        },
      );
    } finally {
      other.close();
    }
  } finally {
    tmp.cleanup();
  }
});

test("client backup export round-trips and health facts stay typed", async () => {
  const { tmp, client } = workspaceClient();
  try {
    bootstrap(client);
    client.records.create({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "client:backup:company",
      data: { name: "Acme" },
    });

    const diagnostics = client.health.diagnostics();
    assert.equal(diagnostics.ok, true);
    assert.ok(diagnostics.result.sqliteVersion.length > 0);

    const integrity = client.health.integrityCheck();
    assert.equal(integrity.ok, true);
    assert.equal(integrity.result.ok, true);

    const migration = client.health.migrationStatus();
    assert.equal(migration.ok, true);
    assert.equal(migration.result.state, "current");

    const artifacts = mkdtempSync(join(tmpdir(), "ai-verse-data-client-artifacts-"));
    try {
      const backupDir = join(artifacts, "backup");
      const exportDir = join(artifacts, "export");
      const backup = await client.backup.createBackup(backupDir);
      assert.ok(backup.manifest.artifactId.startsWith("artifact_"));
      const verified = await client.backup.verifyBackup(backupDir);
      assert.equal(
        verified.manifest.artifactId,
        backup.manifest.artifactId,
      );

      const exported = await client.backup.createPortableExport(exportDir);
      assert.ok(exported.manifest.artifactId.startsWith("artifact_"));
      const exportVerified = await client.backup.verifyPortableExport(exportDir);
      assert.equal(
        exportVerified.manifest.artifactId,
        exported.manifest.artifactId,
      );
    } finally {
      rmSync(artifacts, { recursive: true, force: true });
    }
  } finally {
    client.close();
    tmp.cleanup();
  }
});

test("client rejects raw paths and unknown protocol extras stay out", () => {
  assert.throws(
    () =>
      createDataClient({
        // @ts-expect-error raw SQLite paths are never a client input
        databasePath: "/tmp/evil.sqlite",
        actor,
        authorization,
      }),
    (error: unknown) => error instanceof DataClientError,
  );
  assert.throws(
    () =>
      createDataClient({
        // @ts-expect-error raw SQL is never a client input
        sql: "SELECT 1",
        actor,
        authorization,
      }),
    (error: unknown) => error instanceof DataClientError,
  );
});
