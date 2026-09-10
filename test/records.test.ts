import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { DataCatalog } from "../src/catalog/index.js";
import { DataRecordError, DataRecords } from "../src/records/index.js";
import { DATA_PROTOCOL_LIMITS } from "../src/protocol/index.js";
import { SqliteStorageDriver } from "../src/storage/index.js";

function withRecords(
  run: (
    catalog: DataCatalog,
    records: DataRecords,
    databasePath: string,
    close: () => void,
  ) => void,
): void {
  const directory = mkdtempSync(join(tmpdir(), "ai-verse-data-records-"));
  const databasePath = join(directory, "data.sqlite");
  const database = new SqliteStorageDriver().open({ location: databasePath });
  const catalog = new DataCatalog(database);
  const records = new DataRecords(database);
  let closed = false;
  const close = (): void => {
    if (closed) return;
    database.close();
    closed = true;
  };

  try {
    run(catalog, records, databasePath, close);
  } finally {
    close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertRecordError(
  error: unknown,
  expectedCode: DataRecordError["code"],
): boolean {
  assert.ok(error instanceof DataRecordError);
  assert.equal(error.code, expectedCode);
  return true;
}

const human = { kind: "human", id: "local-operator" } as const;

let idempotencySequence = 0;
function nextIdempotencyKey(): string {
  idempotencySequence += 1;
  return `legacy-test:${idempotencySequence}`;
}

const bot = { kind: "bot", id: "sales-bot" } as const;

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
      name: { type: "string", required: true },
    },
  });

  catalog.createSchema({
    spaceId: "crm",
    entity: "deals",
    name: "Deals",
    fields: {
      title: {
        type: "string",
        required: true,
        minLength: 1,
        maxLength: 120,
      },
      value: { type: "number", min: 0 },
      seats: { type: "integer", min: 1 },
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
        nullable: true,
      },
      metadata: { type: "json", nullable: true },
    },
  });
}

test("record layer creates one fixed STRICT _records table", () => {
  withRecords((catalog, _records, databasePath) => {
    bootstrapCrm(catalog);

    const raw = new Database(databasePath, { readonly: true });
    try {
      const tableList = raw.pragma("table_list") as Array<{
        readonly name: string;
        readonly strict: number;
      }>;
      assert.equal(
        tableList.find((row) => row.name === "_records")?.strict,
        1,
      );

      const entityTables = raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('deals', 'crm_deals')",
        )
        .all();
      assert.deepEqual(entityTables, []);
    } finally {
      raw.close();
    }
  });
});

test("create applies defaults and stores stable identity, timestamps, schema version, and actor", () => {
  withRecords((catalog, records) => {
    bootstrapCrm(catalog);

    const created = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      data: {
        title: "Campaign renewal",
        value: 18000,
        seats: 5,
      },
      actor: human,
    });

    assert.match(created.recordId, /^rec_[a-f0-9]{32}$/);
    assert.equal(created.schemaVersion, 1);
    assert.equal(created.version, 1);
    assert.equal(created.data.title, "Campaign renewal");
    assert.equal(created.data.stage, "lead");
    assert.equal(created.data.active, true);
    assert.deepEqual(created.createdBy, human);
    assert.deepEqual(created.updatedBy, human);
    assert.equal(created.createdAt, created.updatedAt);
    assert.ok(Number.isFinite(Date.parse(created.createdAt)));
    assert.equal(created.deletedAt, null);
    assert.equal(created.deletedReason, null);
    assert.equal(created.deletedBy, null);
  });
});

test("create rejects missing required fields atomically", () => {
  withRecords((catalog, records) => {
    bootstrapCrm(catalog);

    assert.throws(
      () =>
        records.create({
      idempotencyKey: nextIdempotencyKey(),
          spaceId: "crm",
          entity: "deals",
          data: { value: 10 },
          actor: human,
        }),
      (error) => assertRecordError(error, "FIELD_INVALID"),
    );

    assert.deepEqual(records.list({ spaceId: "crm", entity: "deals" }), []);
  });
});

test("create rejects unknown fields unless the entity explicitly permits them", () => {
  withRecords((catalog, records) => {
    bootstrapCrm(catalog);

    assert.throws(
      () =>
        records.create({
      idempotencyKey: nextIdempotencyKey(),
          spaceId: "crm",
          entity: "deals",
          data: { title: "A", surprise: 1 },
          actor: human,
        }),
      (error) => assertRecordError(error, "FIELD_UNKNOWN"),
    );

    catalog.createSchema({
      spaceId: "crm",
      entity: "notes",
      name: "Notes",
      allowUnknownFields: true,
      fields: {
        title: { type: "string", required: true },
      },
    });

    const note = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "notes",
      data: {
        title: "Flexible",
        custom: { nested: [1, 2, 3] },
      },
      actor: human,
    });

    assert.deepEqual(note.data.custom, { nested: [1, 2, 3] });
  });
});

