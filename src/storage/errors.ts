export type DataStorageErrorCode =
  | "DATABASE_NOT_FOUND"
  | "DATABASE_UNAVAILABLE"
  | "DATABASE_FORMAT_UNRECOGNIZED"
  | "DATABASE_VERSION_UNSUPPORTED"
  | "DATABASE_CORRUPT"
  | "SQLITE_VERSION_UNSUPPORTED";

export class DataStorageError extends Error {
  readonly code: DataStorageErrorCode;
  readonly cause?: unknown;

  constructor(code: DataStorageErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "DataStorageError";
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export function isDataStorageError(error: unknown): error is DataStorageError {
  return error instanceof DataStorageError;
}
