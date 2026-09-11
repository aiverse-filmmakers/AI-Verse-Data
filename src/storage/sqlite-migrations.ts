import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import Database from "better-sqlite3";

import { DataStorageError, isDataStorageError } from "./errors.js";
import {
  backupSqliteDatabase,
  sha256FileSync,
} from "./sqlite-backup.js";
import {
  AI_VERSE_DATA_DATABASE_FORMAT_VERSION,
  AI_VERSE_DATA_MIGRATION_FRAMEWORK_VERSION,
  AI_VERSE_DATA_MIN_MIGRATABLE_FORMAT_VERSION,
  AI_VERSE_DATA_SCOPE_BINDING_VERSION,
  AI_VERSE_DATA_SQLITE_APPLICATION_ID,
  AI_VERSE_DATA_SQLITE_FORMAT,
  type StorageDatabaseBinding,
  type StorageDatabaseMetadata,
  type StorageMigrationBackupManifest,
  type StorageMigrationBackupReceipt,
  type StorageMigrationBackupVerification,
  type StorageMigrationBackupVerifyOptions,
  type StorageMigrationResult,
  type StorageMigrationStatus,
} from "./types.js";

const META_TABLE = "_aiverse_meta";
const MIGRATION_TABLE = "_schema_migrations";
const MIGRATION_FRAMEWORK_META_KEY = "migration_framework_version";
const MIGRATION_BACKUP_MANIFEST_FORMAT =
  "ai-verse-data/migration-backup-manifest" as const;
const MIGRATION_BACKUP_RECEIPT_FORMAT =
  "ai-verse-data/migration-backup-receipt" as const;
const MIGRATION_BACKUP_FORMAT_VERSION = 1 as const;
const MIGRATION_PAYLOAD_FILE = "database.sqlite" as const;
const MIGRATION_MANIFEST_FILE = "manifest.json";
const MIGRATION_RECEIPT_FILE = "receipt.json";
const MAX_METADATA_BYTES = 1024 * 1024;

type MigrationLedgerState = "in_progress" | "failed" | "completed";

interface MigrationDefinition {
  readonly id: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly definitionDigest: string;
  apply(database: Database.Database): void;
}

interface MigrationLedgerRow {
  readonly migration_id: string;
  readonly definition_digest: string;
  readonly from_version: number;
  readonly to_version: number;
  readonly state: MigrationLedgerState;
  readonly attempt: number;
  readonly backup_artifact_id: string;
  readonly backup_payload_sha256: string;
  readonly backup_manifest_sha256: string;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly failed_at: string | null;
  readonly failure_message: string | null;
}

interface TableNameRow {
  readonly name: string;
}

interface TableInfoRow {
  readonly name: string;
}

interface MetaRow {
  readonly key: string;
  readonly value: string;
}

