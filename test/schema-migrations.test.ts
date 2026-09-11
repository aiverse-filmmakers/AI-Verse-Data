import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DataCatalog } from "../src/catalog/index.js";
import {
  DATA_PROTOCOL_LIMITS,
  DATA_PROTOCOL_VERSION,
  DataProtocolValidationError,
  validateRequestEnvelope,
} from "../src/protocol/index.js";
import { DataProvenance } from "../src/provenance/index.js";
import { DataRecords } from "../src/records/index.js";
import {
  DataSchemaMigrationError,
  DataSchemaMigrations,
} from "../src/schema-migrations/index.js";
import { SqliteStorageDriver } from "../src/storage/index.js";

const human = { kind: "human", id: "owner" } as const;
const bot = { kind: "bot", id: "migration-bot" } as const;
const approver = { kind: "human", id: "approver" } as const;

function fixture(): {
  readonly directory: string;
  readonly database: ReturnType<SqliteStorageDriver["open"]>;
  readonly catalog: DataCatalog;
  readonly records: DataRecords;
  readonly migrations: DataSchemaMigrations;
  readonly provenance: DataProvenance;
} {
  const directory = mkdtempSync(join(tmpdir(), "ai-verse-data-schema-migration-"));
  const database = new SqliteStorageDriver().open({
    location: join(directory, "data.sqlite"),
  });
  const catalog = new DataCatalog(database);
  catalog.createSpace({
    spaceId: "crm",
    name: "CRM",
    authority: "local_canonical",
  });
  catalog.createSchema({
    spaceId: "crm",
    entity: "deals",
    name: "Deals",
    fields: {
      title: { type: "string", required: true },
      value: { type: "number" },
      stage: {
        type: "enum",
        values: ["lead", "proposal", "won"],
        default: "lead",
      },
    },
  });

  return {
    directory,
    database,
    catalog,
    records: new DataRecords(database),
    migrations: new DataSchemaMigrations(database),
    provenance: new DataProvenance(database),
  };
}

function cleanup(value: ReturnType<typeof fixture>): void {
  value.database.close();
  rmSync(value.directory, { recursive: true, force: true });
}

function assertMigrationError(
  error: unknown,
  code: DataSchemaMigrationError["code"],
): boolean {
  assert.ok(error instanceof DataSchemaMigrationError);
  assert.equal(error.code, code);
  return true;
}

function approval(ref = "approval-1") {
  return {
    approvalRef: ref,
    approvedBy: approver,
    approvedAt: "2026-09-11T12:00:00Z",
    reason: "Explicit destructive migration approval",
  } as const;
}

