import type Database from "better-sqlite3";

import { DataStorageError } from "./errors.js";
import type {
  DataEventListQuery,
  DataProvenanceStorage,
  StoredDataEvent,
  StoredDataEventInput,
  StoredMutationReceipt,
} from "./provenance-store.js";

interface EventRow {
  readonly event_sequence: number;
  readonly event_id: string;
  readonly event_type: StoredDataEvent["eventType"];
  readonly operation: string;
  readonly request_id: string;
  readonly transaction_id: string | null;
  readonly scope_kind: StoredDataEvent["scopeKind"];
  readonly workspace_id: string | null;
  readonly idempotency_key: string;
  readonly space_id: string | null;
  readonly entity: string | null;
  readonly record_id: string | null;
  readonly before_version: number | null;
  readonly after_version: number | null;
  readonly actor_kind: string;
  readonly actor_id: string;
  readonly committed_at: string;
  readonly details_json: string;
  readonly event_digest: string;
}

interface ReceiptRow {
  readonly receipt_id: string;
  readonly event_id: string;
  readonly operation: string;
  readonly request_id: string;
  readonly transaction_id: string | null;
  readonly scope_kind: StoredMutationReceipt["scopeKind"];
  readonly workspace_id: string | null;
  readonly idempotency_key: string;
  readonly space_id: string | null;
  readonly entity: string | null;
  readonly record_id: string | null;
  readonly before_version: number | null;
  readonly after_version: number | null;
  readonly actor_kind: string;
  readonly actor_id: string;
  readonly committed_at: string;
  readonly receipt_digest: string;
}

function mapEvent(row: EventRow): StoredDataEvent {
  return {
    sequence: row.event_sequence,
    eventId: row.event_id,
    eventType: row.event_type,
    operation: row.operation,
    requestId: row.request_id,
    transactionId: row.transaction_id,
    scopeKind: row.scope_kind,
    workspaceId: row.workspace_id,
    idempotencyKey: row.idempotency_key,
    spaceId: row.space_id,
    entity: row.entity,
    recordId: row.record_id,
    beforeVersion: row.before_version,
    afterVersion: row.after_version,
    actorKind: row.actor_kind,
    actorId: row.actor_id,
    committedAt: row.committed_at,
    detailsJson: row.details_json,
    eventDigest: row.event_digest,
  };
}

function mapReceipt(row: ReceiptRow): StoredMutationReceipt {
  return {
    receiptId: row.receipt_id,
    eventId: row.event_id,
    operation: row.operation,
    requestId: row.request_id,
    transactionId: row.transaction_id,
    scopeKind: row.scope_kind,
    workspaceId: row.workspace_id,
    idempotencyKey: row.idempotency_key,
    spaceId: row.space_id,
    entity: row.entity,
    recordId: row.record_id,
    beforeVersion: row.before_version,
    afterVersion: row.after_version,
    actorKind: row.actor_kind,
    actorId: row.actor_id,
    committedAt: row.committed_at,
    receiptDigest: row.receipt_digest,
  };
}

const EVENT_SELECT = `
  SELECT
    event_sequence,
    event_id,
    event_type,
    operation,
    request_id,
    transaction_id,
    scope_kind,
    workspace_id,
    idempotency_key,
    space_id,
    entity,
    record_id,
    before_version,
    after_version,
    actor_kind,
    actor_id,
    committed_at,
    details_json,
    event_digest
  FROM _events
`;

const RECEIPT_SELECT = `
  SELECT
    receipt_id,
    event_id,
    operation,
    request_id,
    transaction_id,
    scope_kind,
    workspace_id,
    idempotency_key,
    space_id,
    entity,
    record_id,
    before_version,
    after_version,
    actor_kind,
    actor_id,
    committed_at,
    receipt_digest
  FROM _mutation_receipts
`;

export class SqliteProvenanceStorage implements DataProvenanceStorage {
  constructor(
    private readonly database: Database.Database,
    private readonly assertWritable: () => void = () => {},
  ) {}