interface IntegrityRow {
  readonly integrity_check?: unknown;
  readonly [key: string]: unknown;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const MIGRATION_1_TO_2_DESCRIPTOR =
  "ai-verse-data/sqlite migration 1->2: internal migration ledger framework v1";

const MIGRATIONS: readonly MigrationDefinition[] = [
  {
    id: "sqlite-0001-v1-to-v2",
    fromVersion: 1,
    toVersion: 2,
    definitionDigest: sha256Text(MIGRATION_1_TO_2_DESCRIPTOR),
    apply(database): void {
      const existing = database
        .prepare(
          `SELECT value FROM ${META_TABLE} WHERE key = ?`,
        )
        .get(MIGRATION_FRAMEWORK_META_KEY) as
        | { readonly value: string }
        | undefined;

      if (
        existing !== undefined &&
        existing.value !== String(AI_VERSE_DATA_MIGRATION_FRAMEWORK_VERSION)
      ) {
        throw new DataStorageError(
          "DATABASE_MIGRATION_FAILED",
          "Stored migration-framework metadata conflicts with the supported framework version.",
        );
      }

      if (existing === undefined) {
        database
          .prepare(
            `INSERT INTO ${META_TABLE} (key, value) VALUES (?, ?)`,
          )
          .run(
            MIGRATION_FRAMEWORK_META_KEY,
            String(AI_VERSE_DATA_MIGRATION_FRAMEWORK_VERSION),
          );
      }
    },
  },
] as const;

const LEDGER_COLUMNS = [
  "migration_id",
  "definition_digest",
  "from_version",
  "to_version",
  "state",
  "attempt",
  "backup_artifact_id",
  "backup_payload_sha256",
  "backup_manifest_sha256",
  "started_at",
  "completed_at",
  "failed_at",
  "failure_message",
] as const;

function migrationById(id: string): MigrationDefinition | undefined {
  return MIGRATIONS.find((migration) => migration.id === id);
}

function hasTable(database: Database.Database, table: string): boolean {
  const row = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get(table) as TableNameRow | undefined;
  return row?.name === table;
}

function createMigrationLedger(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
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
}

function assertMigrationLedgerShape(database: Database.Database): void {
  if (!hasTable(database, MIGRATION_TABLE)) {
    throw new DataStorageError(
      "DATABASE_MIGRATION_INCOMPLETE",
      "Current database format is missing the internal migration ledger.",
    );
  }

  const rows = database.pragma(
    `table_info(${MIGRATION_TABLE})`,
  ) as TableInfoRow[];
  const columns = rows.map((row) => row.name);

  if (
    columns.length !== LEDGER_COLUMNS.length ||
    LEDGER_COLUMNS.some((column, index) => columns[index] !== column)
  ) {
    throw new DataStorageError(
      "DATABASE_MIGRATION_INCOMPLETE",
      "Internal migration ledger schema is incomplete or incompatible.",
    );
  }
}

function readLedger(database: Database.Database): readonly MigrationLedgerRow[] {
  if (!hasTable(database, MIGRATION_TABLE)) return [];
  assertMigrationLedgerShape(database);
  return database
    .prepare(
      `SELECT
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
       FROM ${MIGRATION_TABLE}
       ORDER BY from_version ASC, to_version ASC, migration_id ASC`,
    )
    .all() as MigrationLedgerRow[];
}

function validateLedgerRow(row: MigrationLedgerRow): void {
  const definition = migrationById(row.migration_id);
  if (
    definition === undefined ||
    definition.definitionDigest !== row.definition_digest ||
    definition.fromVersion !== row.from_version ||
    definition.toVersion !== row.to_version
  ) {
    throw new DataStorageError(
      "DATABASE_MIGRATION_INCOMPLETE",
      `Migration ledger entry '${row.migration_id}' does not match the installed migration definition.`,
    );
  }

  if (
    !Number.isSafeInteger(row.attempt) ||
    row.attempt < 1 ||
    !/^[0-9a-f]{64}$/.test(row.backup_payload_sha256) ||
    !/^[0-9a-f]{64}$/.test(row.backup_manifest_sha256) ||
    Number.isNaN(Date.parse(row.started_at)) ||
    (row.completed_at !== null && Number.isNaN(Date.parse(row.completed_at))) ||
    (row.failed_at !== null && Number.isNaN(Date.parse(row.failed_at)))
  ) {
    throw new DataStorageError(
      "DATABASE_MIGRATION_INCOMPLETE",
      `Migration ledger entry '${row.migration_id}' is malformed.`,
    );
  }

  const lifecycleValid =
    row.state === "completed"
      ? row.completed_at !== null &&
        row.failed_at === null &&
        row.failure_message === null
      : row.state === "failed"
        ? row.completed_at === null &&
          row.failed_at !== null &&
          row.failure_message !== null
        : row.completed_at === null &&
          row.failed_at === null &&
          row.failure_message === null;

  if (!lifecycleValid) {
    throw new DataStorageError(
      "DATABASE_MIGRATION_INCOMPLETE",
      `Migration ledger entry '${row.migration_id}' has inconsistent lifecycle metadata.`,
    );
  }
}

function requiredMigrationPath(fromVersion: number): readonly MigrationDefinition[] {
  const output: MigrationDefinition[] = [];
  let version = fromVersion;

  while (version < AI_VERSE_DATA_DATABASE_FORMAT_VERSION) {
    const next = MIGRATIONS.find(
      (migration) => migration.fromVersion === version,
    );
    if (next === undefined) {
      throw new DataStorageError(
        "DATABASE_VERSION_UNSUPPORTED",
        `No supported internal migration path exists from database format ${version} to ${AI_VERSE_DATA_DATABASE_FORMAT_VERSION}.`,
      );
    }
    output.push(next);
    version = next.toVersion;
  }

  if (version !== AI_VERSE_DATA_DATABASE_FORMAT_VERSION) {
    throw new DataStorageError(
      "DATABASE_VERSION_UNSUPPORTED",
      `Internal migration path does not terminate at database format ${AI_VERSE_DATA_DATABASE_FORMAT_VERSION}.`,
    );
  }

  return output;
}

export function bootstrapSqliteMigrationFramework(
  database: Database.Database,
): void {
  createMigrationLedger(database);
  database
    .prepare(
      `INSERT INTO ${META_TABLE} (key, value) VALUES (?, ?)`,
    )
    .run(
      MIGRATION_FRAMEWORK_META_KEY,
      String(AI_VERSE_DATA_MIGRATION_FRAMEWORK_VERSION),
    );
}

export function inspectSqliteMigrationState(
  database: Database.Database,
  metadata: StorageDatabaseMetadata,
): StorageMigrationStatus {
  const version = metadata.formatVersion;

  if (version > AI_VERSE_DATA_DATABASE_FORMAT_VERSION) {
    throw new DataStorageError(
      "DATABASE_VERSION_UNSUPPORTED",
      `Database format ${version} is newer than this engine supports (${AI_VERSE_DATA_DATABASE_FORMAT_VERSION}).`,
    );
  }

  if (version < AI_VERSE_DATA_MIN_MIGRATABLE_FORMAT_VERSION) {
    throw new DataStorageError(
      "DATABASE_VERSION_UNSUPPORTED",
      `Database format ${version} is older than the minimum migratable format ${AI_VERSE_DATA_MIN_MIGRATABLE_FORMAT_VERSION}.`,
    );
  }

  const ledger = readLedger(database);
  for (const row of ledger) validateLedgerRow(row);

  const incomplete = ledger
    .filter((row) => row.state !== "completed")
    .map((row) => row.migration_id);

  if (version === AI_VERSE_DATA_DATABASE_FORMAT_VERSION) {
    const framework = database
      .prepare(
        `SELECT value FROM ${META_TABLE} WHERE key = ?`,
      )
      .get(MIGRATION_FRAMEWORK_META_KEY) as
      | { readonly value: string }
      | undefined;

    if (
      framework?.value !==
      String(AI_VERSE_DATA_MIGRATION_FRAMEWORK_VERSION)
    ) {
      throw new DataStorageError(
        "DATABASE_MIGRATION_INCOMPLETE",
        "Current database format is missing compatible migration-framework metadata.",
      );
    }

    assertMigrationLedgerShape(database);

    if (incomplete.length > 0) {
      return {
        state: "incomplete",
        databaseFormatVersion: version,
        targetFormatVersion: AI_VERSE_DATA_DATABASE_FORMAT_VERSION,
        binding: metadata.binding,
        pendingMigrationIds: [],
        incompleteMigrationIds: incomplete,
      };
    }

    return {
      state: "current",
      databaseFormatVersion: version,
      targetFormatVersion: AI_VERSE_DATA_DATABASE_FORMAT_VERSION,
      binding: metadata.binding,
      pendingMigrationIds: [],
      incompleteMigrationIds: [],
    };
  }

  const path = requiredMigrationPath(version);
  const pending = path.map((migration) => migration.id);

  const contradictoryCompleted = ledger.filter(
    (row) =>
      row.state === "completed" &&
      row.to_version > version,
  );
  if (contradictoryCompleted.length > 0) {
    return {
      state: "incomplete",
      databaseFormatVersion: version,
      targetFormatVersion: AI_VERSE_DATA_DATABASE_FORMAT_VERSION,
      binding: metadata.binding,
      pendingMigrationIds: pending,
      incompleteMigrationIds: contradictoryCompleted.map(
        (row) => row.migration_id,
      ),
    };
  }

  if (incomplete.length > 0) {
    return {
      state: "incomplete",
      databaseFormatVersion: version,
      targetFormatVersion: AI_VERSE_DATA_DATABASE_FORMAT_VERSION,
      binding: metadata.binding,
      pendingMigrationIds: pending,
      incompleteMigrationIds: incomplete,
    };
  }

  return {
    state: "required",
    databaseFormatVersion: version,
    targetFormatVersion: AI_VERSE_DATA_DATABASE_FORMAT_VERSION,
    binding: metadata.binding,
    pendingMigrationIds: pending,
    incompleteMigrationIds: [],
  };
}

export function assertSqliteFormatCurrent(
  database: Database.Database,
  metadata: StorageDatabaseMetadata,
): void {
  const status = inspectSqliteMigrationState(database, metadata);
  if (status.state === "required") {
    throw new DataStorageError(
      "DATABASE_MIGRATION_REQUIRED",
      `Database format ${status.databaseFormatVersion} requires internal migration to format ${status.targetFormatVersion} before it can be opened.`,
    );
  }
  if (status.state === "incomplete") {
    throw new DataStorageError(
      "DATABASE_MIGRATION_INCOMPLETE",
      "Database has incomplete internal migration state and cannot be opened for normal use.",
    );
  }
}

function bindingEquals(
  left: StorageDatabaseBinding | null,
  right: StorageDatabaseBinding | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.bindingVersion === right.bindingVersion &&
    left.kind === right.kind &&
    left.workspaceId === right.workspaceId
  );
}

