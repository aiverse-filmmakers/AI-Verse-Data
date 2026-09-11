export type DataStorageErrorCode =
  | "DATABASE_NOT_FOUND"
  | "DATABASE_UNAVAILABLE"
  | "DATABASE_FORMAT_UNRECOGNIZED"
  | "DATABASE_VERSION_UNSUPPORTED"
  | "DATABASE_MIGRATION_REQUIRED"
  | "DATABASE_MIGRATION_INCOMPLETE"
  | "DATABASE_MIGRATION_FAILED"
  | "MIGRATION_BACKUP_INVALID"
  | "MIGRATION_BACKUP_EXISTS"
  | "DATABASE_SCOPE_CONFLICT"
  | "DATABASE_CORRUPT"
  | "SQLITE_VERSION_UNSUPPORTED";

export class DataStorageError extends Error {
  readonly code: DataStorageErrorCode;

  constructor(code: DataStorageErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "DataStorageError";
    this.code = code;
  }
}

export function isDataStorageError(error: unknown): error is DataStorageError {
  return error instanceof DataStorageError;
}
