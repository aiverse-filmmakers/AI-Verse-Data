import { existsSync, rmSync, statSync } from "node:fs";

import Database from "better-sqlite3";

import { DataStorageError, isDataStorageError } from "./errors.js";
import { SqliteCatalogStorage } from "./sqlite-catalog-store.js";
import { SqliteRecordStorage } from "./sqlite-record-store.js";
import { SqliteQueryStorage } from "./sqlite-query-store.js";
import { SqliteRelationStorage } from "./sqlite-relation-store.js";
import { SqliteIdempotencyStorage } from "./sqlite-idempotency-store.js";
import { SqliteProvenanceStorage } from "./sqlite-provenance-store.js";
import {
  AI_VERSE_DATA_DATABASE_FORMAT_VERSION,
  AI_VERSE_DATA_MIN_SQLITE_VERSION,
  AI_VERSE_DATA_SCOPE_BINDING_VERSION,
  AI_VERSE_DATA_SQLITE_APPLICATION_ID,
  AI_VERSE_DATA_SQLITE_FORMAT,
  type DataStorageDatabase,
  type DataStorageDriver,
  type IntegrityCheckResult,
  type StorageDatabaseBinding,
  type StorageBackupResult,
  type StorageDatabaseMetadata,
  type StorageDiagnostics,
  type StorageOpenOptions,
  type StorageTransactionMode,
} from "./types.js";

const META_TABLE = "_aiverse_meta";
const SQLITE_DRIVER_NAME = "sqlite" as const;
const BINDING_KEYS = [
  "binding_version",
  "scope_kind",
  "workspace_id",
] as const;

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

function validateBindingValue(
  binding: StorageDatabaseBinding,
  source: "expected" | "stored",
): void {
  const invalid = (message: string): never => {
    throw new DataStorageError(
      source === "stored" ? "DATABASE_CORRUPT" : "DATABASE_SCOPE_CONFLICT",
      message,
    );
  };

  if (binding.bindingVersion !== AI_VERSE_DATA_SCOPE_BINDING_VERSION) {
    invalid(
      source === "stored"
        ? "AI-Verse Data scope binding version is unsupported."
        : "Requested scope binding version is unsupported.",
    );
  }
  if (binding.kind !== "standalone" && binding.kind !== "workspace") {
    invalid(
      source === "stored"
        ? "AI-Verse Data scope binding kind is invalid."
        : "Requested scope binding kind is invalid.",
    );
  }
  if (
    binding.workspaceId.length < 1 ||
    binding.workspaceId.length > 128 ||
    binding.workspaceId === "." ||
    binding.workspaceId === ".." ||
    binding.workspaceId.includes("/") ||
    binding.workspaceId.includes("\\") ||
    binding.workspaceId.includes("\u0000")
  ) {
    invalid(
      source === "stored"
        ? "AI-Verse Data workspace binding is invalid."
        : "Requested workspace binding is invalid.",
    );
  }
}

function bindingEquals(
  left: StorageDatabaseBinding,
  right: StorageDatabaseBinding,
): boolean {
  return (
    left.bindingVersion === right.bindingVersion &&
    left.kind === right.kind &&
    left.workspaceId === right.workspaceId
  );
}

function insertBinding(
  database: Database.Database,
  binding: StorageDatabaseBinding,
): void {
  validateBindingValue(binding, "expected");
  const insert = database.prepare(
    `INSERT INTO ${META_TABLE} (key, value) VALUES (?, ?)`,
  );
  const write = database.transaction(() => {
    insert.run("binding_version", String(binding.bindingVersion));
    insert.run("scope_kind", binding.kind);
    insert.run("workspace_id", binding.workspaceId);
  });
  write();
}

function bootstrap(
  database: Database.Database,
  binding?: StorageDatabaseBinding,
): void {
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

    if (binding !== undefined) {
      validateBindingValue(binding, "expected");
      insert.run("binding_version", String(binding.bindingVersion));
      insert.run("scope_kind", binding.kind);
      insert.run("workspace_id", binding.workspaceId);
    }

    database.pragma(
      `application_id = ${AI_VERSE_DATA_SQLITE_APPLICATION_ID}`,
    );
    database.pragma(
      `user_version = ${AI_VERSE_DATA_DATABASE_FORMAT_VERSION}`,
    );
  });
  create();
}