  initialize(): void {
    this.assertWritable();
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS _events (
        event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL CHECK (
          event_type IN ('record.created', 'record.updated', 'record.deleted', 'transaction.committed')
        ),
        operation TEXT NOT NULL CHECK (
          operation IN ('data.record.create', 'data.record.update', 'data.record.delete', 'data.transaction.execute')
        ),
        request_id TEXT NOT NULL,
        transaction_id TEXT,
        scope_kind TEXT NOT NULL CHECK (scope_kind IN ('unbound', 'standalone', 'workspace')),
        workspace_id TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,
        space_id TEXT,
        entity TEXT,
        record_id TEXT,
        before_version INTEGER CHECK (before_version IS NULL OR before_version >= 1),
        after_version INTEGER CHECK (after_version IS NULL OR after_version >= 1),
        actor_kind TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        committed_at TEXT NOT NULL,
        details_json TEXT NOT NULL CHECK (json_valid(details_json)),
        event_digest TEXT NOT NULL CHECK (length(event_digest) = 64),
        CHECK (
          (scope_kind = 'unbound' AND workspace_id IS NULL)
          OR
          (scope_kind IN ('standalone', 'workspace') AND workspace_id IS NOT NULL)
        )
      ) STRICT;

      CREATE INDEX IF NOT EXISTS _events_scope_idx
        ON _events(space_id, entity, record_id, event_sequence);

      CREATE INDEX IF NOT EXISTS _events_transaction_idx
        ON _events(transaction_id, event_sequence);

      CREATE TABLE IF NOT EXISTS _mutation_receipts (
        receipt_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE,
        operation TEXT NOT NULL CHECK (
          operation IN ('data.record.create', 'data.record.update', 'data.record.delete', 'data.transaction.execute')
        ),
        request_id TEXT NOT NULL,
        transaction_id TEXT,
        scope_kind TEXT NOT NULL CHECK (scope_kind IN ('unbound', 'standalone', 'workspace')),
        workspace_id TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,
        space_id TEXT,
        entity TEXT,
        record_id TEXT,
        before_version INTEGER CHECK (before_version IS NULL OR before_version >= 1),
        after_version INTEGER CHECK (after_version IS NULL OR after_version >= 1),
        actor_kind TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        committed_at TEXT NOT NULL,
        receipt_digest TEXT NOT NULL CHECK (length(receipt_digest) = 64),
        FOREIGN KEY (event_id) REFERENCES _events(event_id) ON DELETE RESTRICT,
        CHECK (
          (scope_kind = 'unbound' AND workspace_id IS NULL)
          OR
          (scope_kind IN ('standalone', 'workspace') AND workspace_id IS NOT NULL)
        )
      ) STRICT, WITHOUT ROWID;

      CREATE INDEX IF NOT EXISTS _receipts_transaction_idx
        ON _mutation_receipts(transaction_id, committed_at, receipt_id);

      CREATE TRIGGER IF NOT EXISTS _events_no_update
      BEFORE UPDATE ON _events
      BEGIN
        SELECT RAISE(ABORT, 'AI-Verse Data events are immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS _events_no_delete
      BEFORE DELETE ON _events
      BEGIN
        SELECT RAISE(ABORT, 'AI-Verse Data events are immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS _receipts_no_update
      BEFORE UPDATE ON _mutation_receipts
      BEGIN
        SELECT RAISE(ABORT, 'AI-Verse Data receipts are immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS _receipts_no_delete
      BEFORE DELETE ON _mutation_receipts
      BEGIN
        SELECT RAISE(ABORT, 'AI-Verse Data receipts are immutable');
      END;
    `);
  }

  append(
    event: StoredDataEventInput,
    receipt: StoredMutationReceipt,
  ): StoredDataEvent {
    this.assertWritable();
    const result = this.database
      .prepare(`
        INSERT INTO _events (
          event_id,
          event_type,
          operation,
          request_id,
          transaction_id,
          scope_kind,
          workspace_id,
          idempotency_key,
          space_id,
          entity,
          record_id,
          before_version,
          after_version,
          actor_kind,
          actor_id,
          committed_at,
          details_json,
          event_digest
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        event.eventId,
        event.eventType,
        event.operation,
        event.requestId,
        event.transactionId,
        event.scopeKind,
        event.workspaceId,
        event.idempotencyKey,
        event.spaceId,
        event.entity,
        event.recordId,
        event.beforeVersion,
        event.afterVersion,
        event.actorKind,
        event.actorId,
        event.committedAt,
        event.detailsJson,
        event.eventDigest,
      );

    const sequence = Number(result.lastInsertRowid);
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new DataStorageError(
        "DATABASE_CORRUPT",
        "SQLite did not return a valid event sequence.",
      );
    }

    this.database
      .prepare(`
        INSERT INTO _mutation_receipts (
          receipt_id,
          event_id,
          operation,
          request_id,
          transaction_id,
          scope_kind,
          workspace_id,
          idempotency_key,
          space_id,
          entity,
          record_id,
          before_version,
          after_version,
          actor_kind,
          actor_id,
          committed_at,
          receipt_digest
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        receipt.receiptId,
        receipt.eventId,
        receipt.operation,
        receipt.requestId,
        receipt.transactionId,
        receipt.scopeKind,
        receipt.workspaceId,
        receipt.idempotencyKey,
        receipt.spaceId,
        receipt.entity,
        receipt.recordId,
        receipt.beforeVersion,
        receipt.afterVersion,
        receipt.actorKind,
        receipt.actorId,
        receipt.committedAt,
        receipt.receiptDigest,
      );

    return {
      ...event,
      sequence,
    };
  }

  listEvents(query: DataEventListQuery): readonly StoredDataEvent[] {
    const clauses = ["event_sequence > ?"];
    const parameters: Array<string | number> = [query.afterSequence];

    if (query.spaceId !== undefined) {
      clauses.push("space_id = ?");
      parameters.push(query.spaceId);
    }
    if (query.entity !== undefined) {
      clauses.push("entity = ?");
      parameters.push(query.entity);
    }
    if (query.recordId !== undefined) {
      clauses.push("record_id = ?");
      parameters.push(query.recordId);
    }

    parameters.push(query.limit);

    const rows = this.database
      .prepare(
        `${EVENT_SELECT}
         WHERE ${clauses.join(" AND ")}
         ORDER BY event_sequence ASC
         LIMIT ?`,
      )
      .all(...parameters) as EventRow[];

    return rows.map(mapEvent);
  }

  getEvent(eventId: string): StoredDataEvent | null {
    const row = this.database
      .prepare(`${EVENT_SELECT} WHERE event_id = ?`)
      .get(eventId) as EventRow | undefined;
    return row === undefined ? null : mapEvent(row);
  }

  getReceipt(receiptId: string): StoredMutationReceipt | null {
    const row = this.database
      .prepare(`${RECEIPT_SELECT} WHERE receipt_id = ?`)
      .get(receiptId) as ReceiptRow | undefined;
    return row === undefined ? null : mapReceipt(row);
  }

  getReceiptByEventId(eventId: string): StoredMutationReceipt | null {
    const row = this.database
      .prepare(`${RECEIPT_SELECT} WHERE event_id = ?`)
      .get(eventId) as ReceiptRow | undefined;
    return row === undefined ? null : mapReceipt(row);
  }

  getReceiptByIdempotencyKey(
    idempotencyKey: string,
  ): StoredMutationReceipt | null {
    const row = this.database
      .prepare(`${RECEIPT_SELECT} WHERE idempotency_key = ?`)
      .get(idempotencyKey) as ReceiptRow | undefined;
    return row === undefined ? null : mapReceipt(row);
  }

  listReceiptsByTransactionId(
    transactionId: string,
  ): readonly StoredMutationReceipt[] {
    const rows = this.database
      .prepare(
        `SELECT
           r.receipt_id,
           r.event_id,
           r.operation,
           r.request_id,
           r.transaction_id,
           r.scope_kind,
           r.workspace_id,
           r.idempotency_key,
           r.space_id,
           r.entity,
           r.record_id,
           r.before_version,
           r.after_version,
           r.actor_kind,
           r.actor_id,
           r.committed_at,
           r.receipt_digest
         FROM _mutation_receipts AS r
         JOIN _events AS e ON e.event_id = r.event_id
         WHERE r.transaction_id = ?
         ORDER BY e.event_sequence ASC`,
      )
      .all(transactionId) as ReceiptRow[];
    return rows.map(mapReceipt);
  }
}
