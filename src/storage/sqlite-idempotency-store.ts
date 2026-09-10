import type Database from "better-sqlite3";

import { DataStorageError } from "./errors.js";
import {
  AI_VERSE_DATA_IDEMPOTENCY_FINGERPRINT_VERSION,
  type DataIdempotencyStorage,
  type StoredIdempotencyEntry,
} from "./idempotency-store.js";

interface IdempotencyRow {
  readonly idempotency_key: string;
  readonly operation: string;
  readonly fingerprint_version: number;
  readonly request_fingerprint: string;
  readonly result_json: string;
  readonly result_digest: string;
  readonly created_at: string;
}

function mapEntry(row: IdempotencyRow): StoredIdempotencyEntry {
  if (
    row.fingerprint_version !== AI_VERSE_DATA_IDEMPOTENCY_FINGERPRINT_VERSION
  ) {
    throw new DataStorageError(
      "DATABASE_CORRUPT",
      `Unsupported idempotency fingerprint version ${row.fingerprint_version}.`,
    );
  }

  if (
    row.idempotency_key.length < 1 ||
    row.idempotency_key.length > 256 ||
    row.idempotency_key.includes("\u0000") ||
    row.operation.length < 1 ||
    !/^[0-9a-f]{64}$/.test(row.request_fingerprint) ||
    !/^[0-9a-f]{64}$/.test(row.result_digest) ||
    Number.isNaN(Date.parse(row.created_at))
  ) {
    throw new DataStorageError(
      "DATABASE_CORRUPT",
      "Stored idempotency metadata is invalid.",
    );
  }

  return {
    idempotencyKey: row.idempotency_key,
    operation: row.operation,
    fingerprintVersion: AI_VERSE_DATA_IDEMPOTENCY_FINGERPRINT_VERSION,
    requestFingerprint: row.request_fingerprint,
    resultJson: row.result_json,
    resultDigest: row.result_digest,
    createdAt: row.created_at,
  };
}

export class SqliteIdempotencyStorage implements DataIdempotencyStorage {
  constructor(private readonly database: Database.Database) {}

  initialize(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS _idempotency (
        idempotency_key TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        fingerprint_version INTEGER NOT NULL CHECK (fingerprint_version = 1),
        request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint) = 64),
        result_json TEXT NOT NULL CHECK (json_valid(result_json)),
        result_digest TEXT NOT NULL CHECK (length(result_digest) = 64),
        created_at TEXT NOT NULL
      ) STRICT, WITHOUT ROWID;

      CREATE INDEX IF NOT EXISTS _idempotency_created_idx
        ON _idempotency(created_at, idempotency_key);
    `);
  }

  get(idempotencyKey: string): StoredIdempotencyEntry | null {
    const row = this.database
      .prepare(
        `SELECT
           idempotency_key,
           operation,
           fingerprint_version,
           request_fingerprint,
           result_json,
           result_digest,
           created_at
         FROM _idempotency
         WHERE idempotency_key = ?`,
      )
      .get(idempotencyKey) as IdempotencyRow | undefined;

    return row === undefined ? null : mapEntry(row);
  }

  create(entry: StoredIdempotencyEntry): boolean {
    const result = this.database
      .prepare(
        `INSERT INTO _idempotency (
           idempotency_key,
           operation,
           fingerprint_version,
           request_fingerprint,
           result_json,
           result_digest,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(idempotency_key) DO NOTHING`,
      )
      .run(
        entry.idempotencyKey,
        entry.operation,
        entry.fingerprintVersion,
        entry.requestFingerprint,
        entry.resultJson,
        entry.resultDigest,
        entry.createdAt,
      );

    return result.changes === 1;
  }
}