test("first-release field types and constraints are enforced on records", () => {
  withRecords((catalog, records) => {
    bootstrapCrm(catalog);

    const invalidCases = [
      { title: "", seats: 1 },
      { title: "A", value: -1 },
      { title: "A", seats: 1.5 },
      { title: "A", active: "yes" },
      { title: "A", due: "2026-02-31" },
      { title: "A", contactedAt: "2026-09-10 12:00:00" },
      { title: "A", stage: "maybe" },
      { title: "A", company: "../other" },
    ] as const;

    for (const data of invalidCases) {
      assert.throws(
        () =>
          records.create({
      idempotencyKey: nextIdempotencyKey(),
            spaceId: "crm",
            entity: "deals",
            data: data as never,
            actor: human,
          }),
        (error) => assertRecordError(error, "FIELD_INVALID"),
      );
    }

    const company = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "companies",
      data: { name: "Company 1" },
      actor: human,
    });

    const valid = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      data: {
        title: "Valid",
        value: 10.5,
        seats: 2,
        active: false,
        due: "2026-09-10",
        contactedAt: "2026-09-10T12:00:00Z",
        stage: "proposal",
        company: company.recordId,
        metadata: { source: "manual" },
      },
      actor: human,
    });
    assert.equal(valid.data.stage, "proposal");
  });
});

test("nullable fields accept null and non-nullable fields do not", () => {
  withRecords((catalog, records) => {
    bootstrapCrm(catalog);

    const valid = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      data: {
        title: "Nullable",
        due: null,
        contactedAt: null,
        company: null,
        metadata: null,
      },
      actor: human,
    });
    assert.equal(valid.data.due, null);

    assert.throws(
      () =>
        records.create({
      idempotencyKey: nextIdempotencyKey(),
          spaceId: "crm",
          entity: "deals",
          data: { title: null },
          actor: human,
        }),
      (error) => assertRecordError(error, "FIELD_INVALID"),
    );
  });
});

test("get and list return created records with a bounded list limit", () => {
  withRecords((catalog, records) => {
    bootstrapCrm(catalog);
    const first = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      data: { title: "First" },
      actor: human,
    });
    const second = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      data: { title: "Second" },
      actor: human,
    });

    assert.deepEqual(records.get({
      spaceId: "crm",
      entity: "deals",
      recordId: first.recordId,
    }), first);

    const listed = records.list({
      spaceId: "crm",
      entity: "deals",
      limit: 1,
    });
    assert.equal(listed.length, 1);
    assert.ok([first.recordId, second.recordId].includes(listed[0]!.recordId));

    assert.throws(
      () =>
        records.list({
          spaceId: "crm",
          entity: "deals",
          limit: DATA_PROTOCOL_LIMITS.maxQueryPageSize + 1,
        }),
      (error) => assertRecordError(error, "FIELD_INVALID"),
    );
  });
});

test("update validates merged data, increments version, and changes only updated actor attribution", () => {
  withRecords((catalog, records) => {
    bootstrapCrm(catalog);
    const created = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      data: { title: "Campaign", value: 100 },
      actor: human,
    });

    const updated = records.update({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      recordId: created.recordId,
      expectedVersion: 1,
      patch: {
        value: 250,
        stage: "proposal",
      },
      actor: bot,
    });

    assert.equal(updated.version, 2);
    assert.equal(updated.schemaVersion, 1);
    assert.equal(updated.data.title, "Campaign");
    assert.equal(updated.data.value, 250);
    assert.equal(updated.data.stage, "proposal");
    assert.deepEqual(updated.createdBy, human);
    assert.deepEqual(updated.updatedBy, bot);
    assert.equal(updated.createdAt, created.createdAt);
    assert.ok(Date.parse(updated.updatedAt) >= Date.parse(created.updatedAt));
  });
});

test("stale update version fails without changing the record", () => {
  withRecords((catalog, records) => {
    bootstrapCrm(catalog);
    const created = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      data: { title: "Campaign", value: 100 },
      actor: human,
    });

    records.update({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      recordId: created.recordId,
      expectedVersion: 1,
      patch: { value: 200 },
      actor: bot,
    });

    assert.throws(
      () =>
        records.update({
      idempotencyKey: nextIdempotencyKey(),
          spaceId: "crm",
          entity: "deals",
          recordId: created.recordId,
          expectedVersion: 1,
          patch: { value: 999 },
          actor: human,
        }),
      (error) => assertRecordError(error, "RECORD_VERSION_CONFLICT"),
    );

    const current = records.get({
      spaceId: "crm",
      entity: "deals",
      recordId: created.recordId,
    });
    assert.equal(current.version, 2);
    assert.equal(current.data.value, 200);
    assert.deepEqual(current.updatedBy, bot);
  });
});

