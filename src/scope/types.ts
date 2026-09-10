import type {
  DataStorageDatabase,
  DataStorageDriver,
  StorageDatabaseBinding,
  StorageOpenMode,
} from "../storage/index.js";

export type DataScopeKind = StorageDatabaseBinding["kind"];

export interface ScopedDatabaseOpenOptions {
  readonly mode?: StorageOpenMode;
}

export interface ScopedDatabaseHandle {
  readonly scope: DataDatabaseScope;
  readonly database: DataStorageDatabase;
}

export interface ScopeStorageOpener {
  open(
    driver: DataStorageDriver,
    scope: DataDatabaseScope,
    options?: ScopedDatabaseOpenOptions,
  ): ScopedDatabaseHandle;
}

export interface TrustedRootView {
  readonly canonicalPath: string;
}

export interface DataDatabaseScope {
  readonly kind: DataScopeKind;
  readonly workspaceId: string;
  readonly binding: StorageDatabaseBinding;
  readonly root: TrustedRootView;
  databasePath(): string;
}