function parseBackupBinding(
  values: ReadonlyMap<string, string>,
): StorageDatabaseBinding | null {
  const bindingVersion = values.get("binding_version");
  const kind = values.get("scope_kind");
  const workspaceId = values.get("workspace_id");
  const present = [bindingVersion, kind, workspaceId].filter(
    (value) => value !== undefined,
  ).length;

  if (present === 0) return null;
  if (
    present !== 3 ||
    bindingVersion === undefined ||
    kind === undefined ||
    workspaceId === undefined
  ) {
    throw new DataStorageError(
      "MIGRATION_BACKUP_INVALID",
      "Migration backup contains incomplete scope-binding metadata.",
    );
  }

  const version = Number.parseInt(bindingVersion, 10);
  if (
    version !== AI_VERSE_DATA_SCOPE_BINDING_VERSION ||
    (kind !== "standalone" && kind !== "workspace") ||
    workspaceId.length < 1 ||
    workspaceId.length > 128 ||
    workspaceId === "." ||
    workspaceId === ".." ||
    workspaceId.includes("/") ||
    workspaceId.includes("\\") ||
    workspaceId.includes("\u0000")
  ) {
    throw new DataStorageError(
      "MIGRATION_BACKUP_INVALID",
      "Migration backup contains invalid scope-binding metadata.",
    );
  }

  return {
    bindingVersion: AI_VERSE_DATA_SCOPE_BINDING_VERSION,
    kind,
    workspaceId,
  };
}