test("required-field migration previews and atomically backfills all active records", () => {
  const f = fixture();
  try {
    const first = f.records.create({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "seed:first",
      data: { title: "One", value: 10 },
      actor: human,
    });
    const second = f.records.create({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "seed:second",
      data: { title: "Two", value: 20 },
      actor: human,
    });

    const migration = {
      spaceId: "crm",
      entity: "deals",
      expectedSchemaVersion: 1,
      changes: [
        {
          op: "add_field" as const,
          field: "owner",
          definition: { type: "string" as const, required: true },
        },
      ],
      backfills: [
        {
          field: "owner",
          mode: "set_if_missing" as const,
          value: "unassigned",
        },
      ],
      owner: human,
      reason: "Add canonical deal owner",
    };

    const preview = f.migrations.preview({
      actor: bot,
      payload: migration,
    });
    assert.equal(preview.fromSchemaVersion, 1);
    assert.equal(preview.toSchemaVersion, 2);
    assert.equal(preview.activeRecordCount, 2);
    assert.equal(preview.rewrittenRecordCount, 2);
    assert.equal(preview.destructive, false);
    assert.equal(preview.approvalRequired, false);
    assert.match(preview.previewDigest, /^[0-9a-f]{64}$/);

    const executed = f.migrations.executeWithReceipt({
      actor: bot,
      requestId: "req_schema_migration_required_field",
      payload: {
        ...migration,
        idempotencyKey: "schema:migration:required-owner",
        expectedPreviewDigest: preview.previewDigest,
      },
    });

    assert.equal(executed.result.toSchemaVersion, 2);
    assert.equal(executed.result.approval, null);
    assert.equal(executed.receipt.operation, "data.transaction.execute");
    assert.equal(
      executed.receipt.requestId,
      "req_schema_migration_required_field",
    );

    const schema = f.catalog.getSchema("crm", "deals");
    assert.equal(schema.schemaVersion, 2);
    assert.deepEqual(schema.fields.owner, {
      type: "string",
      required: true,
    });

    const afterFirst = f.records.get({
      spaceId: "crm",
      entity: "deals",
      recordId: first.recordId,
    });
    const afterSecond = f.records.get({
      spaceId: "crm",
      entity: "deals",
      recordId: second.recordId,
    });
    for (const record of [afterFirst, afterSecond]) {
      assert.equal(record.schemaVersion, 2);
      assert.equal(record.version, 2);
      assert.equal(record.data.owner, "unassigned");
      assert.deepEqual(record.updatedBy, bot);
    }

    const events = f.provenance.listEvents().items;
    assert.equal(events.length, 5);
    const migrationEvents = events.slice(2);
    assert.deepEqual(
      migrationEvents.map((event) => event.eventType),
      ["record.updated", "record.updated", "transaction.committed"],
    );
    assert.equal(migrationEvents[0]!.details.schemaMigration, true);
    assert.equal(
      migrationEvents[2]!.details.requestedOperation,
      "data.schema.migration.execute",
    );
    const rawOuter = migrationEvents[2]!.details as Record<string, unknown>;
    assert.deepEqual(rawOuter.schemaMigrationOwner, human);
  } finally {
    cleanup(f);
  }
});

test("schema migration replay returns the original result and creates no duplicate effects", () => {
  const f = fixture();
  try {
    f.records.create({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "seed:replay",
      data: { title: "Replay" },
      actor: human,
    });

    const base = {
      spaceId: "crm",
      entity: "deals",
      expectedSchemaVersion: 1,
      changes: [
        {
          op: "add_field" as const,
          field: "owner",
          definition: {
            type: "string" as const,
            required: true,
            default: "owner",
          },
        },
      ],
      owner: human,
    };
    const preview = f.migrations.preview({ actor: bot, payload: base });
    const payload = {
      ...base,
      idempotencyKey: "schema:migration:replay",
      expectedPreviewDigest: preview.previewDigest,
    };

    const first = f.migrations.executeWithReceipt({
      actor: bot,
      requestId: "req_schema_first",
      payload,
    });
    const eventCount = f.provenance.listEvents().items.length;
    const replay = f.migrations.executeWithReceipt({
      actor: bot,
      requestId: "req_schema_retry",
      payload,
    });

    assert.deepEqual(replay.result, first.result);
    assert.deepEqual(replay.receipt, first.receipt);
    assert.equal(replay.receipt.requestId, "req_schema_first");
    assert.equal(f.provenance.listEvents().items.length, eventCount);
    assert.equal(f.catalog.getSchema("crm", "deals").schemaVersion, 2);
  } finally {
    cleanup(f);
  }
});