function parseStoredBinding(
  values: ReadonlyMap<string, string>,
): StorageDatabaseBinding | null {
  const present = BINDING_KEYS.filter((key) => values.has(key));
  if (present.length === 0) return null;
  if (present.length !== BINDING_KEYS.length) {
    throw new DataStorageError(
      "DATABASE_CORRUPT",
      "AI-Verse Data scope binding metadata is incomplete.",
    );
  }

  const bindingVersionText = values.get("binding_version");
  const kind = values.get("scope_kind");
  const workspaceId = values.get("workspace_id");

  const bindingVersion = Number.parseInt(bindingVersionText ?? "", 10);
  if (
    bindingVersionText === undefined ||
    kind === undefined ||
    workspaceId === undefined ||
    !Number.isSafeInteger(bindingVersion)
  ) {
    throw new DataStorageError(
      "DATABASE_CORRUPT",
      "AI-Verse Data scope binding metadata is invalid.",
    );
  }

  const binding = {
    bindingVersion,
    kind,
    workspaceId,
  } as StorageDatabaseBinding;
  validateBindingValue(binding, "stored");
  return binding;
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
    binding: parseStoredBinding(values),
  };
}

function ensureExpectedBinding(
  database: Database.Database,
  metadata: StorageDatabaseMetadata,
  expectedBinding: StorageDatabaseBinding | undefined,
): StorageDatabaseMetadata {
  if (expectedBinding === undefined) return metadata;
  validateBindingValue(expectedBinding, "expected");

  if (metadata.binding === null) {
    insertBinding(database, expectedBinding);
    return readMetadata(database);
  }

  if (!bindingEquals(metadata.binding, expectedBinding)) {
    throw new DataStorageError(
      "DATABASE_SCOPE_CONFLICT",
      `Database is bound to ${metadata.binding.kind} workspace '${metadata.binding.workspaceId}', not ${expectedBinding.kind} workspace '${expectedBinding.workspaceId}'.`,
    );
  }

  return metadata;
}

function validateOrBootstrap(
  database: Database.Database,
  existedBeforeOpen: boolean,
  mode: "create-or-open" | "open-existing",
  expectedBinding?: StorageDatabaseBinding,
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

    bootstrap(database, expectedBinding);
  }

  const metadata = readMetadata(database);
  return ensureExpectedBinding(database, metadata, expectedBinding);
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
    return {
      ...this.storedMetadata,
      binding:
        this.storedMetadata.binding === null
          ? null
          : { ...this.storedMetadata.binding },
    };
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

  async backupTo(location: string): Promise<StorageBackupResult> {
    this.assertOpen();

    if (location.length === 0 || location.includes("\u0000")) {
      throw new DataStorageError(
        "DATABASE_UNAVAILABLE",
        "SQLite backup destination must be a non-empty filesystem path without NUL.",
      );
    }
    if (existsSync(location)) {
      throw new DataStorageError(
        "DATABASE_UNAVAILABLE",
        "SQLite backup destination already exists; backups never overwrite files.",
      );
    }
    if (this.database.inTransaction) {
      throw new DataStorageError(
        "DATABASE_UNAVAILABLE",
        "SQLite backup cannot begin while the source connection has an active transaction.",
      );
    }

    try {
      const result = await this.database.backup(location);
      if (
        !Number.isSafeInteger(result.totalPages) ||
        result.totalPages < 0 ||
        result.remainingPages !== 0
      ) {
        throw new DataStorageError(
          "DATABASE_CORRUPT",
          "SQLite backup completed with invalid completion metadata.",
        );
      }
      return {
        totalPages: result.totalPages,
        remainingPages: 0,
      };
    } catch (error) {
      try {
        rmSync(location, { force: true });
      } catch {
        // Preserve the original backup failure.
      }
      if (isDataStorageError(error)) throw error;
      throw new DataStorageError(
        "DATABASE_UNAVAILABLE",
        "Unable to create a consistent SQLite backup.",
        error,
      );
    }
  }

  catalogStorage(): SqliteCatalogStorage {
    this.assertOpen();
    return new SqliteCatalogStorage(this.database);
  }

  recordStorage(): SqliteRecordStorage {
    this.assertOpen();
    return new SqliteRecordStorage(this.database);
  }

  queryStorage(): SqliteQueryStorage {
    this.assertOpen();
    return new SqliteQueryStorage(this.database);
  }

  relationStorage(): SqliteRelationStorage {
    this.assertOpen();
    return new SqliteRelationStorage(this.database);
  }

  idempotencyStorage(): SqliteIdempotencyStorage {
    this.assertOpen();
    return new SqliteIdempotencyStorage(this.database);
  }

  provenanceStorage(): SqliteProvenanceStorage {
    this.assertOpen();
    return new SqliteProvenanceStorage(this.database);
  }

  transaction<T>(
    operation: () => T,
    mode: StorageTransactionMode = "deferred",
  ): T {
    this.assertOpen();
    const wrapped = this.database.transaction(operation);
    return mode === "immediate" ? wrapped.immediate() : wrapped.deferred();
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
        options.expectedBinding,
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
