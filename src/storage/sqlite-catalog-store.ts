import type Database from "better-sqlite3";

import type {
  CatalogCreateSchemaResult,
  CatalogUpdateSchemaResult,
  DataCatalogStorage,
  StoredCurrentEntitySchema,
  StoredDataSpace,
  StoredEntitySchemaVersion,
} from "./catalog-store.js";

interface DataSpaceRow {
  readonly space_id: string;
  readonly name: string;
  readonly description: string | null;
  readonly authority: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface SchemaVersionRow {
  readonly space_id: string;
  readonly entity_id: string;
  readonly schema_version: number;
  readonly schema_digest: string;
  readonly definition_json: string;
  readonly created_at: string;
}

interface CurrentSchemaRow extends SchemaVersionRow {
  readonly entity_created_at: string;
  readonly entity_updated_at: string;
}

interface CountRow {
  readonly count: number;
}

interface CurrentVersionRow {
  readonly current_version: number;
}

function mapSpace(row: DataSpaceRow): StoredDataSpace {
  return {
    spaceId: row.space_id,
    name: row.name,
    description: row.description,
    authority: row.authority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSchema(row: SchemaVersionRow): StoredEntitySchemaVersion {
  return {
    spaceId: row.space_id,
    entity: row.entity_id,
    schemaVersion: row.schema_version,
    schemaDigest: row.schema_digest,
    definitionJson: row.definition_json,
    createdAt: row.created_at,
  };
}

function mapCurrentSchema(row: CurrentSchemaRow): StoredCurrentEntitySchema {
  return {
    ...mapSchema(row),
    entityCreatedAt: row.entity_created_at,
    entityUpdatedAt: row.entity_updated_at,
  };
}

export class SqliteCatalogStorage implements DataCatalogStorage {
  constructor(
    private readonly database: Database.Database,
    private readonly assertWritable: () => void = () => {},
  ) {}

  initialize(): void {
    this.assertWritable();
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS _data_spaces (
        space_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        authority TEXT NOT NULL CHECK (authority = 'local_canonical'),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS _entities (
        space_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        current_version INTEGER NOT NULL CHECK (current_version >= 1),
        current_digest TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (space_id, entity_id),
        FOREIGN KEY (space_id)
          REFERENCES _data_spaces(space_id)
          ON DELETE RESTRICT
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS _entity_schema_versions (
        space_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
        schema_digest TEXT NOT NULL,
        definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
        created_at TEXT NOT NULL,
        PRIMARY KEY (space_id, entity_id, schema_version),
        FOREIGN KEY (space_id, entity_id)
          REFERENCES _entities(space_id, entity_id)
          ON DELETE CASCADE
      ) STRICT, WITHOUT ROWID;

      CREATE INDEX IF NOT EXISTS _entity_schema_versions_digest_idx
        ON _entity_schema_versions(schema_digest);
    `);
  }

  createSpace(space: StoredDataSpace): boolean {
    this.assertWritable();
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO _data_spaces
          (space_id, name, description, authority, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        space.spaceId,
        space.name,
        space.description,
        space.authority,
        space.createdAt,
        space.updatedAt,
      );
    return result.changes === 1;
  }

  listSpaces(): readonly StoredDataSpace[] {
    const rows = this.database
      .prepare(
        `SELECT space_id, name, description, authority, created_at, updated_at
         FROM _data_spaces
         ORDER BY space_id`,
      )
      .all() as DataSpaceRow[];
    return rows.map(mapSpace);
  }

  getSpace(spaceId: string): StoredDataSpace | null {
    const row = this.database
      .prepare(
        `SELECT space_id, name, description, authority, created_at, updated_at
         FROM _data_spaces
         WHERE space_id = ?`,
      )
      .get(spaceId) as DataSpaceRow | undefined;
    return row === undefined ? null : mapSpace(row);
  }

  countSchemas(spaceId: string): number {
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM _entities
         WHERE space_id = ?`,
      )
      .get(spaceId) as CountRow;
    return row.count;
  }

  createSchema(schema: StoredEntitySchemaVersion): CatalogCreateSchemaResult {
    this.assertWritable();
    const transaction = this.database.transaction((): CatalogCreateSchemaResult => {
      const space = this.database
        .prepare("SELECT 1 FROM _data_spaces WHERE space_id = ?")
        .get(schema.spaceId);
      if (space === undefined) return { status: "space_missing" };

      const existing = this.database
        .prepare(
          "SELECT current_version FROM _entities WHERE space_id = ? AND entity_id = ?",
        )
        .get(schema.spaceId, schema.entity) as CurrentVersionRow | undefined;
      if (existing !== undefined) return { status: "entity_exists" };

      this.database
        .prepare(
          `INSERT INTO _entities
            (space_id, entity_id, current_version, current_digest, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          schema.spaceId,
          schema.entity,
          schema.schemaVersion,
          schema.schemaDigest,
          schema.createdAt,
          schema.createdAt,
        );

      this.database
        .prepare(
          `INSERT INTO _entity_schema_versions
            (space_id, entity_id, schema_version, schema_digest, definition_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          schema.spaceId,
          schema.entity,
          schema.schemaVersion,
          schema.schemaDigest,
          schema.definitionJson,
          schema.createdAt,
        );

      const created = this.getCurrentSchema(schema.spaceId, schema.entity);
      if (created === null) {
        throw new Error("Created entity schema could not be read back.");
      }
      return { status: "created", schema: created };
    });

    return transaction();
  }

  listCurrentSchemas(spaceId: string): readonly StoredCurrentEntitySchema[] {
    const rows = this.database
      .prepare(
        `SELECT
            v.space_id,
            v.entity_id,
            v.schema_version,
            v.schema_digest,
            v.definition_json,
            v.created_at,
            e.created_at AS entity_created_at,
            e.updated_at AS entity_updated_at
         FROM _entities e
         JOIN _entity_schema_versions v
           ON v.space_id = e.space_id
          AND v.entity_id = e.entity_id
          AND v.schema_version = e.current_version
         WHERE e.space_id = ?
         ORDER BY e.entity_id`,
      )
      .all(spaceId) as CurrentSchemaRow[];
    return rows.map(mapCurrentSchema);
  }

  getCurrentSchema(
    spaceId: string,
    entity: string,
  ): StoredCurrentEntitySchema | null {
    const row = this.database
      .prepare(
        `SELECT
            v.space_id,
            v.entity_id,
            v.schema_version,
            v.schema_digest,
            v.definition_json,
            v.created_at,
            e.created_at AS entity_created_at,
            e.updated_at AS entity_updated_at
         FROM _entities e
         JOIN _entity_schema_versions v
           ON v.space_id = e.space_id
          AND v.entity_id = e.entity_id
          AND v.schema_version = e.current_version
         WHERE e.space_id = ? AND e.entity_id = ?`,
      )
      .get(spaceId, entity) as CurrentSchemaRow | undefined;
    return row === undefined ? null : mapCurrentSchema(row);
  }

  getSchemaVersion(
    spaceId: string,
    entity: string,
    version: number,
  ): StoredEntitySchemaVersion | null {
    const row = this.database
      .prepare(
        `SELECT
            space_id,
            entity_id,
            schema_version,
            schema_digest,
            definition_json,
            created_at
         FROM _entity_schema_versions
         WHERE space_id = ? AND entity_id = ? AND schema_version = ?`,
      )
      .get(spaceId, entity, version) as SchemaVersionRow | undefined;
    return row === undefined ? null : mapSchema(row);
  }

  listSchemaVersions(
    spaceId: string,
    entity: string,
  ): readonly StoredEntitySchemaVersion[] {
    const rows = this.database
      .prepare(
        `SELECT
            space_id,
            entity_id,
            schema_version,
            schema_digest,
            definition_json,
            created_at
         FROM _entity_schema_versions
         WHERE space_id = ? AND entity_id = ?
         ORDER BY schema_version ASC`,
      )
      .all(spaceId, entity) as SchemaVersionRow[];
    return rows.map(mapSchema);
  }

  updateSchema(
    expectedVersion: number,
    schema: StoredEntitySchemaVersion,
  ): CatalogUpdateSchemaResult {
    this.assertWritable();
    const transaction = this.database.transaction((): CatalogUpdateSchemaResult => {
      const current = this.database
        .prepare(
          "SELECT current_version FROM _entities WHERE space_id = ? AND entity_id = ?",
        )
        .get(schema.spaceId, schema.entity) as CurrentVersionRow | undefined;

      if (current === undefined) return { status: "entity_missing" };
      if (current.current_version !== expectedVersion) {
        return {
          status: "version_conflict",
          currentVersion: current.current_version,
        };
      }

      const updated = this.database
        .prepare(
          `UPDATE _entities
           SET current_version = ?, current_digest = ?, updated_at = ?
           WHERE space_id = ? AND entity_id = ? AND current_version = ?`,
        )
        .run(
          schema.schemaVersion,
          schema.schemaDigest,
          schema.createdAt,
          schema.spaceId,
          schema.entity,
          expectedVersion,
        );

      if (updated.changes !== 1) {
        const latest = this.database
          .prepare(
            "SELECT current_version FROM _entities WHERE space_id = ? AND entity_id = ?",
          )
          .get(schema.spaceId, schema.entity) as CurrentVersionRow | undefined;
        if (latest === undefined) return { status: "entity_missing" };
        return {
          status: "version_conflict",
          currentVersion: latest.current_version,
        };
      }

      this.database
        .prepare(
          `INSERT INTO _entity_schema_versions
            (space_id, entity_id, schema_version, schema_digest, definition_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          schema.spaceId,
          schema.entity,
          schema.schemaVersion,
          schema.schemaDigest,
          schema.definitionJson,
          schema.createdAt,
        );

      const stored = this.getCurrentSchema(schema.spaceId, schema.entity);
      if (stored === null) {
        throw new Error("Updated entity schema could not be read back.");
      }
      return { status: "updated", schema: stored };
    });

    return transaction();
  }
}
