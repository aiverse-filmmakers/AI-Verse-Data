import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { DataCatalog } from "../src/catalog/index.js";
import { DataProvenance } from "../src/provenance/index.js";
import { DataRecords } from "../src/records/index.js";
import {
  AI_VERSE_DATA_DATABASE_FORMAT_VERSION,
  AI_VERSE_DATA_MIGRATION_FRAMEWORK_VERSION,
  DataStorageError,
  SqliteStorageDriver,
  type StorageDatabaseBinding,
} from "../src/storage/index.js";

const human = { kind: "human", id: "migration-operator" } as const;
const MIGRATION_ID = "sqlite-0001-v1-to-v2";
const MIGRATION_DESCRIPTOR =
  "ai-verse-data/sqlite migration 1->2: internal migration ledger framework v1";
const MIGRATION_DIGEST = createHash("sha256")
  .update(MIGRATION_DESCRIPTOR, "utf8")
  .digest("hex");

const workspaceBinding: StorageDatabaseBinding = {
  bindingVersion: 1,
  kind: "workspace",
  workspaceId: "sales",
};

function withTempDirectory(
  run: (directory: string) => Promise<void> | void,
): Promise<void> | void {
  const directory = mkdtempSync(join(tmpdir(), "ai-verse-data-migration-"));
  const cleanup = (): void => {
    rmSync(directory, { recursive: true, force: true });
  };

  try {
    const result = run(directory);
    if (result instanceof Promise) {
      return result.finally(cleanup);
    }
    cleanup();
  } catch (error) {
    cleanup();
    throw error;
  }
}

function assertStorageError(
  error: unknown,
  expectedCode: DataStorageError["code"],
): boolean {
  assert.ok(error instanceof DataStorageError);
  assert.equal(error.code, expectedCode);
  return true;
}

function downgradeCurrentDatabaseToV1(
  databasePath: string,
  options: { readonly conflictingFramework?: boolean } = {},
): void {
  const raw = new Database(databasePath);
  try {
    raw.exec("DROP TABLE IF EXISTS _schema_migrations;");
    raw
      .prepare(
        "DELETE FROM _aiverse_meta WHERE key = 'migration_framework_version'",
      )
      .run();
    if (options.conflictingFramework === true) {
      raw
        .prepare(
          "INSERT INTO _aiverse_meta (key, value) VALUES ('migration_framework_version', '999')",
        )
        .run();
    }
    raw
      .prepare(
        "UPDATE _aiverse_meta SET value = '1' WHERE key = 'format_version'",
      )
      .run();
    raw.pragma("user_version = 1");
  } finally {
    raw.close();
  }
}

function seedBoundDatabase(
  databasePath: string,
): {
  readonly createInput: Parameters<DataRecords["create"]>[0];
  readonly createResult: ReturnType<DataRecords["create"]>;
  readonly eventCount: number;
} {
  const driver = new SqliteStorageDriver();
  const database = driver.open({
    location: databasePath,
    expectedBinding: workspaceBinding,
  });

  try {
    const catalog = new DataCatalog(database);
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

    const records = new DataRecords(database);
    const createInput = {
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "migration:company:create",
      data: { name: "Acme" },
      actor: human,
    } as const;
    const createResult = records.create(createInput);
    const eventCount = new DataProvenance(database).listEvents().items.length;

    return {
      createInput,
      createResult,
      eventCount,
    };
  } finally {
    database.close();
  }
}

function createInterruptedLedger(databasePath: string): void {
  const raw = new Database(databasePath);
  try {
    raw.exec(`
      CREATE TABLE _schema_migrations (
        migration_id TEXT PRIMARY KEY,
        definition_digest TEXT NOT NULL,
        from_version INTEGER NOT NULL CHECK (from_version >= 1),
        to_version INTEGER NOT NULL CHECK (to_version > from_version),
        state TEXT NOT NULL CHECK (
          state IN ('in_progress', 'failed', 'completed')
        ),
        attempt INTEGER NOT NULL CHECK (attempt >= 1),
        backup_artifact_id TEXT NOT NULL,
        backup_payload_sha256 TEXT NOT NULL,
        backup_manifest_sha256 TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        failed_at TEXT,
        failure_message TEXT
      ) STRICT, WITHOUT ROWID;
    `);

    raw.prepare(
      `INSERT INTO _schema_migrations (
         migration_id,
         definition_digest,
         from_version,
         to_version,
         state,
         attempt,
         backup_artifact_id,
         backup_payload_sha256,
         backup_manifest_sha256,
         started_at,
         completed_at,
         failed_at,
         failure_message
       ) VALUES (?, ?, 1, 2, 'in_progress', 1, ?, ?, ?, ?, NULL, NULL, NULL)`,
    ).run(
      MIGRATION_ID,
      MIGRATION_DIGEST,
      "migration_backup_interrupted",
      "a".repeat(64),
      "b".repeat(64),
      new Date().toISOString(),
    );
  } finally {
    raw.close();
  }
}

