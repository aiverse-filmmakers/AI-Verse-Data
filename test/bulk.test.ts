import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { DataBulk, DataBulkError } from "../src/bulk/index.js";
import { DataCatalog } from "../src/catalog/index.js";
import {
  DATA_PROTOCOL_LIMITS,
  DATA_PROTOCOL_VERSION,
  DataProtocolValidationError,
  type BulkMutationOperation,
  validateBulkExecutePayload,
  validateBulkPreviewPayload,
  validateRequestEnvelope,
} from "../src/protocol/index.js";
import { DataProvenance } from "../src/provenance/index.js";
import { DataRecordError, DataRecords } from "../src/records/index.js";
import { SqliteStorageDriver } from "../src/storage/index.js";

const human = { kind: "human", id: "operator" } as const;
const bot = { kind: "bot", id: "bulk-bot" } as const;

interface Fixture {
  readonly directory: string;
  readonly databasePath: string;
  readonly database: ReturnType<SqliteStorageDriver["open"]>;
  readonly catalog: DataCatalog;
  readonly records: DataRecords;
  readonly provenance: DataProvenance;
  readonly bulk: DataBulk;
  close(): void;
}

function openFixture(): Fixture {
  const directory = mkdtempSync(join(tmpdir(), "ai-verse-data-bulk-"));
  const databasePath = join(directory, "data.sqlite");
  const database = new SqliteStorageDriver().open({ location: databasePath });
  const catalog = new DataCatalog(database);
  const records = new DataRecords(database);
  const provenance = new DataProvenance(database);
  const bulk = new DataBulk(database);

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
      title: { type: "string", required: true },
      value: { type: "number" },
      company: {
        type: "reference",
        entity: "companies",
      },
    },
  });

  let closed = false;
  return {
    directory,
    databasePath,
    database,
    catalog,
    records,
    provenance,
    bulk,
    close(): void {
      if (closed) return;
      database.close();
      closed = true;
    },
  };
}

function cleanup(fixture: Fixture): void {
  fixture.close();
  rmSync(fixture.directory, { recursive: true, force: true });
}

function assertBulkError(
  error: unknown,
  code: DataBulkError["code"],
): boolean {
  assert.ok(error instanceof DataBulkError);
  assert.equal(error.code, code);
  return true;
}

function eventSequence(databasePath: string): number {
  const raw = new Database(databasePath, { readonly: true });
  try {
    const row = raw.prepare(
      "SELECT seq FROM sqlite_sequence WHERE name = '_events'",
    ).get() as { seq: number } | undefined;
    return row?.seq ?? 0;
  } finally {
    raw.close();
  }
}

function tableCounts(databasePath: string): Record<string, number> {
  const raw = new Database(databasePath, { readonly: true });
  try {
    const output: Record<string, number> = {};
    for (const table of [
      "_records",
      "_record_relations",
      "_idempotency",
      "_events",
      "_mutation_receipts",
    ]) {
      const row = raw.prepare(
        `SELECT count(*) AS count FROM ${table}`,
      ).get() as { count: number };
      output[table] = row.count;
    }
    return output;
  } finally {
    raw.close();
  }
}