test("destructive rename requires approval and preserves canonical value under the new field", () => {
  const f = fixture();
  try {
    const created = f.records.create({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "seed:rename",
      data: { title: "Rename me", value: 42 },
      actor: human,
    });

    const base = {
      spaceId: "crm",
      entity: "deals",
      expectedSchemaVersion: 1,
      changes: [
        {
          op: "rename_field" as const,
          field: "value",
          newField: "amount",
        },
      ],
      owner: human,
    };

    const preview = f.migrations.preview({ actor: bot, payload: base });
    assert.equal(preview.destructive, true);
    assert.equal(preview.approvalRequired, true);

    assert.throws(
      () =>
        f.migrations.execute({
          actor: bot,
          payload: {
            ...base,
            idempotencyKey: "schema:migration:rename:no-approval",
            expectedPreviewDigest: preview.previewDigest,
          },
        }),
      (error) => assertMigrationError(error, "APPROVAL_REQUIRED"),
    );
    assert.equal(f.catalog.getSchema("crm", "deals").schemaVersion, 1);
    assert.equal(
      f.records.get({
        spaceId: "crm",
        entity: "deals",
        recordId: created.recordId,
      }).version,
      1,
    );

    const freshPreview = f.migrations.preview({ actor: bot, payload: base });
    const result = f.migrations.execute({
      actor: bot,
      payload: {
        ...base,
        idempotencyKey: "schema:migration:rename:approved",
        expectedPreviewDigest: freshPreview.previewDigest,
        approval: approval("approval-rename"),
      },
    });
    assert.equal(result.approval?.approvalRef, "approval-rename");

    const record = f.records.get({
      spaceId: "crm",
      entity: "deals",
      recordId: created.recordId,
    });
    assert.equal(record.data.amount, 42);
    assert.equal("value" in record.data, false);

    const schema = f.catalog.getSchema("crm", "deals");
    assert.equal("amount" in schema.fields, true);
    assert.equal("value" in schema.fields, false);
  } finally {
    cleanup(f);
  }
});

test("replace-field narrowing fails preview unless an explicit destructive set backfill makes every record valid", () => {
  const f = fixture();
  try {
    f.records.create({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "seed:narrow:one",
      data: { title: "One", stage: "lead" },
      actor: human,
    });
    f.records.create({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "seed:narrow:two",
      data: { title: "Two", stage: "proposal" },
      actor: human,
    });

    const changes = [
      {
        op: "replace_field" as const,
        field: "stage",
        definition: {
          type: "enum" as const,
          values: ["won"] as const,
          required: true,
        },
      },
    ];

    assert.throws(
      () =>
        f.migrations.preview({
          actor: bot,
          payload: {
            spaceId: "crm",
            entity: "deals",
            expectedSchemaVersion: 1,
            changes,
            owner: human,
          },
        }),
      (error) => assertMigrationError(error, "SCHEMA_MIGRATION_INVALID"),
    );

    const payload = {
      spaceId: "crm",
      entity: "deals",
      expectedSchemaVersion: 1,
      changes,
      backfills: [
        {
          field: "stage",
          mode: "set" as const,
          value: "won",
        },
      ],
      owner: human,
    };
    const preview = f.migrations.preview({ actor: bot, payload });
    assert.equal(preview.destructive, true);
    f.migrations.execute({
      actor: bot,
      payload: {
        ...payload,
        idempotencyKey: "schema:migration:narrow",
        expectedPreviewDigest: preview.previewDigest,
        approval: approval("approval-narrow"),
      },
    });

    assert.ok(
      f.records
        .list({ spaceId: "crm", entity: "deals" })
        .every((record) => record.data.stage === "won"),
    );
  } finally {
    cleanup(f);
  }
});

