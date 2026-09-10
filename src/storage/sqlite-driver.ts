import { existsSync, statSync } from "node:fs";

import Database from "better-sqlite3";

import { DataStorageError, isDataStorageError } from "./errors.js";
import {
  AI_VERSE_DATA_DATABASE_FORMAT_VERSION,
  AI_VERSE_DATA_MIN_SQLITE_VERSION,
  AI_VERSE_DATA_SQLITE_APPLICATION_ID,
  AI_VERSE_DATA_SQLITE_FORMAT,
  type DataStorageDatabase,
  type DataStorageDriver,
  type IntegrityCheckResult,
  type StorageDatabaseMetadata,
  type StorageDiagnostics,
  type StorageOpenOptions,
} from "./types.js";

const META_TABLE = "_aiverse_meta";
const SQLITE_DRIVER_NAME = "sqlite" as const;

interface SqliteVersionRow {
  readonly version: string;
}

interface MetaRow {
  readonly key: string;
  readonly value: string;
}

interface TableNameRow {
  readonly name: string;
}

interface TableListRow {
  readonly name: string;
  readonly strict: number;
}

function parseVersion(value: string): readonly number[] {
  return value.split(".").map((part) => Number.parseInt(part, 10));
}

function versionAtLeast(actual: string, minimum: string): boolean {
  const left = parseVersion(actual);
  const right = parseVersion(minimum);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const actualPart = left[index] ?? 0;
    const minimumPart = right[index] ?? 0;
    if (!Number.isFinite(actualPart) || !Number.isFinite(minimumPart)) {
      return false;
    }
    if (actualPart > minimumPart) return true;
    if (actualPart < minimumPart) return false;
  }
  return true;
}

function simpleNumber(database: Database.Database, pragma: string): number {
  const value = database.pragma(pragma, { simple: true });
  if (typeof value !== "number") {
    throw new DataStorageError(
      "DATABASE_CORRUPT",
      `SQLite pragma ${pragma} did not return a numeric value.`,
    );
  }
  return value;
}

function simpleString(database: Database.Database, pragma: string): string {
  const value = database.pragma(pragma, { simple: true });
  if (typeof value !== "string") {
    throw new DataStorageError(
      "DATABASE_CORRUPT",
      `SQLite pragma ${pragma} did not return a string value.`,
    );
  }
  return value;
}

function sqliteVersion(database: Database.Database): string {
  const row = database
    .prepare("SELECT sqlite_version() AS version")
    .get() as SqliteVersionRow | undefined;
  if (row === undefined || typeof row.version !== "string") {
    throw new DataStorageError(
      "DATABASE_UNAVAILABLE",
      "Unable to determine the SQLite runtime version.",
    );
  }
  return row.version;
}

function ensureSupportedSqlite(database: Database.Database): string {
  const version = sqliteVersion(database);
  if (!versionAtLeast(version, AI_VERSE_DATA_MIN_SQLITE_VERSION)) {
    throw new DataStorageError(
      "SQLITE_VERSION_UNSUPPORTED",
      `SQLite ${version} is unsupported; AI-Verse Data requires SQLite ${AI_VERSE_DATA_MIN_SQLITE_VERSION} or newer.`,
    );
  }
  return version;
}

function hasMetaTable(database: Database.Database): boolean {
  const row = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(META_TABLE) as TableNameRow | undefined;
  return row?.name === META_TABLE;
}

function applicationTables(database: Database.Database): readonly string[] {
  const rows = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as TableNameRow[];
  return rows.map((row) => row.name);
}

function bootstrap(database: Database.Database): void {
  const createdAt = new Date().toISOString();
  const create = database.transaction(() => {
    database.exec(`
      CREATE TABLE ${META_TABLE} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT, WITHOUT ROWID;
    `);

    const insert = database.prepare(
      `INSERT INTO ${META_TABLE} (key, value) VALUES (?, ?)`,
    );
    insert.run("format", AI_VERSE_DATA_SQLITE_FORMAT);
    insert.run(
      "format_version",
      String(AI_VERSE_DATA_DATABASE_FORMAT_VERSION),
    );
    insert.run("created_at", createdAt);
    insert.run("driver", SQLITE_DRIVER_NAME);

    database.pragma(
      `application_id = ${AI_VERSE_DATA_SQLITE_APPLICATION_ID}`,
    );
    database.pragma(
      `user_version = ${AI_VERSE_DATA_DATABASE_FORMAT_VERSION}`,
    );
  });
  create();
}