test("invalid update patch leaves canonical record unchanged", () => {
  withRecords((catalog, records) => {
    bootstrapCrm(catalog);
    const created = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      data: { title: "Campaign", value: 100 },
      actor: human,
    });

    assert.throws(
      () =>
        records.update({
      idempotencyKey: nextIdempotencyKey(),
          spaceId: "crm",
          entity: "deals",
          recordId: created.recordId,
          expectedVersion: 1,
          patch: { value: -10 },
          actor: bot,
        }),
      (error) => assertRecordError(error, "FIELD_INVALID"),
    );

    assert.throws(
      () =>
        records.update({
      idempotencyKey: nextIdempotencyKey(),
          spaceId: "crm",
          entity: "deals",
          recordId: created.recordId,
          expectedVersion: 1,
          patch: {},
          actor: bot,
        }),
      (error) => assertRecordError(error, "FIELD_INVALID"),
    );

    const current = records.get({
      spaceId: "crm",
      entity: "deals",
      recordId: created.recordId,
    });
    assert.equal(current.version, 1);
    assert.equal(current.data.value, 100);
  });
});

test("records advance to the current schema on update and receive new defaults", () => {
  withRecords((catalog, records) => {
    bootstrapCrm(catalog);
    const created = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      data: { title: "Campaign" },
      actor: human,
    });
    assert.equal(created.schemaVersion, 1);

    catalog.updateSchema({
      spaceId: "crm",
      entity: "deals",
      expectedSchemaVersion: 1,
      changes: [
        {
          op: "add_field",
          field: "owner",
          definition: {
            type: "string",
            required: true,
            default: "unassigned",
          },
        },
      ],
    });

    const beforeUpdate = records.get({
      spaceId: "crm",
      entity: "deals",
      recordId: created.recordId,
    });
    assert.equal(beforeUpdate.schemaVersion, 1);
    assert.equal("owner" in beforeUpdate.data, false);

    const updated = records.update({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      recordId: created.recordId,
      expectedVersion: 1,
      patch: { stage: "proposal" },
      actor: bot,
    });
    assert.equal(updated.schemaVersion, 2);
    assert.equal(updated.data.owner, "unassigned");

    const fresh = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      data: { title: "New Deal" },
      actor: human,
    });
    assert.equal(fresh.schemaVersion, 2);
    assert.equal(fresh.data.owner, "unassigned");
  });
});

test("soft delete increments version, records deletion actor/reason, and hides normal reads", () => {
  withRecords((catalog, records) => {
    bootstrapCrm(catalog);
    const created = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      data: { title: "Duplicate" },
      actor: human,
    });

    const deleted = records.softDelete({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      recordId: created.recordId,
      expectedVersion: 1,
      actor: bot,
      reason: "duplicate record",
    });

    assert.equal(deleted.version, 2);
    assert.ok(deleted.deletedAt !== null);
    assert.equal(deleted.deletedReason, "duplicate record");
    assert.deepEqual(deleted.deletedBy, bot);
    assert.deepEqual(deleted.updatedBy, bot);

    assert.throws(
      () =>
        records.get({
          spaceId: "crm",
          entity: "deals",
          recordId: created.recordId,
        }),
      (error) => assertRecordError(error, "RECORD_NOT_FOUND"),
    );
    assert.deepEqual(records.list({ spaceId: "crm", entity: "deals" }), []);

    const visibleDeleted = records.get({
      spaceId: "crm",
      entity: "deals",
      recordId: created.recordId,
      includeDeleted: true,
    });
    assert.equal(visibleDeleted.deletedReason, "duplicate record");

    const listedDeleted = records.list({
      spaceId: "crm",
      entity: "deals",
      includeDeleted: true,
    });
    assert.equal(listedDeleted.length, 1);
    assert.equal(listedDeleted[0]!.recordId, created.recordId);
  });
});

test("stale delete version fails and leaves the record active", () => {
  withRecords((catalog, records) => {
    bootstrapCrm(catalog);
    const created = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      data: { title: "Keep" },
      actor: human,
    });
    const updated = records.update({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      recordId: created.recordId,
      expectedVersion: 1,
      patch: { stage: "proposal" },
      actor: bot,
    });

    assert.throws(
      () =>
        records.softDelete({
      idempotencyKey: nextIdempotencyKey(),
          spaceId: "crm",
          entity: "deals",
          recordId: created.recordId,
          expectedVersion: 1,
          actor: human,
        }),
      (error) => assertRecordError(error, "RECORD_VERSION_CONFLICT"),
    );

    const current = records.get({
      spaceId: "crm",
      entity: "deals",
      recordId: created.recordId,
    });
    assert.equal(current.version, updated.version);
    assert.equal(current.deletedAt, null);
  });
});

