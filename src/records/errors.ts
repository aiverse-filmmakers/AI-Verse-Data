export type DataRecordErrorCode =
  | "RECORD_NOT_FOUND"
  | "RECORD_VERSION_CONFLICT"
  | "FIELD_UNKNOWN"
  | "FIELD_INVALID"
  | "REFERENCE_INVALID"
  | "DATABASE_CORRUPT"
  | "INTERNAL_ERROR";

export class DataRecordError extends Error {
  readonly code: DataRecordErrorCode;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: DataRecordErrorCode,
    message: string,
    details?: Readonly<Record<string, string | number | boolean | null>>,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "DataRecordError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function isDataRecordError(error: unknown): error is DataRecordError {
  return error instanceof DataRecordError;
}