test("bulk preview uses exact mutation semantics but leaves zero committed effects", () => {
  const fixture = openFixture();
  try {
    const company = fixture.records.create({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "bulk:seed:company",
      data: { name: "Acme" },
      actor: human,
    });
    const deal = fixture.records.create({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "bulk:seed:deal",
      data: { title: "Existing", value: 1, company: company.recordId },
      actor: human,
    });

    const beforeCounts = tableCounts(fixture.databasePath);
    const beforeEventSequence = eventSequence(fixture.databasePath);
    const beforeEvents = fixture.provenance.listEvents().items;
    const beforeDeal = fixture.records.get({
      spaceId: "crm",
      entity: "deals",
      recordId: deal.recordId,
    });

    const operations: readonly BulkMutationOperation[] = [
      {
        operation: "data.record.create",
        payload: {
          spaceId: "crm",
          entity: "deals",
          idempotencyKey: "bulk:preview:create",
          data: { title: "Preview create", value: 2, company: company.recordId },
        },
      },
      {
        operation: "data.record.update",
        payload: {
          spaceId: "crm",
          entity: "deals",
          recordId: deal.recordId,
          expectedVersion: 1,
          idempotencyKey: "bulk:preview:update",
          patch: { value: 3 },
        },
      },
    ];

    const preview = fixture.bulk.preview({ actor: human, operations });

    assert.match(preview.previewDigest, /^[0-9a-f]{64}$/);
    assert.equal(preview.operationCount, 2);
    assert.equal(preview.atomicity, "all-or-nothing");
    assert.ok(preview.requestBytes > 0);
    assert.deepEqual(preview.items, [
      {
        index: 0,
        operation: "data.record.create",
        spaceId: "crm",
        entity: "deals",
        recordId: null,
        schemaVersion: 1,
        beforeVersion: null,
        afterVersion: 1,
        wouldBeDeleted: false,
      },
      {
        index: 1,
        operation: "data.record.update",
        spaceId: "crm",
        entity: "deals",
        recordId: deal.recordId,
        schemaVersion: 1,
        beforeVersion: 1,
        afterVersion: 2,
        wouldBeDeleted: false,
      },
    ]);

    assert.deepEqual(tableCounts(fixture.databasePath), beforeCounts);
    assert.equal(eventSequence(fixture.databasePath), beforeEventSequence);
    assert.deepEqual(fixture.provenance.listEvents().items, beforeEvents);
    assert.deepEqual(
      fixture.records.get({
        spaceId: "crm",
        entity: "deals",
        recordId: deal.recordId,
      }),
      beforeDeal,
    );
    assert.equal(
      fixture.records.list({ spaceId: "crm", entity: "deals" }).length,
      1,
    );
  } finally {
    cleanup(fixture);
  }
});

test("bulk preview supports transaction clientRef semantics without exposing ephemeral create IDs", () => {
  const fixture = openFixture();
  try {
    const operations: readonly BulkMutationOperation[] = [
      {
        operation: "data.record.create",
        payload: {
          spaceId: "crm",
          entity: "companies",
          idempotencyKey: "bulk:ref:company",
          clientRef: "new-company",
          data: { name: "Preview Corp" },
        },
      },
      {
        operation: "data.record.create",
        payload: {
          spaceId: "crm",
          entity: "deals",
          idempotencyKey: "bulk:ref:deal",
          data: {
            title: "ClientRef deal",
            company: { $ref: "new-company" },
          },
        },
      },
    ];

    const preview = fixture.bulk.preview({ actor: human, operations });
    assert.equal(preview.items[0]!.recordId, null);
    assert.equal(preview.items[1]!.recordId, null);
    assert.equal(
      fixture.records.list({ spaceId: "crm", entity: "companies" }).length,
      0,
    );
    assert.equal(
      fixture.records.list({ spaceId: "crm", entity: "deals" }).length,
      0,
    );
    assert.equal(fixture.provenance.listEvents().items.length, 0);
  } finally {
    cleanup(fixture);
  }
});

test("bulk execute requires the exact preview digest and commits all operations atomically", () => {
  const fixture = openFixture();
  try {
    const operations: readonly BulkMutationOperation[] = [
      {
        operation: "data.record.create",
        payload: {
          spaceId: "crm",
          entity: "companies",
          idempotencyKey: "bulk:commit:company",
          clientRef: "company",
          data: { name: "Committed Corp" },
        },
      },
      {
        operation: "data.record.create",
        payload: {
          spaceId: "crm",
          entity: "deals",
          idempotencyKey: "bulk:commit:deal",
          data: {
            title: "Committed deal",
            value: 10,
            company: { $ref: "company" },
          },
        },
      },
    ];

    const preview = fixture.bulk.preview({ actor: human, operations });
    const committed = fixture.bulk.execute({
      actor: human,
      requestId: "req_bulk_commit",
      idempotencyKey: "bulk:commit:outer",
      expectedPreviewDigest: preview.previewDigest,
      operations,
    });

    assert.equal(committed.previewDigest, preview.previewDigest);
    assert.equal(committed.atomicity, "all-or-nothing");
    assert.equal(committed.transaction.operations.length, 2);
    assert.equal(
      committed.transactionReceipt.operation,
      "data.transaction.execute",
    );
    assert.equal(committed.transactionReceipt.requestId, "req_bulk_commit");
    assert.match(committed.transactionReceipt.transactionId ?? "", /^txn_/);

    const companies = fixture.records.list({
      spaceId: "crm",
      entity: "companies",
    });
    const deals = fixture.records.list({ spaceId: "crm", entity: "deals" });
    assert.equal(companies.length, 1);
    assert.equal(deals.length, 1);
    assert.equal(deals[0]!.data.company, companies[0]!.recordId);

    const events = fixture.provenance.listEvents().items;
    assert.deepEqual(
      events.map((event) => event.eventType),
      ["record.created", "record.created", "transaction.committed"],
    );
  } finally {
    cleanup(fixture);
  }
});