test("fresh databases bootstrap directly at format v2 with an empty migration ledger", () => {
  return withTempDirectory((directory) => {
    const databasePath = join(directory, "data.sqlite");
    const driver = new SqliteStorageDriver();
    const database = driver.open({ location: databasePath });

    try {
      assert.equal(
        database.metadata().formatVersion,
        AI_VERSE_DATA_DATABASE_FORMAT_VERSION,
      );
      assert.equal(AI_VERSE_DATA_DATABASE_FORMAT_VERSION, 2);
      assert.equal(
        driver.inspectMigration({ location: databasePath }).state,
        "current",
      );
    } finally {
      database.close();
    }

    const raw = new Database(databasePath, { readonly: true });
    try {
      const framework = raw.prepare(
        "SELECT value FROM _aiverse_meta WHERE key = 'migration_framework_version'",
      ).get() as { readonly value: string };
      assert.equal(
        framework.value,
        String(AI_VERSE_DATA_MIGRATION_FRAMEWORK_VERSION),
      );

      const table = raw.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_schema_migrations'",
      ).get() as { readonly name: string } | undefined;
      assert.equal(table?.name, "_schema_migrations");

      const count = raw.prepare(
        "SELECT count(*) AS count FROM _schema_migrations",
      ).get() as { readonly count: number };
      assert.equal(count.count, 0);
    } finally {
      raw.close();
    }
  });
});

test("legacy format v1 is detected explicitly and normal open refuses automatic migration", () => {
  return withTempDirectory((directory) => {
    const databasePath = join(directory, "data.sqlite");
    const driver = new SqliteStorageDriver();
    const created = driver.open({
      location: databasePath,
      expectedBinding: workspaceBinding,
    });
    created.close();
    downgradeCurrentDatabaseToV1(databasePath);

    const status = driver.inspectMigration({
      location: databasePath,
      expectedBinding: workspaceBinding,
    });
    assert.deepEqual(status, {
      state: "required",
      databaseFormatVersion: 1,
      targetFormatVersion: 2,
      binding: workspaceBinding,
      pendingMigrationIds: [MIGRATION_ID],
      incompleteMigrationIds: [],
    });

    assert.throws(
      () =>
        driver.open({
          location: databasePath,
          mode: "open-existing",
          expectedBinding: workspaceBinding,
        }),
      (error) => assertStorageError(error, "DATABASE_MIGRATION_REQUIRED"),
    );
  });
});

