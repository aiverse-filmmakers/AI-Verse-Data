import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { DataCatalog } from "../src/catalog/index.js";
import { DataQuery } from "../src/query/index.js";
import { DataRecordError, DataRecords } from "../src/records/index.js";
import {
  TrustedDataRoot,
  createStandaloneDataScope,
  createWorkspaceDataScope,
  openScopedDataDatabase,
} from "../src/scope/index.js";
import {
  AI_VERSE_DATA_DATABASE_FORMAT_VERSION,
  DataStorageError,
  SqliteStorageDriver,
} from "../src/storage/index.js";
import { DataTransactions } from "../src/transactions/index.js";

const actor = { kind: "human", id: "phase1-gate" } as const;

let idempotencySequence = 0;
function nextIdempotencyKey(): string {
  idempotencySequence += 1;
  return `legacy-test:${idempotencySequence}`;
}


function assertRecordError(
  error: unknown,
  code: DataRecordError["code"],
): boolean {
  assert.ok(error instanceof DataRecordError);
  assert.equal(error.code, code);
  return true;
}

function assertStorageError(
  error: unknown,
  code: DataStorageError["code"],
): boolean {
  assert.ok(error instanceof DataStorageError);
  assert.equal(error.code, code);
  return true;
}

function bootstrapCrm(catalog: DataCatalog): void {
  catalog.createSpace({
    spaceId: "crm",
    name: "CRM",
    authority: "local_canonical",
  });

  catalog.createSchema({
    spaceId: "crm",
    entity: "companies",
    name: "Companies",
    fields: {
      name: { type: "string", required: true, minLength: 1 },
    },
  });

  catalog.createSchema({
    spaceId: "crm",
    entity: "deals",
    name: "Deals",
    fields: {
      title: { type: "string", required: true, minLength: 1 },
      value: { type: "number", min: 0, default: 0 },
      seats: { type: "integer", min: 1, default: 1 },
      active: { type: "boolean", default: true },
      due: { type: "date", nullable: true },
      contactedAt: { type: "datetime", nullable: true },
      stage: {
        type: "enum",
        values: ["lead", "proposal", "won", "lost"],
        default: "lead",
      },
      company: {
        type: "reference",
        entity: "companies",
        required: true,
      },
      metadata: { type: "json", nullable: true },
      attachment: { type: "attachment_ref", nullable: true },
    },
  });
}