test("changed operation set is rejected by the preview digest before commit", () => {
  const fixture = openFixture();
  try {
    const original: readonly BulkMutationOperation[] = [
      {
        operation: "data.record.create",
        payload: {
          spaceId: "crm",
          entity: "companies",
          idempotencyKey: "bulk:digest:item",
          data: { name: "Original" },
        },
      },
    ];
    const preview = fixture.bulk.preview({ actor: human, operations: original });

    const changed: readonly BulkMutationOperation[] = [
      {
        operation: "data.record.create",
        payload: {
          spaceId: "crm",
          entity: "companies",
          idempotencyKey: "bulk:digest:item",
          data: { name: "Changed" },
        },
      },
    ];

    assert.throws(
      () =>
        fixture.bulk.execute({
          actor: human,
          idempotencyKey: "bulk:digest:outer",
          expectedPreviewDigest: preview.previewDigest,
          operations: changed,
        }),
      (error) => assertBulkError(error, "BULK_PREVIEW_STALE"),
    );

    assert.equal(
      fixture.records.list({ spaceId: "crm", entity: "companies" }).length,
      0,
    );
    assert.equal(fixture.provenance.listEvents().items.length, 0);
  } finally {
    cleanup(fixture);
  }
});

test("preview digest is actor-bound", () => {
  const fixture = openFixture();
  try {
    const operations: readonly BulkMutationOperation[] = [
      {
        operation: "data.record.create",
        payload: {
          spaceId: "crm",
          entity: "companies",
          idempotencyKey: "bulk:actor:item",
          data: { name: "Actor-bound" },
        },
      },
    ];
    const humanPreview = fixture.bulk.preview({ actor: human, operations });
    const botPreview = fixture.bulk.preview({ actor: bot, operations });
    assert.notEqual(humanPreview.previewDigest, botPreview.previewDigest);

    assert.throws(
      () =>
        fixture.bulk.execute({
          actor: bot,
          idempotencyKey: "bulk:actor:outer",
          expectedPreviewDigest: humanPreview.previewDigest,
          operations,
        }),
      (error) => assertBulkError(error, "BULK_PREVIEW_STALE"),
    );
    assert.equal(
      fixture.records.list({ spaceId: "crm", entity: "companies" }).length,
      0,
    );
  } finally {
    cleanup(fixture);
  }
});

test("bulk execute retry replays exactly and emits no duplicate records or provenance", () => {
  const fixture = openFixture();
  try {
    const operations: readonly BulkMutationOperation[] = [
      {
        operation: "data.record.create",
        payload: {
          spaceId: "crm",
          entity: "companies",
          idempotencyKey: "bulk:replay:item",
          data: { name: "Replay Corp" },
        },
      },
    ];
    const preview = fixture.bulk.preview({ actor: human, operations });

    const first = fixture.bulk.execute({
      actor: human,
      requestId: "req_bulk_first",
      idempotencyKey: "bulk:replay:outer",
      expectedPreviewDigest: preview.previewDigest,
      operations,
    });
    const replay = fixture.bulk.execute({
      actor: human,
      requestId: "req_bulk_retry",
      idempotencyKey: "bulk:replay:outer",
      expectedPreviewDigest: preview.previewDigest,
      operations,
    });

    assert.deepEqual(replay, first);
    assert.equal(replay.transactionReceipt.requestId, "req_bulk_first");
    assert.equal(
      fixture.records.list({ spaceId: "crm", entity: "companies" }).length,
      1,
    );
    assert.equal(fixture.provenance.listEvents().items.length, 2);

    const counts = tableCounts(fixture.databasePath);
    assert.equal(counts._events, 2);
    assert.equal(counts._mutation_receipts, 2);
    assert.equal(counts._records, 1);
  } finally {
    cleanup(fixture);
  }
});

