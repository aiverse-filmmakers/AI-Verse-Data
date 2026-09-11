export type DataBackupErrorCode =
  | "ARTIFACT_ALREADY_EXISTS"
  | "ARTIFACT_NOT_FOUND"
  | "ARTIFACT_INVALID"
  | "ARTIFACT_FORMAT_UNSUPPORTED"
  | "ARTIFACT_DIGEST_MISMATCH"
  | "ARTIFACT_SCOPE_CONFLICT"
  | "DESTINATION_ALREADY_EXISTS"
  | "DATABASE_CORRUPT"
  | "DATABASE_UNAVAILABLE";

export class DataBackupError extends Error {
  readonly code: DataBackupErrorCode;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: DataBackupErrorCode,
    message: string,
    details?: Readonly<Record<string, string | number | boolean | null>>,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "DataBackupError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function isDataBackupError(error: unknown): error is DataBackupError {
  return error instanceof DataBackupError;
}