test("Phase 1 standalone acceptance story survives close and reopen exactly", () => {
  const rootPath = realpathSync(mkdtempSync(join(tmpdir(), "ai-verse-data-phase1-standalone-")));
  try {
    mkdirSync(join(rootPath, ".ai-verse-data"), { recursive: true });

    const root = TrustedDataRoot.fromExistingDirectory(rootPath);
    const scope = createStandaloneDataScope(root, "local");
    const driver = new SqliteStorageDriver();
    const first = openScopedDataDatabase(driver, scope);

    assert.equal(first.database.metadata().formatVersion, AI_VERSE_DATA_DATABASE_FORMAT_VERSION);
    assert.equal(first.database.metadata().binding?.workspaceId, "local");
    assert.equal(first.database.integrityCheck().ok, true);

    const catalog = new DataCatalog(first.database);
    const records = new DataRecords(first.database);
    const query = new DataQuery(first.database);
    const transactions = new DataTransactions(first.database);

    bootstrapCrm(catalog);

    assert.equal(catalog.listSpaces().length, 1);
    assert.equal(catalog.getSpace("crm").spaceId, "crm");
    assert.equal(catalog.listSchemas("crm").length, 2);
    assert.equal(catalog.getSchema("crm", "deals").schemaVersion, 1);

    const company = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "companies",
      data: { name: "Acme" },
      actor,
    });

    const deal = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      data: {
        title: "Campaign",
        value: 1000,
        seats: 2,
        active: true,
        due: "2026-09-30",
        contactedAt: "2026-09-10T12:00:00Z",
        stage: "proposal",
        company: company.recordId,
        metadata: { source: "phase1-gate" },
        attachment: "asset_001",
      },
      actor,
    });

    assert.equal(records.get({
      spaceId: "crm",
      entity: "deals",
      recordId: deal.recordId,
    }).data.company, company.recordId);
    assert.equal(records.list({ spaceId: "crm", entity: "deals" }).length, 1);

    assert.throws(
      () =>
        records.update({
      idempotencyKey: nextIdempotencyKey(),
          spaceId: "crm",
          entity: "deals",
          recordId: deal.recordId,
          expectedVersion: 99,
          patch: { value: 2000 },
          actor,
        }),
      (error) => assertRecordError(error, "RECORD_VERSION_CONFLICT"),
    );

    const updated = records.update({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      recordId: deal.recordId,
      expectedVersion: 1,
      patch: { value: 2500, stage: "won" },
      actor,
    });
    assert.equal(updated.version, 2);
    assert.equal(updated.data.value, 2500);

    const page = query.query({
      spaceId: "crm",
      entity: "deals",
      where: {
        and: [
          { field: "stage", op: "eq", value: "won" },
          { field: "value", op: "gte", value: 2000 },
        ],
      },
      orderBy: [{ field: "value", direction: "desc" }],
      limit: 10,
    });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]!.recordId, deal.recordId);

    const aggregate = query.aggregate({
      spaceId: "crm",
      entity: "deals",
      metrics: [
        { op: "count", as: "count" },
        { op: "sum", field: "value", as: "sum" },
        { op: "min", field: "value", as: "min" },
        { op: "max", field: "value", as: "max" },
        { op: "avg", field: "value", as: "avg" },
      ],
    });
    assert.deepEqual(aggregate.values, {
      count: 1,
      sum: 2500,
      min: 2500,
      max: 2500,
      avg: 2500,
    });

    const transaction = transactions.execute({
      actor,
      payload: {
        idempotencyKey: "phase1-gate-transaction",
        operations: [
          {
            operation: "data.record.create",
            payload: {
              spaceId: "crm",
              entity: "companies",
              idempotencyKey: "phase1-gate-company-2",
              clientRef: "company-2",
              data: { name: "Beta" },
            },
          },
          {
            operation: "data.record.create",
            payload: {
              spaceId: "crm",
              entity: "deals",
              idempotencyKey: "phase1-gate-deal-2",
              data: {
                title: "Transaction Deal",
                value: 500,
                company: { $ref: "company-2" },
              },
            },
          },
        ],
      },
    });

    assert.equal(transaction.operations.length, 2);
    const transactionDeal = transaction.operations[1]!.record;
    assert.equal(transactionDeal.data.company, transaction.clientRefs["company-2"]);

    const deleted = records.softDelete({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      recordId: deal.recordId,
      expectedVersion: 2,
      actor,
      reason: "Phase 1 gate",
    });
    assert.equal(deleted.version, 3);
    assert.ok(deleted.deletedAt !== null);
    assert.throws(
      () =>
        records.get({
          spaceId: "crm",
          entity: "deals",
          recordId: deal.recordId,
        }),
      (error) => assertRecordError(error, "RECORD_NOT_FOUND"),
    );

    const beforeClose = {
      spaces: catalog.listSpaces(),
      schemas: catalog.listSchemas("crm"),
      activeDeals: records.list({ spaceId: "crm", entity: "deals" }),
      allDeals: records.list({
        spaceId: "crm",
        entity: "deals",
        includeDeleted: true,
      }),
      deletedDeal: records.get({
        spaceId: "crm",
        entity: "deals",
        recordId: deal.recordId,
        includeDeleted: true,
      }),
      transactionDeal: records.get({
        spaceId: "crm",
        entity: "deals",
        recordId: transactionDeal.recordId,
      }),
    };

    first.database.close();

    const second = openScopedDataDatabase(driver, scope, {
      mode: "open-existing",
    });
    const reopenedCatalog = new DataCatalog(second.database);
    const reopenedRecords = new DataRecords(second.database);

    assert.deepEqual(reopenedCatalog.listSpaces(), beforeClose.spaces);
    assert.deepEqual(reopenedCatalog.listSchemas("crm"), beforeClose.schemas);
    assert.deepEqual(
      reopenedRecords.list({ spaceId: "crm", entity: "deals" }),
      beforeClose.activeDeals,
    );
    assert.deepEqual(
      reopenedRecords.list({
        spaceId: "crm",
        entity: "deals",
        includeDeleted: true,
      }),
      beforeClose.allDeals,
    );
    assert.deepEqual(
      reopenedRecords.get({
        spaceId: "crm",
        entity: "deals",
        recordId: deal.recordId,
        includeDeleted: true,
      }),
      beforeClose.deletedDeal,
    );
    assert.deepEqual(
      reopenedRecords.get({
        spaceId: "crm",
        entity: "deals",
        recordId: transactionDeal.recordId,
      }),
      beforeClose.transactionDeal,
    );
    assert.equal(second.database.integrityCheck().ok, true);
    second.database.close();
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("Phase 1 native-ready workspace scope creates the canonical workspace database", () => {
  const rootPath = realpathSync(mkdtempSync(join(tmpdir(), "ai-verse-data-phase1-workspace-")));
  try {
    mkdirSync(join(rootPath, "workspaces", "production", "data"), {
      recursive: true,
    });

    const root = TrustedDataRoot.fromExistingDirectory(rootPath);
    const scope = createWorkspaceDataScope(root, "production");
    const opened = openScopedDataDatabase(new SqliteStorageDriver(), scope);

    assert.equal(
      scope.databasePath(),
      join(
        rootPath,
        "workspaces",
        "production",
        "data",
        "ai-verse-data.sqlite",
      ),
    );
    assert.deepEqual(opened.database.metadata().binding, {
      bindingVersion: 1,
      kind: "workspace",
      workspaceId: "production",
    });
    opened.database.close();
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("Phase 1 workspace databases remain physically and logically isolated", () => {
  const rootPath = realpathSync(mkdtempSync(join(tmpdir(), "ai-verse-data-phase1-isolation-")));
  try {
    for (const workspaceId of ["workspace-a", "workspace-b"]) {
      mkdirSync(join(rootPath, "workspaces", workspaceId, "data"), {
        recursive: true,
      });
    }

    const root = TrustedDataRoot.fromExistingDirectory(rootPath);
    const driver = new SqliteStorageDriver();
    const scopeA = createWorkspaceDataScope(root, "workspace-a");
    const scopeB = createWorkspaceDataScope(root, "workspace-b");
    const a = openScopedDataDatabase(driver, scopeA);
    const b = openScopedDataDatabase(driver, scopeB);

    const catalogA = new DataCatalog(a.database);
    const catalogB = new DataCatalog(b.database);
    const recordsA = new DataRecords(a.database);
    const recordsB = new DataRecords(b.database);

    catalogA.createSpace({
      spaceId: "crm",
      name: "CRM",
      authority: "local_canonical",
    });
    catalogB.createSpace({
      spaceId: "crm",
      name: "CRM",
      authority: "local_canonical",
    });
    catalogA.createSchema({
      spaceId: "crm",
      entity: "notes",
      name: "Notes",
      fields: { text: { type: "string", required: true } },
    });
    catalogB.createSchema({
      spaceId: "crm",
      entity: "notes",
      name: "Notes",
      fields: { text: { type: "string", required: true } },
    });

    const recordA = recordsA.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "notes",
      data: { text: "A only" },
      actor,
    });
    const recordB = recordsB.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "notes",
      data: { text: "B only" },
      actor,
    });

    assert.notEqual(scopeA.databasePath(), scopeB.databasePath());
    assert.equal(recordsA.get({
      spaceId: "crm",
      entity: "notes",
      recordId: recordA.recordId,
    }).data.text, "A only");
    assert.equal(recordsB.get({
      spaceId: "crm",
      entity: "notes",
      recordId: recordB.recordId,
    }).data.text, "B only");
    assert.equal(recordsA.list({ spaceId: "crm", entity: "notes" }).length, 1);
    assert.equal(recordsB.list({ spaceId: "crm", entity: "notes" }).length, 1);

    assert.throws(
      () =>
        recordsA.get({
          spaceId: "crm",
          entity: "notes",
          recordId: recordB.recordId,
        }),
      (error) => assertRecordError(error, "RECORD_NOT_FOUND"),
    );
    assert.throws(
      () =>
        recordsB.get({
          spaceId: "crm",
          entity: "notes",
          recordId: recordA.recordId,
        }),
      (error) => assertRecordError(error, "RECORD_NOT_FOUND"),
    );

    a.database.close();
    b.database.close();
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("Phase 1 scoped reopen rejects an unsupported newer database format", () => {
  const rootPath = realpathSync(mkdtempSync(join(tmpdir(), "ai-verse-data-phase1-version-")));
  try {
    mkdirSync(join(rootPath, ".ai-verse-data"), { recursive: true });
    const root = TrustedDataRoot.fromExistingDirectory(rootPath);
    const scope = createStandaloneDataScope(root, "local");
    const driver = new SqliteStorageDriver();
    const created = openScopedDataDatabase(driver, scope);
    created.database.close();

    const raw = driver.open({
      location: scope.databasePath(),
      mode: "open-existing",
    });
    raw.close();

    // Existing lower-level storage tests mutate durable format metadata directly.
    // This gate verifies the scoped open path propagates the same fail-closed error.
    const sqlite = new Database(scope.databasePath());
    sqlite
      .prepare("UPDATE _aiverse_meta SET value = ? WHERE key = 'format_version'")
      .run("999");
    sqlite.pragma("user_version = 999");
    sqlite.close();

    assert.throws(
      () => openScopedDataDatabase(driver, scope, { mode: "open-existing" }),
      (error) => assertStorageError(error, "DATABASE_VERSION_UNSUPPORTED"),
    );
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
});
