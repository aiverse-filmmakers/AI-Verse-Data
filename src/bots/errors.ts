export type BotsDataPrincipalKind = "bot" | "worker";

export type BotsDataAction =
  | "read"
  | "create"
  | "update"
  | "delete";

export interface BotsDataPrincipal {
  readonly kind: BotsDataPrincipalKind;
  readonly id: string;
}

export interface BotsDataCapabilityLease {
  readonly workspaceId: string;
  readonly principal: BotsDataPrincipal;
  readonly taskId: string;
  readonly capabilities: readonly string[];
  readonly expiresAt?: string;
  readonly artifactRef?: string;
}

export interface CreateBotsDataAdapterOptions {
  readonly lease: BotsDataCapabilityLease;
}

export type BotsDataAdapterErrorCode =
  | "LEASE_INVALID"
  | "LEASE_EXPIRED"
  | "LEASE_WORKSPACE_MISMATCH"
  | "PRINCIPAL_MISMATCH"
  | "CAPABILITY_DENIED";

export class BotsDataAdapterError extends Error {
  readonly code: BotsDataAdapterErrorCode;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: BotsDataAdapterErrorCode,
    message: string,
    details?: Readonly<Record<string, string | number | boolean | null>>,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "BotsDataAdapterError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function isBotsDataAdapterError(
  error: unknown,
): error is BotsDataAdapterError {
  return error instanceof BotsDataAdapterError;
}