function readBackupIdentity(database: Database.Database): StorageDatabaseMetadata {
  if (!hasTable(database, META_TABLE)) {
    throw new DataStorageError(
      "MIGRATION_BACKUP_INVALID",
      "Migration backup is missing AI-Verse Data metadata.",
    );
  }

  const rows = database
    .prepare(`SELECT key, value FROM ${META_TABLE}`)
    .all() as MetaRow[];
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const format = values.get("format");
  const formatVersionText = values.get("format_version");
  const createdAt = values.get("created_at");
  const driver = values.get("driver");

  if (
    format !== AI_VERSE_DATA_SQLITE_FORMAT ||
    driver !== "sqlite" ||
    formatVersionText === undefined ||
    createdAt === undefined ||
    Number.isNaN(Date.parse(createdAt))
  ) {
    throw new DataStorageError(
      "MIGRATION_BACKUP_INVALID",
      "Migration backup has invalid database identity metadata.",
    );
  }

  const formatVersion = Number.parseInt(formatVersionText, 10);
  const applicationId = database.pragma("application_id", {
    simple: true,
  });
  const userVersion = database.pragma("user_version", {
    simple: true,
  });

  if (
    !Number.isSafeInteger(formatVersion) ||
    formatVersion < AI_VERSE_DATA_MIN_MIGRATABLE_FORMAT_VERSION ||
    applicationId !== AI_VERSE_DATA_SQLITE_APPLICATION_ID ||
    userVersion !== formatVersion
  ) {
    throw new DataStorageError(
      "MIGRATION_BACKUP_INVALID",
      "Migration backup database identity signals disagree.",
    );
  }

  return {
    format: AI_VERSE_DATA_SQLITE_FORMAT,
    formatVersion,
    createdAt,
    driver: "sqlite",
    binding: parseBackupBinding(values),
  };
}

function assertRegularFile(path: string, label: string): void {
  if (!existsSync(path)) {
    throw new DataStorageError(
      "MIGRATION_BACKUP_INVALID",
      `${label} is missing.`,
    );
  }
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new DataStorageError(
      "MIGRATION_BACKUP_INVALID",
      `${label} must be a regular non-symlink file.`,
    );
  }
}

function readSmallFile(path: string, label: string): string {
  assertRegularFile(path, label);
  if (statSync(path).size > MAX_METADATA_BYTES) {
    throw new DataStorageError(
      "MIGRATION_BACKUP_INVALID",
      `${label} exceeds the migration metadata size ceiling.`,
    );
  }
  return readFileSync(path, "utf8");
}

