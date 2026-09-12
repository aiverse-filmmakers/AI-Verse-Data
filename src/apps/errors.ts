export type AppsDataErrorCode =
  | "APPS_INVALID"
  | "APPS_CLOSED"
  | "APPS_PERMISSION_DENIED";

export class AppsDataError extends Error {
  readonly code: AppsDataErrorCode;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: AppsDataErrorCode,
    message: string,
    details?: Readonly<Record<string, string | number | boolean | null>>,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AppsDataError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function isAppsDataError(error: unknown): error is AppsDataError {
  return error instanceof AppsDataError;
}
