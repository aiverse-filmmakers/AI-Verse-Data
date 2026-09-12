import type { AiVerseDataExtensionInstallErrorCode } from "./extension-types.js";

export type AiVerseDataLifecycleCommand =
  | "install"
  | "update"
  | "enable"
  | "disable"
  | "uninstall";

export type AiVerseDataLifecycleStatus =
  | "installed"
  | "updated"
  | "unchanged"
  | "enabled"
  | "disabled"
  | "uninstalled"
  | "not-installed";

export interface AiVerseDataLifecycleInput {
  readonly rootPath: string;
}

export interface AiVerseDataLifecycleResult {
  readonly command: AiVerseDataLifecycleCommand;
  readonly status: AiVerseDataLifecycleStatus;
  readonly rootPath: string;
  readonly registryWritten: boolean;
  readonly materializedPaths: readonly string[];
  readonly removedPaths: readonly string[];
  readonly enabled: boolean | null;
  readonly preservesCanonicalWorkspaceData: true;
  readonly trackedOsFilesMutated: readonly [];
}

export type AiVerseDataLifecycleErrorCode =
  | AiVerseDataExtensionInstallErrorCode
  | "EXTENSION_NOT_INSTALLED";

export class AiVerseDataLifecycleError extends Error {
  readonly code: AiVerseDataLifecycleErrorCode;

  constructor(
    code: AiVerseDataLifecycleErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AiVerseDataLifecycleError";
    this.code = code;
  }
}