function parseManifest(raw: string): StorageMigrationBackupManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new DataStorageError(
      "MIGRATION_BACKUP_INVALID",
      "Migration backup manifest is not valid JSON.",
      error,
    );
  }

  if (
    parsed === null ||
    Array.isArray(parsed) ||
    typeof parsed !== "object"
  ) {
    throw new DataStorageError(
      "MIGRATION_BACKUP_INVALID",
      "Migration backup manifest must be a JSON object.",
    );
  }

  const value = parsed as Partial<StorageMigrationBackupManifest>;
  if (
    value.format !== MIGRATION_BACKUP_MANIFEST_FORMAT ||
    value.formatVersion !== MIGRATION_BACKUP_FORMAT_VERSION ||
    typeof value.artifactId !== "string" ||
    !/^migration_backup_[0-9a-f]{32}$/.test(value.artifactId) ||
    typeof value.createdAt !== "string" ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    value.targetDatabaseFormatVersion !==
      AI_VERSE_DATA_DATABASE_FORMAT_VERSION ||
    value.source === undefined ||
    value.source === null ||
    Array.isArray(value.source) ||
    typeof value.source !== "object" ||
    value.source.databaseFormat !== AI_VERSE_DATA_SQLITE_FORMAT ||
    value.source.driver !== "sqlite" ||
    !Number.isSafeInteger(value.source.databaseFormatVersion) ||
    value.source.databaseFormatVersion <
      AI_VERSE_DATA_MIN_MIGRATABLE_FORMAT_VERSION ||
    value.source.databaseFormatVersion >=
      AI_VERSE_DATA_DATABASE_FORMAT_VERSION ||
    typeof value.source.databaseCreatedAt !== "string" ||
    Number.isNaN(Date.parse(value.source.databaseCreatedAt)) ||
    value.payload === undefined ||
    value.payload === null ||
    Array.isArray(value.payload) ||
    typeof value.payload !== "object" ||
    value.payload.file !== MIGRATION_PAYLOAD_FILE ||
    value.payload.mediaType !== "application/vnd.sqlite3" ||
    !Number.isSafeInteger(value.payload.bytes) ||
    value.payload.bytes < 0 ||
    !/^[0-9a-f]{64}$/.test(value.payload.sha256)
  ) {
    throw new DataStorageError(
      "MIGRATION_BACKUP_INVALID",
      "Migration backup manifest is malformed or unsupported.",
    );
  }

  return value as StorageMigrationBackupManifest;
}

function parseReceipt(raw: string): StorageMigrationBackupReceipt {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new DataStorageError(
      "MIGRATION_BACKUP_INVALID",
      "Migration backup receipt is not valid JSON.",
      error,
    );
  }

  if (
    parsed === null ||
    Array.isArray(parsed) ||
    typeof parsed !== "object"
  ) {
    throw new DataStorageError(
      "MIGRATION_BACKUP_INVALID",
      "Migration backup receipt must be a JSON object.",
    );
  }

  const value = parsed as Partial<StorageMigrationBackupReceipt>;
  if (
    value.format !== MIGRATION_BACKUP_RECEIPT_FORMAT ||
    value.formatVersion !== MIGRATION_BACKUP_FORMAT_VERSION ||
    typeof value.receiptId !== "string" ||
    !/^migration_receipt_[0-9a-f]{32}$/.test(value.receiptId) ||
    typeof value.artifactId !== "string" ||
    !/^migration_backup_[0-9a-f]{32}$/.test(value.artifactId) ||
    typeof value.completedAt !== "string" ||
    Number.isNaN(Date.parse(value.completedAt)) ||
    typeof value.manifestSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.manifestSha256) ||
    typeof value.payloadSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.payloadSha256) ||
    !Number.isSafeInteger(value.sourceDatabaseFormatVersion) ||
    value.targetDatabaseFormatVersion !==
      AI_VERSE_DATA_DATABASE_FORMAT_VERSION
  ) {
    throw new DataStorageError(
      "MIGRATION_BACKUP_INVALID",
      "Migration backup receipt is malformed or unsupported.",
    );
  }

  return value as StorageMigrationBackupReceipt;
}

