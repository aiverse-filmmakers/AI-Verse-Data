export type DataRecoveryErrorCode =
  | "RECOVERY_BINDING_CONFLICT"
  | "RECOVERY_DESTINATION_CONFLICT"
  | "RECOVERY_DESTINATION_UNHEALTHY"
  | "DATABASE_UNAVAILABLE";

export class DataRecoveryError extends Error {
  readonly code: DataRecoveryErrorCode;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: DataRecoveryErrorCode,
    message: string,
    details?: Readonly<Record<string, string | number | boolean | null>>,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "DataRecoveryError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function isDataRecoveryError(
  error: unknown,
): error is DataRecoveryError {
  return error instanceof DataRecoveryError;
}
