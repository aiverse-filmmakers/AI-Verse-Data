import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { DataCatalog } from "../src/catalog/index.js";
import {
  DataProvenance,
  DataProvenanceError,
} from "../src/provenance/index.js";
import {
  DATA_PROTOCOL_VERSION,
  DataProtocolValidationError,
  validateRequestEnvelope,
} from "../src/protocol/index.js";
import { DataRecords } from "../src/records/index.js";
import {
  TrustedDataRoot,
  createWorkspaceDataScope,
  openScopedDataDatabase,
} from "../src/scope/index.js";
import {
  SqliteStorageDriver,
  type DataStorageDatabase,
} from "../src/storage/index.js";
import {
  DataTransactions,
} from "../src/transactions/index.js";

const human = { kind: "human", id: "operator" } as const;
const bot = { kind: "bot", id: "writer-bot" } as const;

interface Fixture {
  readonly directory: string;
  readonly databasePath: string;
  readonly database: DataStorageDatabase;
  readonly catalog: DataCatalog;
  readonly records: DataRecords;
  readonly provenance: DataProvenance;
  readonly transactions: DataTransactions;
  close(): void;
}

function bootstrap(catalog: DataCatalog): void {
  catalog.createSpace({
    spaceId: "crm",
    name: "CRM",
    authority: "local_canonical",
  });
  catalog.createSchema({
    spaceId: "crm",
    entity: "items",
    name: "Items",
    fields: {
      name: { type: "string", required: true },
      value: { type: "number" },
    },
  });
}