test("deleted records cannot be updated or deleted again through normal mutation paths", () => {
  withRecords((catalog, records) => {
    bootstrapCrm(catalog);
    const created = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      data: { title: "Gone" },
      actor: human,
    });
    records.softDelete({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      recordId: created.recordId,
      expectedVersion: 1,
      actor: human,
    });

    assert.throws(
      () =>
        records.update({
      idempotencyKey: nextIdempotencyKey(),
          spaceId: "crm",
          entity: "deals",
          recordId: created.recordId,
          expectedVersion: 2,
          patch: { title: "Return" },
          actor: human,
        }),
      (error) => assertRecordError(error, "RECORD_NOT_FOUND"),
    );

    assert.throws(
      () =>
        records.softDelete({
      idempotencyKey: nextIdempotencyKey(),
          spaceId: "crm",
          entity: "deals",
          recordId: created.recordId,
          expectedVersion: 2,
          actor: human,
        }),
      (error) => assertRecordError(error, "RECORD_NOT_FOUND"),
    );
  });
});

test("CRUD state and actor provenance survive database close and reopen", () => {
  withRecords((catalog, records, databasePath, close) => {
    bootstrapCrm(catalog);
    const created = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      data: { title: "Persistent", value: 10 },
      actor: human,
    });
    const updated = records.update({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      recordId: created.recordId,
      expectedVersion: 1,
      patch: { value: 20 },
      actor: bot,
    });
    close();

    const reopenedDatabase = new SqliteStorageDriver().open({
      location: databasePath,
      mode: "open-existing",
    });
    try {
      const reopenedRecords = new DataRecords(reopenedDatabase);
      const reopened = reopenedRecords.get({
        spaceId: "crm",
        entity: "deals",
        recordId: created.recordId,
      });
      assert.equal(reopened.version, 2);
      assert.equal(reopened.data.value, 20);
      assert.deepEqual(reopened.createdBy, human);
      assert.deepEqual(reopened.updatedBy, bot);
      assert.equal(reopened.createdAt, updated.createdAt);
      assert.equal(reopened.updatedAt, updated.updatedAt);
    } finally {
      reopenedDatabase.close();
    }
  });
});

test("invalid actors are rejected before a record is written", () => {
  withRecords((catalog, records) => {
    bootstrapCrm(catalog);

    assert.throws(
      () =>
        records.create({
      idempotencyKey: nextIdempotencyKey(),
          spaceId: "crm",
          entity: "deals",
          data: { title: "Bad actor" },
          actor: { kind: "bot", id: "../escape" },
        }),
      (error) => assertRecordError(error, "FIELD_INVALID"),
    );

    assert.deepEqual(records.list({ spaceId: "crm", entity: "deals" }), []);
  });
});

test("stored payload tampering that violates its persisted schema fails closed on read", () => {
  withRecords((catalog, records, databasePath, close) => {
    bootstrapCrm(catalog);
    const created = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      data: { title: "Untampered", seats: 2 },
      actor: human,
    });
    close();

    const raw = new Database(databasePath);
    try {
      raw.prepare(
        "UPDATE _records SET data_json = ? WHERE space_id = ? AND entity_id = ? AND record_id = ?",
      ).run(
        JSON.stringify({ title: "Tampered", seats: 1.5 }),
        "crm",
        "deals",
        created.recordId,
      );
    } finally {
      raw.close();
    }

    const reopenedDatabase = new SqliteStorageDriver().open({
      location: databasePath,
      mode: "open-existing",
    });
    try {
      const reopenedRecords = new DataRecords(reopenedDatabase);
      assert.throws(
        () =>
          reopenedRecords.get({
            spaceId: "crm",
            entity: "deals",
            recordId: created.recordId,
          }),
        (error) => assertRecordError(error, "DATABASE_CORRUPT"),
      );
    } finally {
      reopenedDatabase.close();
    }
  });
});

test("record payloads are bounded after defaults and normalization", () => {
  withRecords((catalog, records) => {
    catalog.createSpace({
      spaceId: "content",
      name: "Content",
      authority: "local_canonical",
    });
    catalog.createSchema({
      spaceId: "content",
      entity: "items",
      name: "Items",
      fields: {
        body: { type: "string", required: true },
      },
    });

    const huge = "x".repeat(DATA_PROTOCOL_LIMITS.maxRecordBytes);
    assert.throws(
      () =>
        records.create({
      idempotencyKey: nextIdempotencyKey(),
          spaceId: "content",
          entity: "items",
          data: { body: huge },
          actor: human,
        }),
      (error) => assertRecordError(error, "FIELD_INVALID"),
    );
    assert.deepEqual(records.list({ spaceId: "content", entity: "items" }), []);
  });
});