test("explicit v1 to v2 migration creates verified pre-migration backup and preserves canonical state", async () => {
  await withTempDirectory(async (directory) => {
    const databasePath = join(directory, "data.sqlite");
    const backupDirectory = join(directory, "pre-migration-backup");
    const driver = new SqliteStorageDriver();
    const seeded = seedBoundDatabase(databasePath);
    downgradeCurrentDatabaseToV1(databasePath);

    const result = await driver.migrate({
      location: databasePath,
      expectedBinding: workspaceBinding,
      backupDirectory,
    });

    assert.equal(result.state, "migrated");
    assert.equal(result.fromVersion, 1);
    assert.equal(result.toVersion, 2);
    assert.deepEqual(result.migrationIds, [MIGRATION_ID]);
    assert.ok(result.completedAt !== null);
    assert.ok(result.backup !== null);
    assert.equal(result.backup.manifest.source.databaseFormatVersion, 1);
    assert.deepEqual(result.backup.manifest.source.binding, workspaceBinding);
    assert.equal(result.backup.manifest.targetDatabaseFormatVersion, 2);
    assert.match(result.backup.manifest.payload.sha256, /^[0-9a-f]{64}$/);

    assert.deepEqual(
      driver.verifyMigrationBackup({
        artifactDirectory: backupDirectory,
        expectedBinding: workspaceBinding,
      }),
      result.backup,
    );

    const backupRaw = new Database(
      join(backupDirectory, "database.sqlite"),
      { readonly: true },
    );
    try {
      assert.equal(
        backupRaw.pragma("user_version", { simple: true }),
        1,
      );
      const version = backupRaw.prepare(
        "SELECT value FROM _aiverse_meta WHERE key = 'format_version'",
      ).get() as { readonly value: string };
      assert.equal(version.value, "1");
    } finally {
      backupRaw.close();
    }

    const migrated = driver.open({
      location: databasePath,
      mode: "open-existing",
      expectedBinding: workspaceBinding,
    });
    try {
      assert.equal(migrated.metadata().formatVersion, 2);
      assert.deepEqual(migrated.metadata().binding, workspaceBinding);
      assert.deepEqual(
        new DataRecords(migrated).create(seeded.createInput),
        seeded.createResult,
      );
      assert.equal(
        new DataProvenance(migrated).listEvents().items.length,
        seeded.eventCount,
      );
    } finally {
      migrated.close();
    }

    const raw = new Database(databasePath, { readonly: true });
    try {
      const row = raw.prepare(
        `SELECT
           state,
           attempt,
           from_version,
           to_version,
           definition_digest,
           completed_at,
           failed_at
         FROM _schema_migrations
         WHERE migration_id = ?`,
      ).get(MIGRATION_ID) as {
        readonly state: string;
        readonly attempt: number;
        readonly from_version: number;
        readonly to_version: number;
        readonly definition_digest: string;
        readonly completed_at: string | null;
        readonly failed_at: string | null;
      };
      assert.equal(row.state, "completed");
      assert.equal(row.attempt, 1);
      assert.equal(row.from_version, 1);
      assert.equal(row.to_version, 2);
      assert.equal(row.definition_digest, MIGRATION_DIGEST);
      assert.ok(row.completed_at !== null);
      assert.equal(row.failed_at, null);
    } finally {
      raw.close();
    }
  });
});

test("migration rejects a conflicting trusted workspace before creating backup evidence", async () => {
  await withTempDirectory(async (directory) => {
    const databasePath = join(directory, "data.sqlite");
    const backupDirectory = join(directory, "backup");
    const driver = new SqliteStorageDriver();
    const created = driver.open({
      location: databasePath,
      expectedBinding: workspaceBinding,
    });
    created.close();
    downgradeCurrentDatabaseToV1(databasePath);

    await assert.rejects(
      () =>
        driver.migrate({
          location: databasePath,
          expectedBinding: {
            bindingVersion: 1,
            kind: "workspace",
            workspaceId: "other",
          },
          backupDirectory,
        }),
      (error) => assertStorageError(error, "DATABASE_SCOPE_CONFLICT"),
    );
    assert.equal(existsSync(backupDirectory), false);
  });
});

test("tampered pre-migration backup fails verification", async () => {
  await withTempDirectory(async (directory) => {
    const databasePath = join(directory, "data.sqlite");
    const backupDirectory = join(directory, "backup");
    const driver = new SqliteStorageDriver();
    const created = driver.open({ location: databasePath });
    created.close();
    downgradeCurrentDatabaseToV1(databasePath);

    await driver.migrate({
      location: databasePath,
      backupDirectory,
    });

    appendFileSync(
      join(backupDirectory, "database.sqlite"),
      Buffer.from([0]),
    );

    assert.throws(
      () =>
        driver.verifyMigrationBackup({
          artifactDirectory: backupDirectory,
          expectedBinding: null,
        }),
      (error) => assertStorageError(error, "MIGRATION_BACKUP_INVALID"),
    );
  });
});

