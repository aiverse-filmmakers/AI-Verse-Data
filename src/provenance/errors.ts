export type DataProvenanceErrorCode =
  | "QUERY_INVALID"
  | "RECEIPT_NOT_FOUND"
  | "DATABASE_CORRUPT";

export class DataProvenanceError extends Error {
  readonly code: DataProvenanceErrorCode;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: DataProvenanceErrorCode,
    message: string,
    details?: Readonly<Record<string, string | number | boolean | null>>,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "DataProvenanceError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
