import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import {
  AI_VERSE_DATA_DATABASE_FORMAT_VERSION,
  AI_VERSE_DATA_SQLITE_APPLICATION_ID,
  AI_VERSE_DATA_SQLITE_FORMAT,
  DataStorageError,
  SqliteStorageDriver,
} from "../src/storage/index.js";

function withTempDatabase(
  run: (databasePath: string, directory: string) => void,
): void {
  const directory = mkdtempSync(join(tmpdir(), "ai-verse-data-storage-"));
  const databasePath = join(directory, "data.sqlite");
  try {
    run(databasePath, directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
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

test("creates a new SQLite Data database with durable identity and safe pragmas", () => {
  withTempDatabase((databasePath) => {
    const driver = new SqliteStorageDriver();
    const database = driver.open({ location: databasePath });

    const metadata = database.metadata();
    assert.equal(metadata.format, AI_VERSE_DATA_SQLITE_FORMAT);
    assert.equal(metadata.formatVersion, AI_VERSE_DATA_DATABASE_FORMAT_VERSION);
    assert.equal(metadata.driver, "sqlite");
    assert.ok(Number.isFinite(Date.parse(metadata.createdAt)));

    const diagnostics = database.diagnostics();
    assert.equal(diagnostics.driver, "sqlite");
    assert.equal(diagnostics.journalMode, "wal");
    assert.equal(diagnostics.foreignKeys, true);
    assert.equal(diagnostics.strictTables, true);
    assert.equal(diagnostics.applicationId, AI_VERSE_DATA_SQLITE_APPLICATION_ID);
    assert.equal(
      diagnostics.userVersion,
      AI_VERSE_DATA_DATABASE_FORMAT_VERSION,
    );

    assert.deepEqual(database.integrityCheck(), {
      ok: true,
      messages: ["ok"],
    });
    database.close();
  });
});

test("reopens an existing Data database without replacing its metadata", () => {
  withTempDatabase((databasePath) => {
    const driver = new SqliteStorageDriver();
    const first = driver.open({ location: databasePath });
    const firstMetadata = first.metadata();
    first.close();

    const second = driver.open({
      location: databasePath,
      mode: "open-existing",
    });
    assert.deepEqual(second.metadata(), firstMetadata);
    assert.equal(second.integrityCheck().ok, true);
    second.close();
  });
});

test("open-existing fails clearly when the database does not exist", () => {
  withTempDatabase((databasePath) => {
    const driver = new SqliteStorageDriver();
    assert.throws(
      () => driver.open({ location: databasePath, mode: "open-existing" }),
      (error) => assertStorageError(error, "DATABASE_NOT_FOUND"),
    );
  });
});

test("refuses to adopt an unrelated existing SQLite database", () => {
  withTempDatabase((databasePath) => {
    const foreign = new Database(databasePath);
    foreign.exec("CREATE TABLE customer_data (id INTEGER PRIMARY KEY) STRICT;");
    foreign.close();

    const driver = new SqliteStorageDriver();
    assert.throws(
      () => driver.open({ location: databasePath }),
      (error) => assertStorageError(error, "DATABASE_FORMAT_UNRECOGNIZED"),
    );

    const verify = new Database(databasePath, { readonly: true });
    const row = verify
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='customer_data'",
      )
      .get() as { readonly name: string } | undefined;
    assert.equal(row?.name, "customer_data");
    verify.close();
  });
});

test("fails closed when the stored database format is newer than supported", () => {
  withTempDatabase((databasePath) => {
    const driver = new SqliteStorageDriver();
    const created = driver.open({ location: databasePath });
    created.close();

    const raw = new Database(databasePath);
    raw
      .prepare("UPDATE _aiverse_meta SET value = ? WHERE key = 'format_version'")
      .run("999");
    raw.pragma("user_version = 999");
    raw.close();

    assert.throws(
      () => driver.open({ location: databasePath, mode: "open-existing" }),
      (error) => assertStorageError(error, "DATABASE_VERSION_UNSUPPORTED"),
    );
  });
});

test("detects inconsistent identity metadata instead of silently repairing it", () => {
  withTempDatabase((databasePath) => {
    const driver = new SqliteStorageDriver();
    const created = driver.open({ location: databasePath });
    created.close();

    const raw = new Database(databasePath);
    raw.pragma("application_id = 0");
    raw.close();

    assert.throws(
      () => driver.open({ location: databasePath, mode: "open-existing" }),
      (error) => assertStorageError(error, "DATABASE_FORMAT_UNRECOGNIZED"),
    );
  });
});

test("closed database handles reject further operations", () => {
  withTempDatabase((databasePath) => {
    const database = new SqliteStorageDriver().open({ location: databasePath });
    database.close();
    database.close();

    assert.throws(
      () => database.metadata(),
      (error) => assertStorageError(error, "DATABASE_UNAVAILABLE"),
    );
  });
});