export function verifySqliteMigrationBackup(
  options: StorageMigrationBackupVerifyOptions,
): StorageMigrationBackupVerification {
  const artifactDirectory = resolve(options.artifactDirectory);
  if (!existsSync(artifactDirectory)) {
    throw new DataStorageError(
      "MIGRATION_BACKUP_INVALID",
      "Migration backup artifact directory does not exist.",
    );
  }
  const directoryInfo = lstatSync(artifactDirectory);
  if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
    throw new DataStorageError(
      "MIGRATION_BACKUP_INVALID",
      "Migration backup artifact must be a regular non-symlink directory.",
    );
  }

  const manifestPath = join(artifactDirectory, MIGRATION_MANIFEST_FILE);
  const receiptPath = join(artifactDirectory, MIGRATION_RECEIPT_FILE);
  const payloadPath = join(artifactDirectory, MIGRATION_PAYLOAD_FILE);
  const manifestRaw = readSmallFile(manifestPath, "Migration backup manifest");
  const receiptRaw = readSmallFile(receiptPath, "Migration backup receipt");
  assertRegularFile(payloadPath, "Migration backup payload");

  const manifest = parseManifest(manifestRaw);
  const receipt = parseReceipt(receiptRaw);
  const payload = sha256FileSync(payloadPath);

  if (
    payload.bytes !== manifest.payload.bytes ||
    payload.sha256 !== manifest.payload.sha256 ||
    receipt.artifactId !== manifest.artifactId ||
    receipt.manifestSha256 !== sha256Text(manifestRaw) ||
    receipt.payloadSha256 !== manifest.payload.sha256 ||
    receipt.sourceDatabaseFormatVersion !==
      manifest.source.databaseFormatVersion
  ) {
    throw new DataStorageError(
      "MIGRATION_BACKUP_INVALID",
      "Migration backup manifest, receipt, and payload do not agree.",
    );
  }

  let database: Database.Database | undefined;
  try {
    database = new Database(payloadPath, {
      readonly: true,
      fileMustExist: true,
    });
    const rows = database.pragma("integrity_check") as IntegrityRow[];
    const messages = rows.map((row) =>
      String(row.integrity_check ?? Object.values(row)[0] ?? "unknown"),
    );
    if (
      messages.length !== 1 ||
      messages[0]?.toLowerCase() !== "ok"
    ) {
      throw new DataStorageError(
        "MIGRATION_BACKUP_INVALID",
        `Migration backup SQLite integrity check failed: ${messages.join("; ")}`,
      );
    }

    const identity = readBackupIdentity(database);
    if (
      identity.formatVersion !== manifest.source.databaseFormatVersion ||
      identity.createdAt !== manifest.source.databaseCreatedAt ||
      identity.driver !== manifest.source.driver ||
      !bindingEquals(identity.binding, manifest.source.binding)
    ) {
      throw new DataStorageError(
        "MIGRATION_BACKUP_INVALID",
        "Migration backup database identity does not match its manifest.",
      );
    }

    if (
      options.expectedBinding !== undefined &&
      !bindingEquals(identity.binding, options.expectedBinding)
    ) {
      throw new DataStorageError(
        "MIGRATION_BACKUP_INVALID",
        "Migration backup scope binding does not match the expected source binding.",
      );
    }
  } catch (error) {
    if (isDataStorageError(error)) throw error;
    throw new DataStorageError(
      "MIGRATION_BACKUP_INVALID",
      "Migration backup payload could not be verified.",
      error,
    );
  } finally {
    if (database !== undefined) database.close();
  }

  return { manifest, receipt };
}

async function createMigrationBackup(
  database: Database.Database,
  metadata: StorageDatabaseMetadata,
  backupDirectory: string,
): Promise<StorageMigrationBackupVerification> {
  const artifactDirectory = resolve(backupDirectory);
  if (existsSync(artifactDirectory)) {
    throw new DataStorageError(
      "MIGRATION_BACKUP_EXISTS",
      "Pre-migration backup destination already exists.",
    );
  }

  mkdirSync(dirname(artifactDirectory), { recursive: true });
  try {
    mkdirSync(artifactDirectory);
  } catch (error) {
    throw new DataStorageError(
      "DATABASE_UNAVAILABLE",
      "Pre-migration backup directory could not be created.",
      error,
    );
  }

  const payloadPath = join(artifactDirectory, MIGRATION_PAYLOAD_FILE);
  try {
    await backupSqliteDatabase(database, payloadPath);
    const payload = sha256FileSync(payloadPath);
    const artifactId = `migration_backup_${randomUUID().replaceAll("-", "")}`;
    const manifest: StorageMigrationBackupManifest = {
      format: MIGRATION_BACKUP_MANIFEST_FORMAT,
      formatVersion: MIGRATION_BACKUP_FORMAT_VERSION,
      artifactId,
      createdAt: new Date().toISOString(),
      source: {
        databaseFormat: metadata.format,
        databaseFormatVersion: metadata.formatVersion,
        driver: metadata.driver,
        databaseCreatedAt: metadata.createdAt,
        binding:
          metadata.binding === null ? null : { ...metadata.binding },
      },
      targetDatabaseFormatVersion: AI_VERSE_DATA_DATABASE_FORMAT_VERSION,
      payload: {
        file: MIGRATION_PAYLOAD_FILE,
        mediaType: "application/vnd.sqlite3",
        bytes: payload.bytes,
        sha256: payload.sha256,
      },
    };
    const manifestRaw = JSON.stringify(manifest);
    writeFileSync(
      join(artifactDirectory, MIGRATION_MANIFEST_FILE),
      manifestRaw,
      { encoding: "utf8", flag: "wx" },
    );

    const receipt: StorageMigrationBackupReceipt = {
      format: MIGRATION_BACKUP_RECEIPT_FORMAT,
      formatVersion: MIGRATION_BACKUP_FORMAT_VERSION,
      receiptId: `migration_receipt_${randomUUID().replaceAll("-", "")}`,
      artifactId,
      completedAt: new Date().toISOString(),
      manifestSha256: sha256Text(manifestRaw),
      payloadSha256: payload.sha256,
      sourceDatabaseFormatVersion: metadata.formatVersion,
      targetDatabaseFormatVersion: AI_VERSE_DATA_DATABASE_FORMAT_VERSION,
    };
    writeFileSync(
      join(artifactDirectory, MIGRATION_RECEIPT_FILE),
      JSON.stringify(receipt),
      { encoding: "utf8", flag: "wx" },
    );

    return verifySqliteMigrationBackup({
      artifactDirectory,
      expectedBinding: metadata.binding,
    });
  } catch (error) {
    rmSync(artifactDirectory, { recursive: true, force: true });
    if (isDataStorageError(error)) throw error;
    throw new DataStorageError(
      "DATABASE_UNAVAILABLE",
      "Pre-migration backup could not be created and verified.",
      error,
    );
  }
}

