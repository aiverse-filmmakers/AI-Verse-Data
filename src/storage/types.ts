import type { DataCatalogStorage } from "./catalog-store.js";
import type { DataRecordStorage } from "./record-store.js";
import type { DataQueryStorage } from "./query-store.js";
import type { DataIdempotencyStorage } from "./idempotency-store.js";
import type { DataRelationStorage } from "./relation-store.js";
import type { DataProvenanceStorage } from "./provenance-store.js";

export const AI_VERSE_DATA_SQLITE_FORMAT = "ai-verse-data/sqlite" as const;
export const AI_VERSE_DATA_DATABASE_FORMAT_VERSION = 2 as const;
export const AI_VERSE_DATA_MIN_MIGRATABLE_FORMAT_VERSION = 1 as const;
export const AI_VERSE_DATA_MIGRATION_FRAMEWORK_VERSION = 1 as const;
export const AI_VERSE_DATA_SQLITE_APPLICATION_ID = 0x41495644 as const;
export const AI_VERSE_DATA_MIN_SQLITE_VERSION = "3.37.0" as const;
export const AI_VERSE_DATA_SCOPE_BINDING_VERSION = 1 as const;

export type StorageOpenMode = "create-or-open" | "open-existing";
export type StorageTransactionMode = "deferred" | "immediate";
export type StorageScopeKind = "standalone" | "workspace";

export interface StorageDatabaseBinding {
  readonly bindingVersion: typeof AI_VERSE_DATA_SCOPE_BINDING_VERSION;
  readonly kind: StorageScopeKind;
  readonly workspaceId: string;
}

export interface StorageOpenOptions {
  readonly location: string;
  readonly mode?: StorageOpenMode;
  readonly expectedBinding?: StorageDatabaseBinding;
}

export interface StorageDatabaseMetadata {
  readonly format: typeof AI_VERSE_DATA_SQLITE_FORMAT;
  readonly formatVersion: number;
  readonly createdAt: string;
  readonly driver: "sqlite";
  readonly binding: StorageDatabaseBinding | null;
}

export interface StorageDiagnostics {
  readonly driver: "sqlite";
  readonly sqliteVersion: string;
  readonly journalMode: string;
  readonly foreignKeys: boolean;
  readonly strictTables: boolean;
  readonly applicationId: number;
  readonly userVersion: number;
}

export interface IntegrityCheckResult {
  readonly ok: boolean;
  readonly messages: readonly string[];
}

export interface StorageBackupResult {
  readonly totalPages: number;
  readonly remainingPages: 0;
}

export type StorageMigrationState = "current" | "required" | "incomplete";

export interface StorageMigrationStatus {
  readonly state: StorageMigrationState;
  readonly databaseFormatVersion: number;
  readonly targetFormatVersion: typeof AI_VERSE_DATA_DATABASE_FORMAT_VERSION;
  readonly binding: StorageDatabaseBinding | null;
  readonly pendingMigrationIds: readonly string[];
  readonly incompleteMigrationIds: readonly string[];
}

export interface StorageMigrationBackupSource {
  readonly databaseFormat: typeof AI_VERSE_DATA_SQLITE_FORMAT;
  readonly databaseFormatVersion: number;
  readonly driver: "sqlite";
  readonly databaseCreatedAt: string;
  readonly binding: StorageDatabaseBinding | null;
}

export interface StorageMigrationBackupPayload {
  readonly file: "database.sqlite";
  readonly mediaType: "application/vnd.sqlite3";
  readonly bytes: number;
  readonly sha256: string;
}

export interface StorageMigrationBackupManifest {
  readonly format: "ai-verse-data/migration-backup-manifest";
  readonly formatVersion: 1;
  readonly artifactId: string;
  readonly createdAt: string;
  readonly source: StorageMigrationBackupSource;
  readonly targetDatabaseFormatVersion:
    typeof AI_VERSE_DATA_DATABASE_FORMAT_VERSION;
  readonly payload: StorageMigrationBackupPayload;
}

export interface StorageMigrationBackupReceipt {
  readonly format: "ai-verse-data/migration-backup-receipt";
  readonly formatVersion: 1;
  readonly receiptId: string;
  readonly artifactId: string;
  readonly completedAt: string;
  readonly manifestSha256: string;
  readonly payloadSha256: string;
  readonly sourceDatabaseFormatVersion: number;
  readonly targetDatabaseFormatVersion:
    typeof AI_VERSE_DATA_DATABASE_FORMAT_VERSION;
}

export interface StorageMigrationBackupVerification {
  readonly manifest: StorageMigrationBackupManifest;
  readonly receipt: StorageMigrationBackupReceipt;
}

export interface StorageMigrationInspectOptions {
  readonly location: string;
  readonly expectedBinding?: StorageDatabaseBinding;
}

export interface StorageMigrationOptions
  extends StorageMigrationInspectOptions {
  readonly backupDirectory: string;
}

export interface StorageMigrationBackupVerifyOptions {
  readonly artifactDirectory: string;
  readonly expectedBinding?: StorageDatabaseBinding | null;
}

export interface StorageMigrationResult {
  readonly state: "migrated" | "already-current";
  readonly fromVersion: number;
  readonly toVersion: typeof AI_VERSE_DATA_DATABASE_FORMAT_VERSION;
  readonly migrationIds: readonly string[];
  readonly backup: StorageMigrationBackupVerification | null;
  readonly completedAt: string | null;
}

export interface DataStorageDatabase {
  readonly driverKind: string;
  metadata(): StorageDatabaseMetadata;
  diagnostics(): StorageDiagnostics;
  integrityCheck(): IntegrityCheckResult;
  backupTo(location: string): Promise<StorageBackupResult>;
  catalogStorage(): DataCatalogStorage;
  recordStorage(): DataRecordStorage;
  queryStorage(): DataQueryStorage;
  relationStorage(): DataRelationStorage;
  idempotencyStorage(): DataIdempotencyStorage;
  provenanceStorage(): DataProvenanceStorage;
  transaction<T>(
    operation: () => T,
    mode?: StorageTransactionMode,
  ): T;
  close(): void;
}

export interface DataStorageDriver {
  readonly kind: string;
  open(options: StorageOpenOptions): DataStorageDatabase;
  inspectMigration(options: StorageMigrationInspectOptions): StorageMigrationStatus;
  migrate(options: StorageMigrationOptions): Promise<StorageMigrationResult>;
  verifyMigrationBackup(
    options: StorageMigrationBackupVerifyOptions,
  ): StorageMigrationBackupVerification;
}
