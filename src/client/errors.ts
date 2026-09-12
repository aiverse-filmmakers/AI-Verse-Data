export type DataClientErrorCode =
  | "CLIENT_INVALID"
  | "CLIENT_CLOSED"
  | "AUTHORIZATION_INVALID"
  | "SCOPE_INVALID";

export class DataClientError extends Error {
  readonly code: DataClientErrorCode;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: DataClientErrorCode,
    message: string,
    details?: Readonly<Record<string, string | number | boolean | null>>,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "DataClientError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function isDataClientError(error: unknown): error is DataClientError {
  return error instanceof DataClientError;
}