function registerMigrationStart(
  database: Database.Database,
  migration: MigrationDefinition,
  backup: StorageMigrationBackupVerification,
): void {
  createMigrationLedger(database);
  assertMigrationLedgerShape(database);

  const existing = database
    .prepare(
      `SELECT
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
       FROM ${MIGRATION_TABLE}
       WHERE migration_id = ?`,
    )
    .get(migration.id) as MigrationLedgerRow | undefined;

  if (existing !== undefined) {
    validateLedgerRow(existing);
    if (existing.state === "completed") {
      throw new DataStorageError(
        "DATABASE_MIGRATION_INCOMPLETE",
        `Migration '${migration.id}' is marked completed but the database format has not advanced.`,
      );
    }

    database
      .prepare(
        `UPDATE ${MIGRATION_TABLE}
         SET state = 'in_progress',
             attempt = ?,
             backup_artifact_id = ?,
             backup_payload_sha256 = ?,
             backup_manifest_sha256 = ?,
             started_at = ?,
             completed_at = NULL,
             failed_at = NULL,
             failure_message = NULL
         WHERE migration_id = ?`,
      )
      .run(
        existing.attempt + 1,
        backup.manifest.artifactId,
        backup.manifest.payload.sha256,
        backup.receipt.manifestSha256,
        new Date().toISOString(),
        migration.id,
      );
    return;
  }

  database
    .prepare(
      `INSERT INTO ${MIGRATION_TABLE} (
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
       ) VALUES (?, ?, ?, ?, 'in_progress', 1, ?, ?, ?, ?, NULL, NULL, NULL)`,
    )
    .run(
      migration.id,
      migration.definitionDigest,
      migration.fromVersion,
      migration.toVersion,
      backup.manifest.artifactId,
      backup.manifest.payload.sha256,
      backup.receipt.manifestSha256,
      new Date().toISOString(),
    );
}

function markMigrationFailed(
  database: Database.Database,
  migration: MigrationDefinition,
  error: unknown,
): void {
  const message =
    error instanceof Error ? error.message.slice(0, 1000) : "Unknown migration failure";
  database
    .prepare(
      `UPDATE ${MIGRATION_TABLE}
       SET state = 'failed',
           failed_at = ?,
           failure_message = ?,
           completed_at = NULL
       WHERE migration_id = ?`,
    )
    .run(new Date().toISOString(), message, migration.id);
}

function applyMigration(
  database: Database.Database,
  migration: MigrationDefinition,
): void {
  const currentMeta = database
    .prepare(
      `SELECT value FROM ${META_TABLE} WHERE key = 'format_version'`,
    )
    .get() as { readonly value: string } | undefined;
  const currentVersion = Number.parseInt(currentMeta?.value ?? "", 10);
  const userVersion = database.pragma("user_version", { simple: true });

  if (
    currentVersion !== migration.fromVersion ||
    userVersion !== migration.fromVersion
  ) {
    throw new DataStorageError(
      "DATABASE_MIGRATION_INCOMPLETE",
      `Migration '${migration.id}' source version changed before execution.`,
    );
  }

  migration.apply(database);

  database
    .prepare(
      `UPDATE ${META_TABLE}
       SET value = ?
       WHERE key = 'format_version'`,
    )
    .run(String(migration.toVersion));
  database.pragma(`user_version = ${migration.toVersion}`);

  const completedAt = new Date().toISOString();
  const updated = database
    .prepare(
      `UPDATE ${MIGRATION_TABLE}
       SET state = 'completed',
           completed_at = ?,
           failed_at = NULL,
           failure_message = NULL
       WHERE migration_id = ?
         AND state = 'in_progress'`,
    )
    .run(completedAt, migration.id);

  if (updated.changes !== 1) {
    throw new DataStorageError(
      "DATABASE_MIGRATION_INCOMPLETE",
      `Migration '${migration.id}' ledger state changed unexpectedly during execution.`,
    );
  }
}

