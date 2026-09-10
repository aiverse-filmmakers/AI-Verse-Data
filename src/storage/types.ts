export const AI_VERSE_DATA_SQLITE_FORMAT = "ai-verse-data/sqlite" as const;
export const AI_VERSE_DATA_DATABASE_FORMAT_VERSION = 1 as const;
export const AI_VERSE_DATA_SQLITE_APPLICATION_ID = 0x41495644 as const;
export const AI_VERSE_DATA_MIN_SQLITE_VERSION = "3.37.0" as const;
export const AI_VERSE_DATA_SCOPE_BINDING_VERSION = 1 as const;

export type StorageOpenMode = "create-or-open" | "open-existing";
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

export interface DataStorageDatabase {
  readonly driverKind: string;
  metadata(): StorageDatabaseMetadata;
  diagnostics(): StorageDiagnostics;
  integrityCheck(): IntegrityCheckResult;
  close(): void;
}

export interface DataStorageDriver {
  readonly kind: string;
  open(options: StorageOpenOptions): DataStorageDatabase;
}