test("bulk outer idempotency key binds the preview digest and operation set", () => {
  const fixture = openFixture();
  try {
    const operations: readonly BulkMutationOperation[] = [
      {
        operation: "data.record.create",
        payload: {
          spaceId: "crm",
          entity: "companies",
          idempotencyKey: "bulk:idem:item",
          data: { name: "Idempotent" },
        },
      },
    ];
    const preview = fixture.bulk.preview({ actor: human, operations });
    fixture.bulk.execute({
      actor: human,
      idempotencyKey: "bulk:idem:outer",
      expectedPreviewDigest: preview.previewDigest,
      operations,
    });

    assert.throws(
      () =>
        fixture.bulk.execute({
          actor: human,
          idempotencyKey: "bulk:idem:outer",
          expectedPreviewDigest: "0".repeat(64),
          operations,
        }),
      /Idempotency key is already bound/,
    );

    assert.equal(
      fixture.records.list({ spaceId: "crm", entity: "companies" }).length,
      1,
    );
  } finally {
    cleanup(fixture);
  }
});

test("bulk commit is all-or-nothing when a later operation cannot commit", () => {
  const fixture = openFixture();
  try {
    const existing = fixture.records.create({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "bulk:atomic:seed",
      data: { name: "Seed" },
      actor: human,
    });

    const operations: readonly BulkMutationOperation[] = [
      {
        operation: "data.record.create",
        payload: {
          spaceId: "crm",
          entity: "companies",
          idempotencyKey: "bulk:atomic:create",
          data: { name: "Would roll back" },
        },
      },
      {
        operation: "data.record.update",
        payload: {
          spaceId: "crm",
          entity: "companies",
          recordId: existing.recordId,
          expectedVersion: 1,
          idempotencyKey: "bulk:atomic:update",
          patch: { name: "Updated" },
        },
      },
    ];

    const preview = fixture.bulk.preview({ actor: human, operations });

    fixture.records.update({
      spaceId: "crm",
      entity: "companies",
      recordId: existing.recordId,
      expectedVersion: 1,
      idempotencyKey: "bulk:atomic:intervening",
      patch: { name: "Intervening" },
      actor: bot,
    });

    assert.throws(
      () =>
        fixture.bulk.execute({
          actor: human,
          idempotencyKey: "bulk:atomic:outer",
          expectedPreviewDigest: preview.previewDigest,
          operations,
        }),
      (error) => {
        assert.ok(error instanceof DataRecordError);
        assert.equal(error.code, "RECORD_VERSION_CONFLICT");
        return true;
      },
    );

    const records = fixture.records.list({
      spaceId: "crm",
      entity: "companies",
    });
    assert.equal(records.length, 1);
    assert.equal(records[0]!.recordId, existing.recordId);
    assert.equal(records[0]!.data.name, "Intervening");
  } finally {
    cleanup(fixture);
  }
});

test("bulk rejects empty and over-count operation lists before mutation", () => {
  const fixture = openFixture();
  try {
    assert.throws(
      () => fixture.bulk.preview({ actor: human, operations: [] }),
      (error) => assertBulkError(error, "BULK_LIMIT_EXCEEDED"),
    );

    const tooMany: BulkMutationOperation[] = Array.from(
      { length: DATA_PROTOCOL_LIMITS.maxBulkOperations + 1 },
      (_, index) => ({
        operation: "data.record.create" as const,
        payload: {
          spaceId: "crm",
          entity: "companies",
          idempotencyKey: `bulk:count:${index}`,
          data: { name: `Company ${index}` },
        },
      }),
    );

    assert.throws(
      () => fixture.bulk.preview({ actor: human, operations: tooMany }),
      (error) => assertBulkError(error, "BULK_LIMIT_EXCEEDED"),
    );
    assert.equal(
      fixture.records.list({ spaceId: "crm", entity: "companies" }).length,
      0,
    );
  } finally {
    cleanup(fixture);
  }
});