function readMetadata(database: Database.Database): StorageDatabaseMetadata {
  let rows: MetaRow[];
  try {
    rows = database
      .prepare(`SELECT key, value FROM ${META_TABLE}`)
      .all() as MetaRow[];
  } catch (error) {
    throw new DataStorageError(
      "DATABASE_CORRUPT",
      "AI-Verse Data metadata cannot be read.",
      error,
    );
  }

  const values = new Map(rows.map((row) => [row.key, row.value]));
  const format = values.get("format");
  const formatVersionText = values.get("format_version");
  const createdAt = values.get("created_at");
  const driver = values.get("driver");

  if (
    format === undefined ||
    formatVersionText === undefined ||
    createdAt === undefined ||
    driver === undefined
  ) {
    throw new DataStorageError(
      "DATABASE_CORRUPT",
      "AI-Verse Data metadata is incomplete.",
    );
  }

  if (format !== AI_VERSE_DATA_SQLITE_FORMAT || driver !== SQLITE_DRIVER_NAME) {
    throw new DataStorageError(
      "DATABASE_FORMAT_UNRECOGNIZED",
      "The SQLite file is not an AI-Verse Data database.",
    );
  }

  const formatVersion = Number.parseInt(formatVersionText, 10);
  if (!Number.isSafeInteger(formatVersion) || formatVersion < 1) {
    throw new DataStorageError(
      "DATABASE_CORRUPT",
      "AI-Verse Data format version metadata is invalid.",
    );
  }

  if (formatVersion !== AI_VERSE_DATA_DATABASE_FORMAT_VERSION) {
    throw new DataStorageError(
      "DATABASE_VERSION_UNSUPPORTED",
      `Database format ${formatVersion} is unsupported by this engine; expected ${AI_VERSE_DATA_DATABASE_FORMAT_VERSION}.`,
    );
  }

  if (Number.isNaN(Date.parse(createdAt))) {
    throw new DataStorageError(
      "DATABASE_CORRUPT",
      "AI-Verse Data creation timestamp is invalid.",
    );
  }

  const applicationId = simpleNumber(database, "application_id");
  const userVersion = simpleNumber(database, "user_version");
  if (applicationId !== AI_VERSE_DATA_SQLITE_APPLICATION_ID) {
    throw new DataStorageError(
      "DATABASE_FORMAT_UNRECOGNIZED",
      "SQLite application identity does not match AI-Verse Data.",
    );
  }
  if (userVersion !== formatVersion) {
    throw new DataStorageError(
      "DATABASE_CORRUPT",
      "SQLite user_version disagrees with AI-Verse Data metadata.",
    );
  }

  return {
    format: AI_VERSE_DATA_SQLITE_FORMAT,
    formatVersion,
    createdAt,
    driver: SQLITE_DRIVER_NAME,
  };
}

function validateOrBootstrap(
  database: Database.Database,
  existedBeforeOpen: boolean,
  mode: "create-or-open" | "open-existing",
): StorageDatabaseMetadata {
  const metaExists = hasMetaTable(database);

  if (!metaExists) {
    const tables = applicationTables(database);
    const applicationId = simpleNumber(database, "application_id");
    const userVersion = simpleNumber(database, "user_version");

    if (
      mode === "open-existing" ||
      tables.length > 0 ||
      applicationId !== 0 ||
      userVersion !== 0
    ) {
      throw new DataStorageError(
        "DATABASE_FORMAT_UNRECOGNIZED",
        existedBeforeOpen
          ? "Existing SQLite file is not an initialized AI-Verse Data database."
          : "Database is not initialized as AI-Verse Data.",
      );
    }

    bootstrap(database);
  }

  return readMetadata(database);
}

