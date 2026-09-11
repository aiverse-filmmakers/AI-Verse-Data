export type DataSchemaMigrationErrorCode =
  | "SCHEMA_MIGRATION_INVALID"
  | "SCHEMA_MIGRATION_STALE"
  | "SCHEMA_MIGRATION_LIMIT_EXCEEDED"
  | "APPROVAL_REQUIRED"
  | "DATABASE_CORRUPT"
  | "INTERNAL_ERROR";

export class DataSchemaMigrationError extends Error {
  readonly code: DataSchemaMigrationErrorCode;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: DataSchemaMigrationErrorCode,
    message: string,
    details?: Readonly<Record<string, string | number | boolean | null>>,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "DataSchemaMigrationError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function isDataSchemaMigrationError(
  error: unknown,
): error is DataSchemaMigrationError {
  return error instanceof DataSchemaMigrationError;
}
