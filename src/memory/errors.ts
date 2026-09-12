export type MemoryBridgeErrorCode =
  | "MEMORY_INVALID"
  | "MEMORY_CLOSED";

export class MemoryBridgeError extends Error {
  readonly code: MemoryBridgeErrorCode;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: MemoryBridgeErrorCode,
    message: string,
    details?: Readonly<Record<string, string | number | boolean | null>>,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "MemoryBridgeError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function isMemoryBridgeError(
  error: unknown,
): error is MemoryBridgeError {
  return error instanceof MemoryBridgeError;
}
