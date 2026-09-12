export type DashboardProjectionErrorCode =
  | "DASHBOARD_INVALID"
  | "DASHBOARD_CLOSED";

export class DashboardProjectionError extends Error {
  readonly code: DashboardProjectionErrorCode;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: DashboardProjectionErrorCode,
    message: string,
    details?: Readonly<Record<string, string | number | boolean | null>>,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "DashboardProjectionError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function isDashboardProjectionError(
  error: unknown,
): error is DashboardProjectionError {
  return error instanceof DashboardProjectionError;
}
