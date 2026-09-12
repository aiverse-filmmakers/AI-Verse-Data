export type BrainDataAdapterErrorCode =
  | "BRAIN_INVALID"
  | "BRAIN_CLOSED";

export class BrainDataAdapterError extends Error {
  readonly code: BrainDataAdapterErrorCode;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: BrainDataAdapterErrorCode,
    message: string,
    details?: Readonly<Record<string, string | number | boolean | null>>,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "BrainDataAdapterError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function isBrainDataAdapterError(
  error: unknown,
): error is BrainDataAdapterError {
  return error instanceof BrainDataAdapterError;
}