function configureConnection(database: Database.Database): void {
  database.pragma("foreign_keys = ON");
  const foreignKeys = simpleNumber(database, "foreign_keys");
  if (foreignKeys !== 1) {
    throw new DataStorageError(
      "DATABASE_UNAVAILABLE",
      "SQLite foreign-key enforcement could not be enabled.",
    );
  }

  const journalMode = simpleString(database, "journal_mode = WAL").toLowerCase();
  if (journalMode !== "wal") {
    throw new DataStorageError(
      "DATABASE_UNAVAILABLE",
      `SQLite WAL mode could not be enabled; journal mode is ${journalMode}.`,
    );
  }

  database.pragma("synchronous = NORMAL");
  database.pragma("busy_timeout = 5000");
}

class SqliteStorageDatabase implements DataStorageDatabase {
  readonly driverKind = SQLITE_DRIVER_NAME;
  private closed = false;

  constructor(
    private readonly database: Database.Database,
    private readonly storedMetadata: StorageDatabaseMetadata,
  ) {}

  metadata(): StorageDatabaseMetadata {
    this.assertOpen();
    return { ...this.storedMetadata };
  }

  diagnostics(): StorageDiagnostics {
    this.assertOpen();
    const tableList = this.database.pragma("table_list") as TableListRow[];
    const metaTable = tableList.find((table) => table.name === META_TABLE);

    return {
      driver: SQLITE_DRIVER_NAME,
      sqliteVersion: sqliteVersion(this.database),
      journalMode: simpleString(this.database, "journal_mode").toLowerCase(),
      foreignKeys: simpleNumber(this.database, "foreign_keys") === 1,
      strictTables: metaTable?.strict === 1,
      applicationId: simpleNumber(this.database, "application_id"),
      userVersion: simpleNumber(this.database, "user_version"),
    };
  }

  integrityCheck(): IntegrityCheckResult {
    this.assertOpen();
    const rows = this.database.pragma("integrity_check") as Array<
      Record<string, unknown>
    >;
    const messages = rows.map((row) => {
      const value = row.integrity_check ?? Object.values(row)[0];
      return String(value ?? "unknown integrity result");
    });

    return {
      ok: messages.length === 1 && messages[0]?.toLowerCase() === "ok",
      messages,
    };
  }

  close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new DataStorageError(
        "DATABASE_UNAVAILABLE",
        "AI-Verse Data database is already closed.",
      );
    }
  }
}

export class SqliteStorageDriver implements DataStorageDriver {
  readonly kind = SQLITE_DRIVER_NAME;

  open(options: StorageOpenOptions): DataStorageDatabase {
    const mode = options.mode ?? "create-or-open";
    const location = options.location;
    const existedBeforeOpen = existsSync(location);

    if (location.length === 0) {
      throw new DataStorageError(
        "DATABASE_UNAVAILABLE",
        "SQLite database location must not be empty.",
      );
    }

    if (existedBeforeOpen && !statSync(location).isFile()) {
      throw new DataStorageError(
        "DATABASE_UNAVAILABLE",
        "SQLite database location must be a file.",
      );
    }

    if (mode === "open-existing" && !existedBeforeOpen) {
      throw new DataStorageError(
        "DATABASE_NOT_FOUND",
        "AI-Verse Data database does not exist.",
      );
    }

    let database: Database.Database | undefined;
    try {
      database = new Database(location, {
        fileMustExist: mode === "open-existing",
      });
      ensureSupportedSqlite(database);
      const metadata = validateOrBootstrap(
        database,
        existedBeforeOpen,
        mode,
      );
      configureConnection(database);
      return new SqliteStorageDatabase(database, metadata);
    } catch (error) {
      if (database !== undefined) {
        try {
          database.close();
        } catch {
          // Preserve the original failure.
        }
      }
      if (isDataStorageError(error)) throw error;
      throw new DataStorageError(
        "DATABASE_UNAVAILABLE",
        "Unable to open AI-Verse Data SQLite database.",
        error,
      );
    }
  }
}
