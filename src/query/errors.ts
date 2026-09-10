export type DataQueryErrorCode =
  | "QUERY_INVALID"
  | "QUERY_LIMIT_EXCEEDED"
  | "DATABASE_CORRUPT";

export class DataQueryError extends Error {
  readonly code: DataQueryErrorCode;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: DataQueryErrorCode,
    message: string,
    details?: Readonly<Record<string, string | number | boolean | null>>,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "DataQueryError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function isDataQueryError(error: unknown): error is DataQueryError {
  return error instanceof DataQueryError;
}