test("failed migration stays at v1, records durable failure state, blocks open, and can be retried safely", async () => {
  await withTempDirectory(async (directory) => {
    const databasePath = join(directory, "data.sqlite");
    const firstBackup = join(directory, "backup-attempt-1");
    const secondBackup = join(directory, "backup-attempt-2");
    const driver = new SqliteStorageDriver();
    const seeded = seedBoundDatabase(databasePath);
    downgradeCurrentDatabaseToV1(databasePath, {
      conflictingFramework: true,
    });

    await assert.rejects(
      () =>
        driver.migrate({
          location: databasePath,
          expectedBinding: workspaceBinding,
          backupDirectory: firstBackup,
        }),
      (error) => assertStorageError(error, "DATABASE_MIGRATION_FAILED"),
    );

    const rawAfterFailure = new Database(databasePath);
    try {
      const version = rawAfterFailure.prepare(
        "SELECT value FROM _aiverse_meta WHERE key = 'format_version'",
      ).get() as { readonly value: string };
      assert.equal(version.value, "1");
      assert.equal(
        rawAfterFailure.pragma("user_version", { simple: true }),
        1,
      );

      const row = rawAfterFailure.prepare(
        "SELECT state, attempt, failed_at, completed_at FROM _schema_migrations WHERE migration_id = ?",
      ).get(MIGRATION_ID) as {
        readonly state: string;
        readonly attempt: number;
        readonly failed_at: string | null;
        readonly completed_at: string | null;
      };
      assert.equal(row.state, "failed");
      assert.equal(row.attempt, 1);
      assert.ok(row.failed_at !== null);
      assert.equal(row.completed_at, null);

      rawAfterFailure
        .prepare(
          "DELETE FROM _aiverse_meta WHERE key = 'migration_framework_version'",
        )
        .run();
    } finally {
      rawAfterFailure.close();
    }

    assert.equal(
      driver.inspectMigration({
        location: databasePath,
        expectedBinding: workspaceBinding,
      }).state,
      "incomplete",
    );
    assert.throws(
      () =>
        driver.open({
          location: databasePath,
          mode: "open-existing",
          expectedBinding: workspaceBinding,
        }),
      (error) => assertStorageError(error, "DATABASE_MIGRATION_INCOMPLETE"),
    );

    const retried = await driver.migrate({
      location: databasePath,
      expectedBinding: workspaceBinding,
      backupDirectory: secondBackup,
    });
    assert.equal(retried.state, "migrated");

    const opened = driver.open({
      location: databasePath,
      mode: "open-existing",
      expectedBinding: workspaceBinding,
    });
    try {
      assert.deepEqual(
        new DataRecords(opened).create(seeded.createInput),
        seeded.createResult,
      );
    } finally {
      opened.close();
    }

    const rawAfterRetry = new Database(databasePath, { readonly: true });
    try {
      const row = rawAfterRetry.prepare(
        "SELECT state, attempt, completed_at, failed_at FROM _schema_migrations WHERE migration_id = ?",
      ).get(MIGRATION_ID) as {
        readonly state: string;
        readonly attempt: number;
        readonly completed_at: string | null;
        readonly failed_at: string | null;
      };
      assert.equal(row.state, "completed");
      assert.equal(row.attempt, 2);
      assert.ok(row.completed_at !== null);
      assert.equal(row.failed_at, null);
    } finally {
      rawAfterRetry.close();
    }
  });
});

test("interrupted in-progress ledger blocks normal use and explicit retry resumes transactionally", async () => {
  await withTempDirectory(async (directory) => {
    const databasePath = join(directory, "data.sqlite");
    const backupDirectory = join(directory, "resume-backup");
    const driver = new SqliteStorageDriver();
    const created = driver.open({ location: databasePath });
    created.close();
    downgradeCurrentDatabaseToV1(databasePath);
    createInterruptedLedger(databasePath);

    const status = driver.inspectMigration({ location: databasePath });
    assert.equal(status.state, "incomplete");
    assert.deepEqual(status.incompleteMigrationIds, [MIGRATION_ID]);

    assert.throws(
      () =>
        driver.open({
          location: databasePath,
          mode: "open-existing",
        }),
      (error) => assertStorageError(error, "DATABASE_MIGRATION_INCOMPLETE"),
    );

    const result = await driver.migrate({
      location: databasePath,
      backupDirectory,
    });
    assert.equal(result.state, "migrated");

    const raw = new Database(databasePath, { readonly: true });
    try {
      const row = raw.prepare(
        "SELECT state, attempt FROM _schema_migrations WHERE migration_id = ?",
      ).get(MIGRATION_ID) as {
        readonly state: string;
        readonly attempt: number;
      };
      assert.equal(row.state, "completed");
      assert.equal(row.attempt, 2);
    } finally {
      raw.close();
    }
  });
});

