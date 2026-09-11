import type Database from "better-sqlite3";

import type { DataRecordStorage, StoredRecord } from "./record-store.js";

interface RecordRow {
  readonly space_id: string;
  readonly entity_id: string;
  readonly record_id: string;
  readonly schema_version: number;
  readonly record_version: number;
  readonly data_json: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly created_actor_kind: string;
  readonly created_actor_id: string;
  readonly updated_actor_kind: string;
  readonly updated_actor_id: string;
  readonly deleted_at: string | null;
  readonly deleted_reason: string | null;
  readonly deleted_actor_kind: string | null;
  readonly deleted_actor_id: string | null;
}

function mapRecord(row: RecordRow): StoredRecord {
  return {
    spaceId: row.space_id,
    entity: row.entity_id,
    recordId: row.record_id,
    schemaVersion: row.schema_version,
    version: row.record_version,
    dataJson: row.data_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdActorKind: row.created_actor_kind,
    createdActorId: row.created_actor_id,
    updatedActorKind: row.updated_actor_kind,
    updatedActorId: row.updated_actor_id,
    deletedAt: row.deleted_at,
    deletedReason: row.deleted_reason,
    deletedActorKind: row.deleted_actor_kind,
    deletedActorId: row.deleted_actor_id,
  };
}

const SELECT_RECORD = `
  SELECT
    space_id,
    entity_id,
    record_id,
    schema_version,
    record_version,
    data_json,
    created_at,
    updated_at,
    created_actor_kind,
    created_actor_id,
    updated_actor_kind,
    updated_actor_id,
    deleted_at,
    deleted_reason,
    deleted_actor_kind,
    deleted_actor_id
  FROM _records
`;

export class SqliteRecordStorage implements DataRecordStorage {
  constructor(
    private readonly database: Database.Database,
    private readonly assertWritable: () => void = () => {},
  ) {}

  initialize(): void {
    this.assertWritable();
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS _records (
        space_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        record_id TEXT NOT NULL,
        schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
        record_version INTEGER NOT NULL CHECK (record_version >= 1),
        data_json TEXT NOT NULL CHECK (json_valid(data_json)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_actor_kind TEXT NOT NULL CHECK (
          created_actor_kind IN (
            'human', 'bot', 'worker', 'app', 'automation',
            'system', 'import', 'connection'
          )
        ),
        created_actor_id TEXT NOT NULL,
        updated_actor_kind TEXT NOT NULL CHECK (
          updated_actor_kind IN (
            'human', 'bot', 'worker', 'app', 'automation',
            'system', 'import', 'connection'
          )
        ),
        updated_actor_id TEXT NOT NULL,
        deleted_at TEXT,
        deleted_reason TEXT,
        deleted_actor_kind TEXT CHECK (
          deleted_actor_kind IS NULL OR deleted_actor_kind IN (
            'human', 'bot', 'worker', 'app', 'automation',
            'system', 'import', 'connection'
          )
        ),
        deleted_actor_id TEXT,
        PRIMARY KEY (space_id, entity_id, record_id),
        FOREIGN KEY (space_id, entity_id, schema_version)
          REFERENCES _entity_schema_versions(space_id, entity_id, schema_version)
          ON DELETE RESTRICT,
        CHECK (
          (deleted_at IS NULL AND deleted_actor_kind IS NULL AND deleted_actor_id IS NULL AND deleted_reason IS NULL)
          OR
          (deleted_at IS NOT NULL AND deleted_actor_kind IS NOT NULL AND deleted_actor_id IS NOT NULL)
        )
      ) STRICT, WITHOUT ROWID;

      CREATE INDEX IF NOT EXISTS _records_entity_active_idx
        ON _records(space_id, entity_id, deleted_at, created_at, record_id);
    `);
  }

  createRecord(record: StoredRecord): boolean {
    this.assertWritable();
    const result = this.database
      .prepare(
        `INSERT INTO _records (
          space_id,
          entity_id,
          record_id,
          schema_version,
          record_version,
          data_json,
          created_at,
          updated_at,
          created_actor_kind,
          created_actor_id,
          updated_actor_kind,
          updated_actor_id,
          deleted_at,
          deleted_reason,
          deleted_actor_kind,
          deleted_actor_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(space_id, entity_id, record_id) DO NOTHING`,
      )
      .run(
        record.spaceId,
        record.entity,
        record.recordId,
        record.schemaVersion,
        record.version,
        record.dataJson,
        record.createdAt,
        record.updatedAt,
        record.createdActorKind,
        record.createdActorId,
        record.updatedActorKind,
        record.updatedActorId,
        record.deletedAt,
        record.deletedReason,
        record.deletedActorKind,
        record.deletedActorId,
      );
    return result.changes === 1;
  }

  getRecord(
    spaceId: string,
    entity: string,
    recordId: string,
    includeDeleted = false,
  ): StoredRecord | null {
    const row = this.database
      .prepare(
        `${SELECT_RECORD}
         WHERE space_id = ?
           AND entity_id = ?
           AND record_id = ?
           ${includeDeleted ? "" : "AND deleted_at IS NULL"}`,
      )
      .get(spaceId, entity, recordId) as RecordRow | undefined;
    return row === undefined ? null : mapRecord(row);
  }

  listRecords(
    spaceId: string,
    entity: string,
    limit: number,
    includeDeleted = false,
    offset = 0,
  ): readonly StoredRecord[] {
    const rows = this.database
      .prepare(
        `${SELECT_RECORD}
         WHERE space_id = ?
           AND entity_id = ?
           ${includeDeleted ? "" : "AND deleted_at IS NULL"}
         ORDER BY created_at ASC, record_id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(spaceId, entity, limit, offset) as RecordRow[];
    return rows.map(mapRecord);
  }

  updateRecord(record: StoredRecord, expectedVersion: number): boolean {
    this.assertWritable();
    const result = this.database
      .prepare(
        `UPDATE _records
         SET schema_version = ?,
             record_version = ?,
             data_json = ?,
             updated_at = ?,
             updated_actor_kind = ?,
             updated_actor_id = ?
         WHERE space_id = ?
           AND entity_id = ?
           AND record_id = ?
           AND record_version = ?
           AND deleted_at IS NULL`,
      )
      .run(
        record.schemaVersion,
        record.version,
        record.dataJson,
        record.updatedAt,
        record.updatedActorKind,
        record.updatedActorId,
        record.spaceId,
        record.entity,
        record.recordId,
        expectedVersion,
      );
    return result.changes === 1;
  }

  softDeleteRecord(record: StoredRecord, expectedVersion: number): boolean {
    this.assertWritable();
    const result = this.database
      .prepare(
        `UPDATE _records
         SET record_version = ?,
             updated_at = ?,
             updated_actor_kind = ?,
             updated_actor_id = ?,
             deleted_at = ?,
             deleted_reason = ?,
             deleted_actor_kind = ?,
             deleted_actor_id = ?
         WHERE space_id = ?
           AND entity_id = ?
           AND record_id = ?
           AND record_version = ?
           AND deleted_at IS NULL`,
      )
      .run(
        record.version,
        record.updatedAt,
        record.updatedActorKind,
        record.updatedActorId,
        record.deletedAt,
        record.deletedReason,
        record.deletedActorKind,
        record.deletedActorId,
        record.spaceId,
        record.entity,
        record.recordId,
        expectedVersion,
      );
    return result.changes === 1;
  }
}
