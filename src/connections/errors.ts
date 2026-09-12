export type ConnectionsAuthorityErrorCode =
  | "CONNECTIONS_INVALID"
  | "CONNECTIONS_CLOSED"
  | "CONNECTIONS_AUTHORITY_DENIED";

export class ConnectionsAuthorityError extends Error {
  readonly code: ConnectionsAuthorityErrorCode;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: ConnectionsAuthorityErrorCode,
    message: string,
    details?: Readonly<Record<string, string | number | boolean | null>>,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ConnectionsAuthorityError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function isConnectionsAuthorityError(
  error: unknown,
): error is ConnectionsAuthorityError {
  return error instanceof ConnectionsAuthorityError;
}