function openFixture(): Fixture {
  const directory = mkdtempSync(join(tmpdir(), "ai-verse-data-provenance-"));
  const databasePath = join(directory, "data.sqlite");
  const database = new SqliteStorageDriver().open({ location: databasePath });
  const catalog = new DataCatalog(database);
  const records = new DataRecords(database);
  const provenance = new DataProvenance(database);
  const transactions = new DataTransactions(database);
  bootstrap(catalog);
  let closed = false;

  return {
    directory,
    databasePath,
    database,
    catalog,
    records,
    provenance,
    transactions,
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

function assertProvenanceError(
  error: unknown,
  code: DataProvenanceError["code"],
): boolean {
  assert.ok(error instanceof DataProvenanceError);
  assert.equal(error.code, code);
  return true;
}

test("createWithReceipt persists one immutable event and one durable receipt", () => {
  const fixture = openFixture();
  try {
    const result = fixture.records.createWithReceipt({
      spaceId: "crm",
      entity: "items",
      idempotencyKey: "prov:create:one",
      requestId: "req_create_one",
      data: { name: "Alpha", value: 10 },
      actor: human,
    });

    assert.match(result.record.recordId, /^rec_[a-f0-9]{32}$/);
    assert.match(result.receipt.receiptId, /^rcpt_[A-Za-z0-9_-]+$/);
    assert.match(result.receipt.eventId, /^evt_[A-Za-z0-9_-]+$/);
    assert.equal(result.receipt.operation, "data.record.create");
    assert.equal(result.receipt.requestId, "req_create_one");
    assert.equal(result.receipt.transactionId, null);
    assert.equal(result.receipt.scopeKind, "unbound");
    assert.equal(result.receipt.workspaceId, null);
    assert.equal(result.receipt.idempotencyKey, "prov:create:one");
    assert.equal(result.receipt.spaceId, "crm");
    assert.equal(result.receipt.entity, "items");
    assert.equal(result.receipt.recordId, result.record.recordId);
    assert.equal(result.receipt.beforeVersion, null);
    assert.equal(result.receipt.afterVersion, 1);
    assert.deepEqual(result.receipt.actor, human);
    assert.equal(result.receipt.committedAt, result.record.createdAt);

    const events = fixture.provenance.listEvents({
      spaceId: "crm",
      entity: "items",
    });
    assert.equal(events.items.length, 1);
    assert.equal(events.hasMore, false);
    assert.equal(events.nextCursor, null);
    const event = events.items[0]!;
    assert.equal(event.eventId, result.receipt.eventId);
    assert.equal(event.eventType, "record.created");
    assert.equal(event.operation, "data.record.create");
    assert.equal(event.requestId, "req_create_one");
    assert.equal(event.recordId, result.record.recordId);
    assert.deepEqual(event.actor, human);
    assert.deepEqual(event.details, { schemaVersion: 1 });

    assert.deepEqual(
      fixture.provenance.getReceipt({
        receiptId: result.receipt.receiptId,
      }),
      result.receipt,
    );
    assert.deepEqual(
      fixture.provenance.getReceiptByIdempotencyKey({
        idempotencyKey: "prov:create:one",
      }),
      result.receipt,
    );

    const raw = new Database(fixture.databasePath, { readonly: true });
    try {
      const row = raw.prepare(
        "SELECT details_json FROM _events WHERE event_id = ?",
      ).get(event.eventId) as { details_json: string };
      assert.equal(row.details_json.includes("Alpha"), false);
      assert.equal(row.details_json.includes("10"), false);
      assert.deepEqual(JSON.parse(row.details_json), { schemaVersion: 1 });
    } finally {
      raw.close();
    }
  } finally {
    cleanup(fixture);
  }
});

test("workspace-scoped provenance persists trusted workspace identity", () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-verse-data-prov-scope-"));
  const workspaceData = join(directory, "workspaces", "sales", "data");
  mkdirSync(workspaceData, { recursive: true });

  try {
    const root = TrustedDataRoot.fromExistingDirectory(directory);
    const scope = createWorkspaceDataScope(root, "sales");
    const opened = openScopedDataDatabase(
      new SqliteStorageDriver(),
      scope,
    );
    try {
      const catalog = new DataCatalog(opened.database);
      const records = new DataRecords(opened.database);
      bootstrap(catalog);

      const result = records.createWithReceipt({
        spaceId: "crm",
        entity: "items",
        idempotencyKey: "prov:scope:create",
        data: { name: "Scoped" },
        actor: human,
      });

      assert.equal(result.receipt.scopeKind, "workspace");
      assert.equal(result.receipt.workspaceId, "sales");
      assert.equal(
        new DataProvenance(opened.database).listEvents().items[0]!.workspaceId,
        "sales",
      );
    } finally {
      opened.database.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("create update and delete produce ordered version-aware actor provenance", () => {
  const fixture = openFixture();
  try {
    const created = fixture.records.create({
      spaceId: "crm",
      entity: "items",
      idempotencyKey: "prov:sequence:create",
      data: { name: "Sequence", value: 1 },
      actor: human,
    });
    const updated = fixture.records.updateWithReceipt({
      spaceId: "crm",
      entity: "items",
      recordId: created.recordId,
      expectedVersion: 1,
      idempotencyKey: "prov:sequence:update",
      patch: { value: 2 },
      actor: bot,
    });
    const deleted = fixture.records.softDeleteWithReceipt({
      spaceId: "crm",
      entity: "items",
      recordId: created.recordId,
      expectedVersion: 2,
      idempotencyKey: "prov:sequence:delete",
      reason: "complete",
      actor: bot,
    });

    assert.equal(updated.receipt.beforeVersion, 1);
    assert.equal(updated.receipt.afterVersion, 2);
    assert.deepEqual(updated.receipt.actor, bot);
    assert.equal(deleted.receipt.beforeVersion, 2);
    assert.equal(deleted.receipt.afterVersion, 3);
    assert.deepEqual(deleted.receipt.actor, bot);

    const events = fixture.provenance.listEvents({
      spaceId: "crm",
      entity: "items",
      recordId: created.recordId,
    }).items;
    assert.deepEqual(
      events.map((event) => event.eventType),
      ["record.created", "record.updated", "record.deleted"],
    );
    assert.deepEqual(
      events.map((event) => [event.beforeVersion, event.afterVersion]),
      [[null, 1], [1, 2], [2, 3]],
    );
    assert.deepEqual(events.map((event) => event.actor), [human, bot, bot]);
    assert.deepEqual(events[2]!.details, {
      reason: "complete",
      schemaVersion: 1,
    });
  } finally {
    cleanup(fixture);
  }
});

test("event pagination uses opaque query-bound cursors", () => {
  const fixture = openFixture();
  try {
    for (let index = 0; index < 3; index += 1) {
      fixture.records.create({
        spaceId: "crm",
        entity: "items",
        idempotencyKey: `prov:page:${index}`,
        data: { name: `Item ${index}` },
        actor: human,
      });
    }

    const first = fixture.provenance.listEvents({
      spaceId: "crm",
      entity: "items",
      limit: 2,
    });
    assert.equal(first.items.length, 2);
    assert.equal(first.hasMore, true);
    assert.match(first.nextCursor ?? "", /^evc_/);

    const second = fixture.provenance.listEvents({
      spaceId: "crm",
      entity: "items",
      limit: 2,
      after: first.nextCursor,
    });
    assert.equal(second.items.length, 1);
    assert.equal(second.hasMore, false);
    assert.equal(second.nextCursor, null);

    assert.throws(
      () =>
        fixture.provenance.listEvents({
          spaceId: "crm",
          limit: 2,
          after: first.nextCursor,
        }),
      (error) => assertProvenanceError(error, "QUERY_INVALID"),
    );
  } finally {
    cleanup(fixture);
  }
});

test("event filter hierarchy rejects ambiguous entity or record queries", () => {
  const fixture = openFixture();
  try {
    assert.throws(
      () => fixture.provenance.listEvents({ entity: "items" }),
      (error) => assertProvenanceError(error, "QUERY_INVALID"),
    );
    assert.throws(
      () => fixture.provenance.listEvents({ recordId: "rec_missing" }),
      (error) => assertProvenanceError(error, "QUERY_INVALID"),
    );
  } finally {
    cleanup(fixture);
  }
});

test("idempotent replay returns the original receipt and does not duplicate provenance", () => {
  const fixture = openFixture();
  try {
    const input = {
      spaceId: "crm",
      entity: "items",
      idempotencyKey: "prov:replay:create",
      data: { name: "Replay", value: 1 },
      actor: human,
    } as const;

    const first = fixture.records.createWithReceipt({
      ...input,
      requestId: "req_first_delivery",
    });
    const replay = fixture.records.createWithReceipt({
      ...input,
      requestId: "req_second_delivery",
    });

    assert.deepEqual(replay.record, first.record);
    assert.deepEqual(replay.receipt, first.receipt);
    assert.equal(replay.receipt.requestId, "req_first_delivery");
    assert.equal(fixture.provenance.listEvents().items.length, 1);

    const raw = new Database(fixture.databasePath, { readonly: true });
    try {
      const eventCount = raw.prepare(
        "SELECT count(*) AS count FROM _events",
      ).get() as { count: number };
      const receiptCount = raw.prepare(
        "SELECT count(*) AS count FROM _mutation_receipts",
      ).get() as { count: number };
      assert.equal(eventCount.count, 1);
      assert.equal(receiptCount.count, 1);
    } finally {
      raw.close();
    }
  } finally {
    cleanup(fixture);
  }
});

test("bounded transaction links nested receipts and one final transaction event atomically", () => {
  const fixture = openFixture();
  try {
    const transaction = fixture.transactions.executeWithReceipt({
      actor: human,
      requestId: "req_transaction_one",
      payload: {
        idempotencyKey: "prov:txn:outer",
        operations: [
          {
            operation: "data.record.create",
            payload: {
              spaceId: "crm",
              entity: "items",
              idempotencyKey: "prov:txn:create:one",
              clientRef: "first",
              data: { name: "One", value: 1 },
            },
          },
          {
            operation: "data.record.create",
            payload: {
              spaceId: "crm",
              entity: "items",
              idempotencyKey: "prov:txn:create:two",
              data: { name: "Two", value: 2 },
            },
          },
        ],
      },
    });

    assert.equal(transaction.result.operations.length, 2);
    assert.equal(transaction.receipt.operation, "data.transaction.execute");
    assert.equal(transaction.receipt.requestId, "req_transaction_one");
    assert.match(transaction.receipt.transactionId ?? "", /^txn_/);
    assert.equal(transaction.receipt.spaceId, null);
    assert.equal(transaction.receipt.entity, null);
    assert.equal(transaction.receipt.recordId, null);
    assert.equal(transaction.receipt.beforeVersion, null);
    assert.equal(transaction.receipt.afterVersion, null);

    const events = fixture.provenance.listEvents().items;
    assert.deepEqual(
      events.map((event) => event.eventType),
      ["record.created", "record.created", "transaction.committed"],
    );
    const transactionId = transaction.receipt.transactionId!;
    assert.ok(events.every((event) => event.transactionId === transactionId));
    assert.ok(events.every((event) => event.requestId === "req_transaction_one"));

    const childEvents = events.slice(0, 2);
    const outerEvent = events[2]!;
    const receipts = fixture.provenance.listTransactionReceipts({
      transactionId,
    });
    assert.equal(receipts.length, 3);
    assert.deepEqual(
      receipts.map((receipt) => receipt.eventId),
      events.map((event) => event.eventId),
    );
    assert.equal(receipts[2]!.receiptId, transaction.receipt.receiptId);
    assert.deepEqual(outerEvent.details, {
      childEventIds: childEvents.map((event) => event.eventId),
      childReceiptIds: receipts.slice(0, 2).map((receipt) => receipt.receiptId),
      operationCount: 2,
    });

    const spaceEvents = fixture.provenance.listEvents({
      spaceId: "crm",
    }).items;
    assert.equal(spaceEvents.length, 2);
    assert.ok(spaceEvents.every((event) => event.eventType === "record.created"));
  } finally {
    cleanup(fixture);
  }
});

test("transaction idempotent replay does not mint new child or outer audit facts", () => {
  const fixture = openFixture();
  try {
    const payload = {
      idempotencyKey: "prov:txn:replay:outer",
      operations: [
        {
          operation: "data.record.create" as const,
          payload: {
            spaceId: "crm",
            entity: "items",
            idempotencyKey: "prov:txn:replay:child",
            data: { name: "Replay child" },
          },
        },
      ],
    };

    const first = fixture.transactions.executeWithReceipt({
      actor: human,
      requestId: "req_txn_first",
      payload,
    });
    const replay = fixture.transactions.executeWithReceipt({
      actor: human,
      requestId: "req_txn_retry",
      payload,
    });

    assert.deepEqual(replay.result, first.result);
    assert.deepEqual(replay.receipt, first.receipt);
    assert.equal(replay.receipt.requestId, "req_txn_first");
    assert.equal(fixture.provenance.listEvents().items.length, 2);
    assert.equal(
      fixture.provenance.listTransactionReceipts({
        transactionId: first.receipt.transactionId!,
      }).length,
      2,
    );
  } finally {
    cleanup(fixture);
  }
});

test("fresh transaction cannot adopt a previously committed nested idempotency key", () => {
  const fixture = openFixture();
  try {
    const existing = fixture.records.createWithReceipt({
      spaceId: "crm",
      entity: "items",
      idempotencyKey: "prov:adoption:existing",
      requestId: "req_existing_mutation",
      data: { name: "Existing" },
      actor: human,
    });

    assert.throws(
      () =>
        fixture.transactions.execute({
          actor: human,
          requestId: "req_new_transaction",
          payload: {
            idempotencyKey: "prov:adoption:outer",
            operations: [
              {
                operation: "data.record.create",
                payload: {
                  spaceId: "crm",
                  entity: "items",
                  idempotencyKey: "prov:adoption:existing",
                  data: { name: "Existing" },
                },
              },
            ],
          },
        }),
      /outside this fresh transaction/,
    );

    const records = fixture.records.list({
      spaceId: "crm",
      entity: "items",
    });
    assert.equal(records.length, 1);
    assert.equal(records[0]!.recordId, existing.record.recordId);

    const events = fixture.provenance.listEvents().items;
    assert.equal(events.length, 1);
    assert.equal(events[0]!.eventId, existing.receipt.eventId);

    assert.throws(
      () =>
        fixture.provenance.getReceiptByIdempotencyKey({
          idempotencyKey: "prov:adoption:outer",
        }),
      (error) => assertProvenanceError(error, "RECEIPT_NOT_FOUND"),
    );
  } finally {
    cleanup(fixture);
  }
});

test("transaction rejects duplicate nested keys and outer-key reuse before mutation", () => {
  const fixture = openFixture();
  try {
    assert.throws(
      () =>
        fixture.transactions.execute({
          actor: human,
          payload: {
            idempotencyKey: "prov:duplicate:outer",
            operations: [
              {
                operation: "data.record.create",
                payload: {
                  spaceId: "crm",
                  entity: "items",
                  idempotencyKey: "prov:duplicate:key",
                  data: { name: "One" },
                },
              },
              {
                operation: "data.record.create",
                payload: {
                  spaceId: "crm",
                  entity: "items",
                  idempotencyKey: "prov:duplicate:key",
                  data: { name: "Two" },
                },
              },
            ],
          },
        }),
      /Duplicate nested idempotency key/,
    );

    assert.throws(
      () =>
        fixture.transactions.execute({
          actor: human,
          payload: {
            idempotencyKey: "prov:same:key",
            operations: [
              {
                operation: "data.record.create",
                payload: {
                  spaceId: "crm",
                  entity: "items",
                  idempotencyKey: "prov:same:key",
                  data: { name: "Same" },
                },
              },
            ],
          },
        }),
      /outer idempotency key must differ/,
    );

    assert.equal(
      fixture.records.list({ spaceId: "crm", entity: "items" }).length,
      0,
    );
    assert.equal(fixture.provenance.listEvents().items.length, 0);
  } finally {
    cleanup(fixture);
  }
});

test("failed direct mutation leaves no event or receipt", () => {
  const fixture = openFixture();
  try {
    assert.throws(() =>
      fixture.records.create({
        spaceId: "crm",
        entity: "items",
        idempotencyKey: "prov:failed:create",
        data: { value: 1 },
        actor: human,
      }),
    );

    assert.equal(fixture.provenance.listEvents().items.length, 0);
    assert.throws(
      () =>
        fixture.provenance.getReceiptByIdempotencyKey({
          idempotencyKey: "prov:failed:create",
        }),
      (error) => assertProvenanceError(error, "RECEIPT_NOT_FOUND"),
    );
  } finally {
    cleanup(fixture);
  }
});

test("failed bounded transaction rolls back record, nested provenance, and outer provenance", () => {
  const fixture = openFixture();
  try {
    assert.throws(() =>
      fixture.transactions.execute({
        actor: human,
        payload: {
          idempotencyKey: "prov:failed:txn:outer",
          operations: [
            {
              operation: "data.record.create",
              payload: {
                spaceId: "crm",
                entity: "items",
                idempotencyKey: "prov:failed:txn:first",
                data: { name: "First" },
              },
            },
            {
              operation: "data.record.create",
              payload: {
                spaceId: "crm",
                entity: "items",
                idempotencyKey: "prov:failed:txn:bad",
                data: { value: 2 },
              },
            },
          ],
        },
      }),
    );

    assert.equal(
      fixture.records.list({ spaceId: "crm", entity: "items" }).length,
      0,
    );
    assert.equal(fixture.provenance.listEvents().items.length, 0);
    for (const key of [
      "prov:failed:txn:outer",
      "prov:failed:txn:first",
      "prov:failed:txn:bad",
    ]) {
      assert.throws(
        () =>
          fixture.provenance.getReceiptByIdempotencyKey({
            idempotencyKey: key,
          }),
        (error) => assertProvenanceError(error, "RECEIPT_NOT_FOUND"),
      );
    }
  } finally {
    cleanup(fixture);
  }
});

test("SQLite triggers make events and receipts append-only", () => {
  const fixture = openFixture();
  try {
    const result = fixture.records.createWithReceipt({
      spaceId: "crm",
      entity: "items",
      idempotencyKey: "prov:immutable",
      data: { name: "Immutable" },
      actor: human,
    });

    const raw = new Database(fixture.databasePath);
    try {
      assert.throws(
        () =>
          raw.prepare(
            "UPDATE _events SET actor_id = 'changed' WHERE event_id = ?",
          ).run(result.receipt.eventId),
        /AI-Verse Data events are immutable/,
      );
      assert.throws(
        () =>
          raw.prepare(
            "DELETE FROM _mutation_receipts WHERE receipt_id = ?",
          ).run(result.receipt.receiptId),
        /AI-Verse Data receipts are immutable/,
      );
    } finally {
      raw.close();
    }

    assert.equal(fixture.provenance.listEvents().items.length, 1);
    assert.deepEqual(
      fixture.provenance.getReceipt({
        receiptId: result.receipt.receiptId,
      }),
      result.receipt,
    );
  } finally {
    cleanup(fixture);
  }
});

test("tampered stored event digest fails closed as database corruption", () => {
  const fixture = openFixture();
  let eventId = "";
  try {
    const result = fixture.records.createWithReceipt({
      spaceId: "crm",
      entity: "items",
      idempotencyKey: "prov:tamper:event",
      data: { name: "Tamper event" },
      actor: human,
    });
    eventId = result.receipt.eventId;
    fixture.close();

    const raw = new Database(fixture.databasePath);
    try {
      raw.exec("DROP TRIGGER _events_no_update");
      raw.prepare(
        "UPDATE _events SET event_digest = ? WHERE event_id = ?",
      ).run("0".repeat(64), eventId);
    } finally {
      raw.close();
    }

    const reopened = new SqliteStorageDriver().open({
      location: fixture.databasePath,
      mode: "open-existing",
    });
    try {
      const provenance = new DataProvenance(reopened);
      assert.throws(
        () => provenance.listEvents(),
        (error) => assertProvenanceError(error, "DATABASE_CORRUPT"),
      );
    } finally {
      reopened.close();
    }
  } finally {
    cleanup(fixture);
  }
});

test("tampered stored receipt digest fails closed as database corruption", () => {
  const fixture = openFixture();
  let receiptId = "";
  try {
    const result = fixture.records.createWithReceipt({
      spaceId: "crm",
      entity: "items",
      idempotencyKey: "prov:tamper:receipt",
      data: { name: "Tamper receipt" },
      actor: human,
    });
    receiptId = result.receipt.receiptId;
    fixture.close();

    const raw = new Database(fixture.databasePath);
    try {
      raw.exec("DROP TRIGGER _receipts_no_update");
      raw.prepare(
        "UPDATE _mutation_receipts SET receipt_digest = ? WHERE receipt_id = ?",
      ).run("f".repeat(64), receiptId);
    } finally {
      raw.close();
    }

    const reopened = new SqliteStorageDriver().open({
      location: fixture.databasePath,
      mode: "open-existing",
    });
    try {
      const provenance = new DataProvenance(reopened);
      assert.throws(
        () => provenance.getReceipt({ receiptId }),
        (error) => assertProvenanceError(error, "DATABASE_CORRUPT"),
      );
    } finally {
      reopened.close();
    }
  } finally {
    cleanup(fixture);
  }
});

test("protocol accepts workspace-wide event queries and rejects ambiguous nested filters", () => {
  const base = {
    protocol: DATA_PROTOCOL_VERSION,
    requestId: "req_events_query",
    operation: "data.events.list" as const,
    scope: { workspaceId: "sales" },
    actor: human,
    authorization: { mode: "local-operator" as const },
  };

  assert.doesNotThrow(() =>
    validateRequestEnvelope({
      ...base,
      payload: {},
    }),
  );
  assert.doesNotThrow(() =>
    validateRequestEnvelope({
      ...base,
      payload: {
        spaceId: "crm",
        entity: "items",
        recordId: "rec_example",
        after: null,
        limit: 50,
      },
    }),
  );

  assert.throws(
    () =>
      validateRequestEnvelope({
        ...base,
        payload: { entity: "items" },
      }),
    (error) => {
      assert.ok(error instanceof DataProtocolValidationError);
      assert.equal(error.code, "PAYLOAD_INVALID");
      return true;
    },
  );
});
