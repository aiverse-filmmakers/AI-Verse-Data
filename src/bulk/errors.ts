export type DataBulkErrorCode =
  | "BULK_INVALID"
  | "BULK_LIMIT_EXCEEDED"
  | "BULK_PREVIEW_STALE"
  | "DATABASE_CORRUPT";

export class DataBulkError extends Error {
  readonly code: DataBulkErrorCode;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: DataBulkErrorCode,
    message: string,
    details?: Readonly<Record<string, string | number | boolean | null>>,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "DataBulkError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