test("migration refuses to reuse an existing backup destination before canonical mutation", async () => {
  await withTempDirectory(async (directory) => {
    const databasePath = join(directory, "data.sqlite");
    const backupDirectory = join(directory, "existing-backup");
    const driver = new SqliteStorageDriver();
    const created = driver.open({ location: databasePath });
    created.close();
    downgradeCurrentDatabaseToV1(databasePath);

    mkdirSync(backupDirectory);
    writeFileSync(join(backupDirectory, "sentinel.txt"), "keep", "utf8");

    await assert.rejects(
      () =>
        driver.migrate({
          location: databasePath,
          backupDirectory,
        }),
      (error) => assertStorageError(error, "MIGRATION_BACKUP_EXISTS"),
    );
    assert.equal(
      readFileSync(join(backupDirectory, "sentinel.txt"), "utf8"),
      "keep",
    );

    const raw = new Database(databasePath, { readonly: true });
    try {
      assert.equal(raw.pragma("user_version", { simple: true }), 1);
      const ledger = raw.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_schema_migrations'",
      ).get();
      assert.equal(ledger, undefined);
    } finally {
      raw.close();
    }
  });
});

test("already-current migrate is a no-op and does not create backup artifacts", async () => {
  await withTempDirectory(async (directory) => {
    const databasePath = join(directory, "data.sqlite");
    const backupDirectory = join(directory, "should-not-exist");
    const driver = new SqliteStorageDriver();
    const created = driver.open({ location: databasePath });
    created.close();

    const result = await driver.migrate({
      location: databasePath,
      backupDirectory,
    });

    assert.deepEqual(result, {
      state: "already-current",
      fromVersion: 2,
      toVersion: 2,
      migrationIds: [],
      backup: null,
      completedAt: null,
    });
    assert.equal(existsSync(backupDirectory), false);
  });
});

test("newer database formats remain fail-closed for open and migration inspection", () => {
  return withTempDirectory((directory) => {
    const databasePath = join(directory, "data.sqlite");
    const driver = new SqliteStorageDriver();
    const created = driver.open({ location: databasePath });
    created.close();

    const raw = new Database(databasePath);
    try {
      raw
        .prepare(
          "UPDATE _aiverse_meta SET value = '999' WHERE key = 'format_version'",
        )
        .run();
      raw.pragma("user_version = 999");
    } finally {
      raw.close();
    }

    assert.throws(
      () => driver.inspectMigration({ location: databasePath }),
      (error) => assertStorageError(error, "DATABASE_VERSION_UNSUPPORTED"),
    );
    assert.throws(
      () =>
        driver.open({
          location: databasePath,
          mode: "open-existing",
        }),
      (error) => assertStorageError(error, "DATABASE_VERSION_UNSUPPORTED"),
    );
  });
});


test("current-format incomplete ledger blocks migrate and does not create a misleading backup", async () => {
  await withTempDirectory(async (directory) => {
    const databasePath = join(directory, "data.sqlite");
    const backupDirectory = join(directory, "should-not-exist");
    const driver = new SqliteStorageDriver();
    const created = driver.open({ location: databasePath });
    created.close();

    const raw = new Database(databasePath);
    try {
      raw.prepare(
        `INSERT INTO _schema_migrations (
           migration_id,
           definition_digest,
           from_version,
           to_version,
           state,
           attempt,
           backup_artifact_id,
           backup_payload_sha256,
           backup_manifest_sha256,
           started_at,
           completed_at,
           failed_at,
           failure_message
         ) VALUES (?, ?, 1, 2, 'in_progress', 1, ?, ?, ?, ?, NULL, NULL, NULL)`,
      ).run(
        MIGRATION_ID,
        MIGRATION_DIGEST,
        "migration_backup_impossible_current",
        "c".repeat(64),
        "d".repeat(64),
        new Date().toISOString(),
      );
    } finally {
      raw.close();
    }

    assert.equal(
      driver.inspectMigration({ location: databasePath }).state,
      "incomplete",
    );

    await assert.rejects(
      () =>
        driver.migrate({
          location: databasePath,
          backupDirectory,
        }),
      (error) => assertStorageError(error, "DATABASE_MIGRATION_INCOMPLETE"),
    );
    assert.equal(existsSync(backupDirectory), false);

    assert.throws(
      () =>
        driver.open({
          location: databasePath,
          mode: "open-existing",
        }),
      (error) => assertStorageError(error, "DATABASE_MIGRATION_INCOMPLETE"),
    );
  });
});