test("bulk direct API enforces the hard byte ceiling before mutation", () => {
  const fixture = openFixture();
  try {
    const large = "x".repeat(110 * 1024);
    const operations: readonly BulkMutationOperation[] = [0, 1, 2].map(
      (index) => ({
        operation: "data.record.create" as const,
        payload: {
          spaceId: "crm",
          entity: "companies",
          idempotencyKey: `bulk:bytes:${index}`,
          data: { name: large },
        },
      }),
    );

    assert.ok(
      Buffer.byteLength(JSON.stringify({ operations }), "utf8") >
        DATA_PROTOCOL_LIMITS.maxBulkBytes,
    );
    assert.throws(
      () => fixture.bulk.preview({ actor: human, operations }),
      (error) => assertBulkError(error, "BULK_LIMIT_EXCEEDED"),
    );
    assert.equal(
      fixture.records.list({ spaceId: "crm", entity: "companies" }).length,
      0,
    );
  } finally {
    cleanup(fixture);
  }
});

test("bulk key separation rejects collisions before canonical mutation", () => {
  const fixture = openFixture();
  try {
    const operations: readonly BulkMutationOperation[] = [
      {
        operation: "data.record.create",
        payload: {
          spaceId: "crm",
          entity: "companies",
          idempotencyKey: "bulk:key:same",
          data: { name: "Collision" },
        },
      },
    ];
    const preview = fixture.bulk.preview({ actor: human, operations });

    assert.throws(
      () =>
        fixture.bulk.execute({
          actor: human,
          idempotencyKey: "bulk:key:same",
          expectedPreviewDigest: preview.previewDigest,
          operations,
        }),
      (error) => assertBulkError(error, "BULK_INVALID"),
    );
    assert.equal(
      fixture.records.list({ spaceId: "crm", entity: "companies" }).length,
      0,
    );
    assert.equal(fixture.provenance.listEvents().items.length, 0);
  } finally {
    cleanup(fixture);
  }
});

test("protocol validates bulk preview/execute and rejects malformed digest or oversized count", () => {
  const operation: BulkMutationOperation = {
    operation: "data.record.create",
    payload: {
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "bulk:protocol:item",
      data: { name: "Protocol" },
    },
  };

  assert.doesNotThrow(() =>
    validateBulkPreviewPayload({ operations: [operation] }),
  );
  assert.doesNotThrow(() =>
    validateBulkExecutePayload({
      idempotencyKey: "bulk:protocol:outer",
      expectedPreviewDigest: "a".repeat(64),
      operations: [operation],
    }),
  );

  assert.doesNotThrow(() =>
    validateRequestEnvelope({
      protocol: DATA_PROTOCOL_VERSION,
      requestId: "req_bulk_preview",
      operation: "data.bulk.preview",
      scope: { workspaceId: "sales" },
      actor: human,
      authorization: { mode: "local-operator" },
      payload: { operations: [operation] },
    }),
  );
  assert.doesNotThrow(() =>
    validateRequestEnvelope({
      protocol: DATA_PROTOCOL_VERSION,
      requestId: "req_bulk_execute",
      operation: "data.bulk.execute",
      scope: { workspaceId: "sales" },
      actor: human,
      authorization: { mode: "local-operator" },
      payload: {
        idempotencyKey: "bulk:protocol:outer",
        expectedPreviewDigest: "b".repeat(64),
        operations: [operation],
      },
    }),
  );

  assert.throws(
    () =>
      validateBulkExecutePayload({
        idempotencyKey: "bulk:protocol:bad",
        expectedPreviewDigest: "ABC",
        operations: [operation],
      }),
    (error) => {
      assert.ok(error instanceof DataProtocolValidationError);
      assert.equal(error.code, "PAYLOAD_INVALID");
      return true;
    },
  );

  assert.throws(
    () =>
      validateBulkPreviewPayload({
        operations: Array.from(
          { length: DATA_PROTOCOL_LIMITS.maxBulkOperations + 1 },
          () => operation,
        ),
      }),
    (error) => {
      assert.ok(error instanceof DataProtocolValidationError);
      assert.equal(error.code, "PAYLOAD_INVALID");
      return true;
    },
  );
});