test("reference-field migration rebuilds relation indexes against the proposed target", () => {
  const f = fixture();
  try {
    f.catalog.createSchema({
      spaceId: "crm",
      entity: "companies",
      name: "Companies",
      fields: {
        name: { type: "string", required: true },
      },
    });
    f.catalog.createSchema({
      spaceId: "crm",
      entity: "accounts",
      name: "Accounts",
      fields: {
        name: { type: "string", required: true },
      },
    });
    f.catalog.updateSchema({
      spaceId: "crm",
      entity: "deals",
      expectedSchemaVersion: 1,
      changes: [
        {
          op: "add_field",
          field: "party",
          definition: { type: "reference", entity: "companies" },
        },
      ],
    });

    const company = f.records.create({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "seed:company",
      data: { name: "Company" },
      actor: human,
    });
    const account = f.records.create({
      spaceId: "crm",
      entity: "accounts",
      idempotencyKey: "seed:account",
      data: { name: "Account" },
      actor: human,
    });
    const deal = f.records.create({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "seed:reference-deal",
      data: { title: "Reference", party: company.recordId },
      actor: human,
    });

    const base = {
      spaceId: "crm",
      entity: "deals",
      expectedSchemaVersion: 2,
      changes: [
        {
          op: "replace_field" as const,
          field: "party",
          definition: {
            type: "reference" as const,
            entity: "accounts",
          },
        },
      ],
      owner: human,
    };

    assert.throws(
      () => f.migrations.preview({ actor: bot, payload: base }),
      (error) => assertMigrationError(error, "SCHEMA_MIGRATION_INVALID"),
    );

    const payload = {
      ...base,
      backfills: [
        {
          field: "party",
          mode: "set" as const,
          value: account.recordId,
        },
      ],
    };
    const preview = f.migrations.preview({ actor: bot, payload });
    f.migrations.execute({
      actor: bot,
      payload: {
        ...payload,
        idempotencyKey: "schema:migration:reference",
        expectedPreviewDigest: preview.previewDigest,
        approval: approval("approval-reference"),
      },
    });

    const relation = f.database
      .relationStorage()
      .listSourceRelations("crm", "deals", deal.recordId);
    assert.equal(relation.length, 1);
    assert.equal(relation[0]!.targetEntity, "accounts");
    assert.equal(relation[0]!.targetRecordId, account.recordId);
  } finally {
    cleanup(f);
  }
});

test("preview digest becomes stale after any active record changes and execute commits nothing", () => {
  const f = fixture();
  try {
    const created = f.records.create({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "seed:stale",
      data: { title: "Before", value: 1 },
      actor: human,
    });
    const payload = {
      spaceId: "crm",
      entity: "deals",
      expectedSchemaVersion: 1,
      changes: [
        {
          op: "add_field" as const,
          field: "owner",
          definition: { type: "string" as const, default: "x" },
        },
      ],
      owner: human,
    };
    const preview = f.migrations.preview({ actor: bot, payload });

    f.records.update({
      spaceId: "crm",
      entity: "deals",
      recordId: created.recordId,
      expectedVersion: 1,
      idempotencyKey: "seed:stale:update",
      patch: { value: 2 },
      actor: human,
    });

    assert.throws(
      () =>
        f.migrations.execute({
          actor: bot,
          payload: {
            ...payload,
            idempotencyKey: "schema:migration:stale",
            expectedPreviewDigest: preview.previewDigest,
          },
        }),
      (error) => assertMigrationError(error, "SCHEMA_MIGRATION_STALE"),
    );

    assert.equal(f.catalog.getSchema("crm", "deals").schemaVersion, 1);
    const record = f.records.get({
      spaceId: "crm",
      entity: "deals",
      recordId: created.recordId,
    });
    assert.equal(record.version, 2);
    assert.equal("owner" in record.data, false);
  } finally {
    cleanup(f);
  }
});

test("deleted records remain historical while active records move to the new schema", () => {
  const f = fixture();
  try {
    const active = f.records.create({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "seed:active",
      data: { title: "Active" },
      actor: human,
    });
    const deleted = f.records.create({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "seed:deleted",
      data: { title: "Deleted" },
      actor: human,
    });
    f.records.softDelete({
      spaceId: "crm",
      entity: "deals",
      recordId: deleted.recordId,
      expectedVersion: 1,
      idempotencyKey: "seed:deleted:delete",
      actor: human,
    });

    const payload = {
      spaceId: "crm",
      entity: "deals",
      expectedSchemaVersion: 1,
      changes: [
        {
          op: "add_field" as const,
          field: "owner",
          definition: { type: "string" as const, default: "x" },
        },
      ],
      owner: human,
    };
    const preview = f.migrations.preview({ actor: bot, payload });
    assert.equal(preview.activeRecordCount, 1);
    f.migrations.execute({
      actor: bot,
      payload: {
        ...payload,
        idempotencyKey: "schema:migration:deleted-history",
        expectedPreviewDigest: preview.previewDigest,
      },
    });

    assert.equal(
      f.records.get({
        spaceId: "crm",
        entity: "deals",
        recordId: active.recordId,
      }).schemaVersion,
      2,
    );
    const historicalDeleted = f.records.get({
      spaceId: "crm",
      entity: "deals",
      recordId: deleted.recordId,
      includeDeleted: true,
    });
    assert.equal(historicalDeleted.schemaVersion, 1);
    assert.equal(historicalDeleted.version, 2);
  } finally {
    cleanup(f);
  }
});

