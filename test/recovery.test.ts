import assert from "node:assert/strict";
import {
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

import { DataBackup } from "../src/backup/index.js";
import { DataCatalog } from "../src/catalog/index.js";
import { DataRecovery, DataRecoveryError } from "../src/recovery/index.js";
import { DataRecords } from "../src/records/index.js";
import {
  TrustedDataRoot,
  createWorkspaceDataScope,
  openScopedDataDatabase,
  type DataDatabaseScope,
  type ScopedDatabaseHandle,
} from "../src/scope/index.js";
import {
  DataStorageError,
  SqliteStorageDriver,
  quarantineMarkerPath,
  readQuarantineMarker,
} from "../src/storage/index.js";

const human = { kind: "human", id: "operator" } as const;

function newWorkspaceRoot(workspaceId = "sales"): {
  readonly rootPath: string;
  readonly scope: DataDatabaseScope;
} {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-recovery-root-"));
  const root = TrustedDataRoot.fromExistingDirectory(rootPath);
  return {
    rootPath,
    scope: createWorkspaceDataScope(root, workspaceId),
  };
}

function openFresh(
  driver: SqliteStorageDriver,
  scope: DataDatabaseScope,
): ScopedDatabaseHandle {
  mkdirSync(
    join(
      scope.root.canonicalPath,
      "workspaces",
      scope.workspaceId,
      "data",
    ),
    { recursive: true },
  );
  return openScopedDataDatabase(driver, scope);
}

function seed(
  driver: SqliteStorageDriver,
  scope: DataDatabaseScope,
): ScopedDatabaseHandle {
  const handle = openFresh(driver, scope);
  const catalog = new DataCatalog(handle.database);
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
    },
  });
  new DataRecords(handle.database).create({
    spaceId: "crm",
    entity: "items",
    idempotencyKey: "recovery:seed",
    data: { name: "Canonical" },
    actor: human,
  });
  return handle;
}

function assertStorageError(
  error: unknown,
  code: DataStorageError["code"],
): boolean {
  assert.ok(error instanceof DataStorageError);
  assert.equal(error.code, code);
  return true;
}

function assertRecoveryError(
  error: unknown,
  code: DataRecoveryError["code"],
): boolean {
  assert.ok(error instanceof DataRecoveryError);
  assert.equal(error.code, code);
  return true;
}

function corruptEventDigest(databasePath: string): void {
  const raw = new Database(databasePath);
  try {
    raw.exec("DROP TRIGGER IF EXISTS _events_no_update");
    raw.prepare(
      "UPDATE _events SET event_digest = ? WHERE event_sequence = 1",
    ).run("0".repeat(64));
  } finally {
    raw.close();
  }
}

