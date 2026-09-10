export type DataIdempotencyErrorCode =
  | "IDEMPOTENCY_CONFLICT"
  | "DATABASE_CORRUPT";

export class DataIdempotencyError extends Error {
  readonly code: DataIdempotencyErrorCode;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: DataIdempotencyErrorCode,
    message: string,
    details?: Readonly<Record<string, string | number | boolean | null>>,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "DataIdempotencyError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function isDataIdempotencyError(
  error: unknown,
): error is DataIdempotencyError {
  return error instanceof DataIdempotencyError;
}