test("migration refuses more than the atomic active-record ceiling", () => {
  const f = fixture();
  try {
    const store = f.database.recordStorage();
    store.initialize();
    const now = new Date().toISOString();
    for (
      let index = 0;
      index < DATA_PROTOCOL_LIMITS.maxSchemaMigrationRecords + 1;
      index += 1
    ) {
      assert.equal(
        store.createRecord({
          spaceId: "crm",
          entity: "deals",
          recordId: `rec_limit_${String(index).padStart(4, "0")}`,
          schemaVersion: 1,
          version: 1,
          dataJson: JSON.stringify({ title: `Deal ${index}` }),
          createdAt: now,
          updatedAt: now,
          createdActorKind: human.kind,
          createdActorId: human.id,
          updatedActorKind: human.kind,
          updatedActorId: human.id,
          deletedAt: null,
          deletedReason: null,
          deletedActorKind: null,
          deletedActorId: null,
        }),
        true,
      );
    }

    assert.throws(
      () =>
        f.migrations.preview({
          actor: bot,
          payload: {
            spaceId: "crm",
            entity: "deals",
            expectedSchemaVersion: 1,
            changes: [
              {
                op: "add_field",
                field: "owner",
                definition: { type: "string", default: "x" },
              },
            ],
            owner: human,
          },
        }),
      (error) =>
        assertMigrationError(error, "SCHEMA_MIGRATION_LIMIT_EXCEEDED"),
    );
    assert.equal(f.catalog.getSchema("crm", "deals").schemaVersion, 1);
  } finally {
    cleanup(f);
  }
});

test("protocol validates schema migration preview and execute surfaces", () => {
  const envelope = (
    operation: "data.schema.migration.preview" | "data.schema.migration.execute",
    payload: Record<string, unknown>,
  ) => ({
    protocol: DATA_PROTOCOL_VERSION,
    requestId: "req_schema_protocol",
    operation,
    scope: { workspaceId: "sales" },
    actor: bot,
    authorization: { mode: "host-bound" as const },
    payload,
  });

  const common = {
    spaceId: "crm",
    entity: "deals",
    expectedSchemaVersion: 1,
    changes: [
      {
        op: "rename_field",
        field: "value",
        newField: "amount",
      },
    ],
    owner: human,
  };

  assert.equal(
    validateRequestEnvelope(
      envelope("data.schema.migration.preview", common),
    ).operation,
    "data.schema.migration.preview",
  );

  assert.equal(
    validateRequestEnvelope(
      envelope("data.schema.migration.execute", {
        ...common,
        idempotencyKey: "schema:protocol",
        expectedPreviewDigest: "a".repeat(64),
        approval: approval("approval-protocol"),
      }),
    ).operation,
    "data.schema.migration.execute",
  );

  assert.throws(
    () =>
      validateRequestEnvelope(
        envelope("data.schema.migration.execute", {
          ...common,
          idempotencyKey: "schema:protocol",
          expectedPreviewDigest: "bad",
        }),
      ),
    (error) => {
      assert.ok(error instanceof DataProtocolValidationError);
      return true;
    },
  );

  assert.throws(
    () =>
      validateRequestEnvelope(
        envelope("data.schema.migration.preview", {
          ...common,
          backfills: [
            { field: "amount", mode: "set", value: 1 },
            { field: "amount", mode: "set", value: 2 },
          ],
        }),
      ),
    (error) => {
      assert.ok(error instanceof DataProtocolValidationError);
      return true;
    },
  );
});
