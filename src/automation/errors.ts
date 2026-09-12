export type AutomationEventsErrorCode =
  | "AUTOMATION_INVALID"
  | "AUTOMATION_CLOSED";

export class AutomationEventsError extends Error {
  readonly code: AutomationEventsErrorCode;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: AutomationEventsErrorCode,
    message: string,
    details?: Readonly<Record<string, string | number | boolean | null>>,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AutomationEventsError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function isAutomationEventsError(
  error: unknown,
): error is AutomationEventsError {
  return error instanceof AutomationEventsError;
}