test("existing empty canonical file is never silently bootstrapped as fresh Data", () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-verse-data-empty-existing-"));
  const databasePath = join(directory, "data.sqlite");
  writeFileSync(databasePath, Buffer.alloc(0));
  const driver = new SqliteStorageDriver();

  try {
    assert.throws(
      () =>
        driver.open({
          location: databasePath,
          mode: "create-or-open",
        }),
      (error) => assertStorageError(error, "DATABASE_FORMAT_UNRECOGNIZED"),
    );
    assert.equal(readFileSync(databasePath).length, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("healthy canonical state reports writable health and semantic summary", async () => {
  const driver = new SqliteStorageDriver();
  const fixture = newWorkspaceRoot();
  const handle = seed(driver, fixture.scope);
  handle.database.close();

  try {
    const report = await new DataRecovery(driver).inspect({
      source: fixture.scope,
    });
    assert.equal(report.state, "healthy");
    assert.equal(report.writable, true);
    assert.equal(report.corruption, null);
    assert.equal(report.quarantine, null);
    assert.equal(report.migration?.state, "current");
    assert.equal(report.stateSummary?.spaceCount, 1);
    assert.equal(report.stateSummary?.recordCount, 1);
    assert.equal(report.stateSummary?.eventCount, 1);
  } finally {
    rmSync(fixture.rootPath, { recursive: true, force: true });
  }
});

test("physical corruption is quarantined without modifying the corrupted database bytes", async () => {
  const driver = new SqliteStorageDriver();
  const fixture = newWorkspaceRoot();
  const handle = seed(driver, fixture.scope);
  handle.database.close();

  const corrupted = Buffer.from("not-a-sqlite-database-but-preserve-me", "utf8");
  writeFileSync(fixture.scope.databasePath(), corrupted);

  try {
    const report = await new DataRecovery(driver).inspect({
      source: fixture.scope,
    });
    assert.equal(report.state, "quarantined");
    assert.equal(report.writable, false);
    assert.equal(report.corruption?.category, "physical");
    assert.equal(report.quarantine?.category, "physical");
    assert.deepEqual(readFileSync(fixture.scope.databasePath()), corrupted);
    assert.equal(existsSync(quarantineMarkerPath(fixture.scope.databasePath())), true);

    assert.throws(
      () =>
        openScopedDataDatabase(driver, fixture.scope, {
          mode: "open-existing",
        }),
      (error) => assertStorageError(error, "DATABASE_QUARANTINED"),
    );
  } finally {
    rmSync(fixture.rootPath, { recursive: true, force: true });
  }
});

test("semantic corruption creates durable quarantine and blocks writes on an already-open handle", async () => {
  const driver = new SqliteStorageDriver();
  const fixture = newWorkspaceRoot();
  const handle = seed(driver, fixture.scope);
  const catalog = new DataCatalog(handle.database);
  const records = new DataRecords(handle.database);

  try {
    corruptEventDigest(fixture.scope.databasePath());

    const report = await new DataRecovery(driver).inspect({
      source: fixture.scope,
    });
    assert.equal(report.state, "quarantined");
    assert.equal(report.corruption?.category, "semantic");
    assert.equal(report.quarantine?.category, "semantic");

    assert.throws(
      () =>
        records.create({
          spaceId: "crm",
          entity: "items",
          idempotencyKey: "recovery:blocked-record",
          data: { name: "Blocked" },
          actor: human,
        }),
      (error) => assertStorageError(error, "DATABASE_QUARANTINED"),
    );

    assert.throws(
      () =>
        catalog.createSpace({
          spaceId: "blocked",
          name: "Blocked",
          authority: "local_canonical",
        }),
      (error) => assertStorageError(error, "DATABASE_QUARANTINED"),
    );

    assert.equal(
      readQuarantineMarker(fixture.scope.databasePath())?.category,
      "semantic",
    );
  } finally {
    handle.database.close();
    rmSync(fixture.rootPath, { recursive: true, force: true });
  }
});

test("lost canonical record storage is detected from surviving committed evidence", async () => {
  const driver = new SqliteStorageDriver();
  const fixture = newWorkspaceRoot();
  const handle = seed(driver, fixture.scope);
  handle.database.close();

  const raw = new Database(fixture.scope.databasePath());
  try {
    raw.pragma("foreign_keys = OFF");
    raw.exec("DROP TABLE _record_relations");
    raw.exec("DROP TABLE _records");
  } finally {
    raw.close();
  }

  try {
    const report = await new DataRecovery(driver).inspect({
      source: fixture.scope,
    });
    assert.equal(report.state, "quarantined");
    assert.equal(report.corruption?.category, "semantic");
    assert.match(
      report.corruption?.message ?? "",
      /canonical record.*missing|references a canonical record that is missing/i,
    );
    assert.equal(
      readQuarantineMarker(fixture.scope.databasePath())?.category,
      "semantic",
    );
  } finally {
    rmSync(fixture.rootPath, { recursive: true, force: true });
  }
});

test("migration-required state is reported separately and does not create corruption quarantine", async () => {
  const driver = new SqliteStorageDriver();
  const fixture = newWorkspaceRoot();
  const handle = seed(driver, fixture.scope);
  handle.database.close();

  const raw = new Database(fixture.scope.databasePath());
  try {
    raw.prepare(
      "UPDATE _aiverse_meta SET value = '1' WHERE key = 'format_version'",
    ).run();
    raw.prepare(
      "DELETE FROM _aiverse_meta WHERE key = 'migration_framework_version'",
    ).run();
    raw.pragma("user_version = 1");
  } finally {
    raw.close();
  }

  try {
    const report = await new DataRecovery(driver).inspect({
      source: fixture.scope,
    });
    assert.equal(report.state, "migration_required");
    assert.equal(report.corruption, null);
    assert.equal(report.quarantine, null);
    assert.equal(report.migration?.state, "required");
    assert.equal(
      existsSync(quarantineMarkerPath(fixture.scope.databasePath())),
      false,
    );

    assert.throws(
      () =>
        openScopedDataDatabase(driver, fixture.scope, {
          mode: "open-existing",
        }),
      (error) => assertStorageError(error, "DATABASE_MIGRATION_REQUIRED"),
    );
  } finally {
    rmSync(fixture.rootPath, { recursive: true, force: true });
  }
});

test("unrelated valid SQLite is reported unrecognized rather than repaired or quarantined", async () => {
  const driver = new SqliteStorageDriver();
  const fixture = newWorkspaceRoot();
  mkdirSync(join(fixture.rootPath, "workspaces", "sales", "data"), {
    recursive: true,
  });
  const raw = new Database(fixture.scope.databasePath());
  try {
    raw.exec("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)");
  } finally {
    raw.close();
  }

  try {
    const report = await new DataRecovery(driver).inspect({
      source: fixture.scope,
    });
    assert.equal(report.state, "unrecognized");
    assert.equal(report.quarantine, null);
    assert.equal(
      existsSync(quarantineMarkerPath(fixture.scope.databasePath())),
      false,
    );
  } finally {
    rmSync(fixture.rootPath, { recursive: true, force: true });
  }
});

test("verified backup can stage a healthy same-binding recovery without overwriting the quarantined source", async () => {
  const driver = new SqliteStorageDriver();
  const sourceFixture = newWorkspaceRoot();
  const source = seed(driver, sourceFixture.scope);
  const artifactRoot = mkdtempSync(join(tmpdir(), "ai-verse-data-recovery-backup-"));
  const destinationFixture = newWorkspaceRoot("sales");

  try {
    const artifactDirectory = join(artifactRoot, "backup");
    await new DataBackup(driver).createBackup({
      source,
      destinationDirectory: artifactDirectory,
    });

    corruptEventDigest(sourceFixture.scope.databasePath());
    const recovery = new DataRecovery(driver);
    const sourceReport = await recovery.inspect({
      source: sourceFixture.scope,
    });
    assert.equal(sourceReport.state, "quarantined");

    const result = await recovery.stageBackupRecovery({
      source: sourceFixture.scope,
      artifactDirectory,
      destination: destinationFixture.scope,
    });

    assert.equal(result.artifactKind, "sqlite-backup");
    assert.equal(result.source.state, "quarantined");
    assert.equal(result.destination.state, "healthy");
    assert.equal(result.destination.writable, true);
    assert.equal(result.promotion, "manual-explicit-not-implemented");
    assert.equal(result.transferReceipt.operation, "backup.restore");

    const rawSource = new Database(sourceFixture.scope.databasePath(), {
      readonly: true,
    });
    try {
      const row = rawSource
        .prepare("SELECT event_digest FROM _events WHERE event_sequence = 1")
        .get() as { readonly event_digest: string };
      assert.equal(row.event_digest, "0".repeat(64));
    } finally {
      rawSource.close();
    }

    assert.equal(
      existsSync(quarantineMarkerPath(sourceFixture.scope.databasePath())),
      true,
    );

    const staged = openScopedDataDatabase(driver, destinationFixture.scope, {
      mode: "open-existing",
    });
    try {
      assert.equal(
        new DataRecords(staged.database).list({
          spaceId: "crm",
          entity: "items",
        }).length,
        1,
      );
    } finally {
      staged.database.close();
    }
  } finally {
    source.database.close();
    rmSync(sourceFixture.rootPath, { recursive: true, force: true });
    rmSync(destinationFixture.rootPath, { recursive: true, force: true });
    rmSync(artifactRoot, { recursive: true, force: true });
  }
});

test("verified portable export can stage a healthy recovery candidate with exact binding", async () => {
  const driver = new SqliteStorageDriver();
  const sourceFixture = newWorkspaceRoot();
  const source = seed(driver, sourceFixture.scope);
  const artifactRoot = mkdtempSync(join(tmpdir(), "ai-verse-data-recovery-export-"));
  const destinationFixture = newWorkspaceRoot("sales");

  try {
    const artifactDirectory = join(artifactRoot, "export");
    await new DataBackup(driver).createPortableExport({
      source,
      destinationDirectory: artifactDirectory,
    });

    const result = await new DataRecovery(driver).stagePortableRecovery({
      source: sourceFixture.scope,
      artifactDirectory,
      destination: destinationFixture.scope,
    });

    assert.equal(result.artifactKind, "portable-export");
    assert.equal(result.source.state, "healthy");
    assert.equal(result.destination.state, "healthy");
    assert.equal(result.transferReceipt.operation, "portable.import");
  } finally {
    source.database.close();
    rmSync(sourceFixture.rootPath, { recursive: true, force: true });
    rmSync(destinationFixture.rootPath, { recursive: true, force: true });
    rmSync(artifactRoot, { recursive: true, force: true });
  }
});

test("staged recovery rejects cross-workspace binding and same canonical path", async () => {
  const driver = new SqliteStorageDriver();
  const sourceFixture = newWorkspaceRoot();
  const source = seed(driver, sourceFixture.scope);
  const artifactRoot = mkdtempSync(join(tmpdir(), "ai-verse-data-recovery-conflict-"));
  const wrongFixture = newWorkspaceRoot("other");

  try {
    const artifactDirectory = join(artifactRoot, "backup");
    await new DataBackup(driver).createBackup({
      source,
      destinationDirectory: artifactDirectory,
    });

    const recovery = new DataRecovery(driver);
    await assert.rejects(
      () =>
        recovery.stageBackupRecovery({
          source: sourceFixture.scope,
          artifactDirectory,
          destination: wrongFixture.scope,
        }),
      (error) => assertRecoveryError(error, "RECOVERY_BINDING_CONFLICT"),
    );

    await assert.rejects(
      () =>
        recovery.stageBackupRecovery({
          source: sourceFixture.scope,
          artifactDirectory,
          destination: sourceFixture.scope,
        }),
      (error) => assertRecoveryError(error, "RECOVERY_DESTINATION_CONFLICT"),
    );
  } finally {
    source.database.close();
    rmSync(sourceFixture.rootPath, { recursive: true, force: true });
    rmSync(wrongFixture.rootPath, { recursive: true, force: true });
    rmSync(artifactRoot, { recursive: true, force: true });
  }
});

test("malformed quarantine evidence fails closed and is never ignored", async () => {
  const driver = new SqliteStorageDriver();
  const fixture = newWorkspaceRoot();
  const handle = seed(driver, fixture.scope);
  handle.database.close();

  writeFileSync(
    quarantineMarkerPath(fixture.scope.databasePath()),
    "{not-json",
    "utf8",
  );

  try {
    assert.throws(
      () =>
        openScopedDataDatabase(driver, fixture.scope, {
          mode: "open-existing",
        }),
      (error) => assertStorageError(error, "DATABASE_QUARANTINED"),
    );

    const report = await new DataRecovery(driver).inspect({
      source: fixture.scope,
    });
    assert.equal(report.state, "quarantined");
    assert.equal(report.writable, false);
    assert.equal(report.corruption?.category, "semantic");
  } finally {
    rmSync(fixture.rootPath, { recursive: true, force: true });
  }
});