export async function migrateSqliteDatabase(
  database: Database.Database,
  metadata: StorageDatabaseMetadata,
  backupDirectory: string,
): Promise<StorageMigrationResult> {
  const status = inspectSqliteMigrationState(database, metadata);
  if (status.state === "current") {
    return {
      state: "already-current",
      fromVersion: metadata.formatVersion,
      toVersion: AI_VERSE_DATA_DATABASE_FORMAT_VERSION,
      migrationIds: [],
      backup: null,
      completedAt: null,
    };
  }

  if (
    status.state === "incomplete" &&
    metadata.formatVersion === AI_VERSE_DATA_DATABASE_FORMAT_VERSION
  ) {
    throw new DataStorageError(
      "DATABASE_MIGRATION_INCOMPLETE",
      "Current-format database has incomplete migration ledger state and cannot be resumed as an older-format migration.",
    );
  }

  const path = requiredMigrationPath(metadata.formatVersion);
  const backup = await createMigrationBackup(
    database,
    metadata,
    backupDirectory,
  );

  database.pragma("foreign_keys = ON");
  const foreignKeys = database.pragma("foreign_keys", { simple: true });
  if (foreignKeys !== 1) {
    throw new DataStorageError(
      "DATABASE_MIGRATION_FAILED",
      "SQLite foreign-key enforcement could not be enabled for migration execution.",
    );
  }
  database.pragma("synchronous = NORMAL");
  database.pragma("busy_timeout = 5000");

  const executed: string[] = [];
  for (const migration of path) {
    try {
      database.transaction(() => {
        registerMigrationStart(database, migration, backup);
      }).immediate();

      database.transaction(() => {
        applyMigration(database, migration);
      }).immediate();

      executed.push(migration.id);
    } catch (error) {
      try {
        database.transaction(() => {
          markMigrationFailed(database, migration, error);
        }).immediate();
      } catch {
        // Preserve the primary migration failure. The surviving in-progress row
        // still blocks normal open and is detectable on the next inspection.
      }

      if (isDataStorageError(error)) {
        throw new DataStorageError(
          "DATABASE_MIGRATION_FAILED",
          `Internal migration '${migration.id}' failed. The canonical format version was not advanced.`,
          error,
        );
      }
      throw new DataStorageError(
        "DATABASE_MIGRATION_FAILED",
        `Internal migration '${migration.id}' failed. The canonical format version was not advanced.`,
        error,
      );
    }
  }

  const integrityRows = database.pragma("integrity_check") as IntegrityRow[];
  const integrityMessages = integrityRows.map((row) =>
    String(row.integrity_check ?? Object.values(row)[0] ?? "unknown"),
  );
  if (
    integrityMessages.length !== 1 ||
    integrityMessages[0]?.toLowerCase() !== "ok"
  ) {
    const finalMigration = executed.at(-1);
    if (finalMigration !== undefined) {
      try {
        database.transaction(() => {
          database.prepare(
            `UPDATE ${MIGRATION_TABLE}
             SET state = 'failed',
                 completed_at = NULL,
                 failed_at = ?,
                 failure_message = ?
             WHERE migration_id = ?`,
          ).run(
            new Date().toISOString(),
            `Post-migration SQLite integrity check failed: ${integrityMessages.join("; ")}`.slice(0, 1000),
            finalMigration,
          );
        }).immediate();
      } catch {
        // Preserve the primary integrity failure. A malformed ledger remains
        // fail-closed during normal open.
      }
    }
    throw new DataStorageError(
      "DATABASE_MIGRATION_FAILED",
      `Migrated database failed SQLite integrity verification: ${integrityMessages.join("; ")}`,
    );
  }

  return {
    state: "migrated",
    fromVersion: metadata.formatVersion,
    toVersion: AI_VERSE_DATA_DATABASE_FORMAT_VERSION,
    migrationIds: executed,
    backup,
    completedAt: new Date().toISOString(),
  };
}
