export type DataTransactionErrorCode =
  | "TRANSACTION_INVALID"
  | "REFERENCE_INVALID"
  | "QUERY_LIMIT_EXCEEDED";

export class DataTransactionError extends Error {
  readonly code: DataTransactionErrorCode;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: DataTransactionErrorCode,
    message: string,
    details?: Readonly<Record<string, string | number | boolean | null>>,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "DataTransactionError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
