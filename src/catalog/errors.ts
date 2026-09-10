export type DataCatalogErrorCode =
  | "DATA_SPACE_NOT_FOUND"
  | "DATA_SPACE_ALREADY_EXISTS"
  | "ENTITY_NOT_FOUND"
  | "ENTITY_ALREADY_EXISTS"
  | "SCHEMA_VERSION_NOT_FOUND"
  | "SCHEMA_VERSION_CONFLICT"
  | "SCHEMA_MIGRATION_REQUIRED"
  | "SCHEMA_INVALID"
  | "DATABASE_CORRUPT";

export class DataCatalogError extends Error {
  readonly code: DataCatalogErrorCode;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: DataCatalogErrorCode,
    message: string,
    details?: Readonly<Record<string, string | number | boolean | null>>,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "DataCatalogError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function isDataCatalogError(error: unknown): error is DataCatalogError {
  return error instanceof DataCatalogError;
}
