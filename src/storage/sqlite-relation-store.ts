import type Database from "better-sqlite3";

import type {
  DataRelationStorage,
  StoredRecordRelation,
} from "./relation-store.js";

interface RelationRow {
  readonly source_space_id: string;
  readonly source_entity_id: string;
  readonly source_record_id: string;
  readonly field_name: string;
  readonly target_space_id: string;
  readonly target_entity_id: string;
  readonly target_record_id: string;
}

function mapRelation(row: RelationRow): StoredRecordRelation {
  return {
    sourceSpaceId: row.source_space_id,
    sourceEntity: row.source_entity_id,
    sourceRecordId: row.source_record_id,
    field: row.field_name,
    targetSpaceId: row.target_space_id,
    targetEntity: row.target_entity_id,
    targetRecordId: row.target_record_id,
  };
}

export class SqliteRelationStorage implements DataRelationStorage {
  constructor(private readonly database: Database.Database) {}

  initialize(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS _record_relations (
        source_space_id TEXT NOT NULL,
        source_entity_id TEXT NOT NULL,
        source_record_id TEXT NOT NULL,
        field_name TEXT NOT NULL,
        target_space_id TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        target_record_id TEXT NOT NULL,
        PRIMARY KEY (
          source_space_id,
          source_entity_id,
          source_record_id,
          field_name
        ),
        FOREIGN KEY (
          source_space_id,
          source_entity_id,
          source_record_id
        )
          REFERENCES _records(space_id, entity_id, record_id)
          ON DELETE CASCADE,
        FOREIGN KEY (
          target_space_id,
          target_entity_id,
          target_record_id
        )
          REFERENCES _records(space_id, entity_id, record_id)
          ON DELETE RESTRICT
      ) STRICT, WITHOUT ROWID;

      CREATE INDEX IF NOT EXISTS _record_relations_target_idx
        ON _record_relations(
          target_space_id,
          target_entity_id,
          target_record_id
        );
    `);
  }

  targetExists(
    spaceId: string,
    entity: string,
    recordId: string,
  ): boolean {
    const row = this.database
      .prepare(
        `SELECT 1 AS present
         FROM _records
         WHERE space_id = ?
           AND entity_id = ?
           AND record_id = ?
           AND deleted_at IS NULL
         LIMIT 1`,
      )
      .get(spaceId, entity, recordId) as { present: number } | undefined;
    return row?.present === 1;
  }

  replaceSourceRelations(
    spaceId: string,
    entity: string,
    recordId: string,
    relations: readonly StoredRecordRelation[],
  ): void {
    this.deleteSourceRelations(spaceId, entity, recordId);
    if (relations.length === 0) return;

    const insert = this.database.prepare(
      `INSERT INTO _record_relations (
        source_space_id,
        source_entity_id,
        source_record_id,
        field_name,
        target_space_id,
        target_entity_id,
        target_record_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const relation of relations) {
      insert.run(
        relation.sourceSpaceId,
        relation.sourceEntity,
        relation.sourceRecordId,
        relation.field,
        relation.targetSpaceId,
        relation.targetEntity,
        relation.targetRecordId,
      );
    }
  }

  deleteSourceRelations(
    spaceId: string,
    entity: string,
    recordId: string,
  ): void {
    this.database
      .prepare(
        `DELETE FROM _record_relations
         WHERE source_space_id = ?
           AND source_entity_id = ?
           AND source_record_id = ?`,
      )
      .run(spaceId, entity, recordId);
  }

  listSourceRelations(
    spaceId: string,
    entity: string,
    recordId: string,
  ): readonly StoredRecordRelation[] {
    const rows = this.database
      .prepare(
        `SELECT
           source_space_id,
           source_entity_id,
           source_record_id,
           field_name,
           target_space_id,
           target_entity_id,
           target_record_id
         FROM _record_relations
         WHERE source_space_id = ?
           AND source_entity_id = ?
           AND source_record_id = ?
         ORDER BY field_name ASC`,
      )
      .all(spaceId, entity, recordId) as RelationRow[];
    return rows.map(mapRelation);
  }
  listInboundRelations(
    spaceId: string,
    entity: string,
    recordId: string,
  ): readonly StoredRecordRelation[] {
    const rows = this.database
      .prepare(
        `SELECT
           source_space_id,
           source_entity_id,
           source_record_id,
           field_name,
           target_space_id,
           target_entity_id,
           target_record_id
         FROM _record_relations
         WHERE target_space_id = ?
           AND target_entity_id = ?
           AND target_record_id = ?
         ORDER BY source_space_id, source_entity_id, source_record_id, field_name`,
      )
      .all(spaceId, entity, recordId) as RelationRow[];
    return rows.map(mapRelation);
  }
}
