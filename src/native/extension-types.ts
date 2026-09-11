export const AI_VERSE_OS_EXTENSION_REGISTRY_SCHEMA = "1.0" as const;
export const AI_VERSE_OS_EXTENSION_REGISTRY_LOCK_PATH =
  ".aiverse/extensions/registry.json.lock" as const;

export const AI_VERSE_DATA_EXTENSION_ID = "ai-verse-data" as const;
export const AI_VERSE_DATA_EXTENSION_SOURCE = "AI-Verse-Data" as const;
export const AI_VERSE_DATA_EXTENSION_VERSION = "0.1.0-alpha.0" as const;
export const AI_VERSE_DATA_EXTENSION_ROOT =
  ".aiverse/extensions/ai-verse-data" as const;
export const AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH =
  ".aiverse/extensions/ai-verse-data/INSTRUCTIONS.md" as const;
export const AI_VERSE_DATA_EXTENSION_ENGINE_PATH =
  ".aiverse/extensions/ai-verse-data/engine.mjs" as const;
export const AI_VERSE_DATA_EXTENSION_MANIFEST_PATH =
  ".aiverse/extensions/ai-verse-data/extension.json" as const;

export type JsonObject = Record<string, unknown>;

export type AiVerseDataExtensionInstallStatus =
  | "installed"
  | "updated"
  | "unchanged";

export interface AiVerseDataExtensionInstallInput {
  readonly rootPath: string;
}

export interface AiVerseDataOwnedFilePlan {
  readonly relativePath: string;
  readonly exists: boolean;
  readonly requiresWrite: boolean;
}

export interface AiVerseDataExtensionInstallPlan {
  readonly rootPath: string;
  readonly registryRelativePath: ".aiverse/extensions/registry.json";
  readonly registryLockRelativePath: typeof AI_VERSE_OS_EXTENSION_REGISTRY_LOCK_PATH;
  readonly extensionRootRelativePath: typeof AI_VERSE_DATA_EXTENSION_ROOT;
  readonly currentEntry: Readonly<JsonObject> | null;
  readonly nextEntry: Readonly<JsonObject>;
  readonly ownedFiles: readonly AiVerseDataOwnedFilePlan[];
  readonly registryExists: boolean;
  readonly registryRequiresWrite: boolean;
  readonly requiresWrite: boolean;
  readonly trackedOsFilesMutated: readonly [];
  readonly preservesUnknownRegistryFields: true;
  readonly preservesCanonicalWorkspaceData: true;
}

export interface AiVerseDataExtensionInstallResult
  extends AiVerseDataExtensionInstallPlan {
  readonly status: AiVerseDataExtensionInstallStatus;
  readonly materializedPaths: readonly string[];
  readonly registryWritten: boolean;
}

export interface AiVerseDataExtensionInstallerApi {
  plan(
    input: AiVerseDataExtensionInstallInput,
  ): AiVerseDataExtensionInstallPlan;
  install(
    input: AiVerseDataExtensionInstallInput,
  ): AiVerseDataExtensionInstallResult;
}

export type AiVerseDataExtensionInstallErrorCode =
  | "AI_VERSE_OS_NOT_FOUND"
  | "INCOMPATIBLE_AI_VERSE_OS"
  | "INVALID_EXTENSION_PATH"
  | "SYMLINK_PATH_REJECTED"
  | "INVALID_EXTENSION_DIRECTORY"
  | "INVALID_EXTENSION_FILE"
  | "INVALID_EXTENSION_REGISTRY"
  | "UNSUPPORTED_EXTENSION_REGISTRY_SCHEMA"
  | "INVALID_EXISTING_EXTENSION_ENTRY"
  | "EXTENSION_REGISTRY_BUSY"
  | "EXTENSION_REGISTRY_LOCK_FAILED"
  | "EXTENSION_REGISTRY_CHANGED"
  | "EXTENSION_MATERIALIZATION_FAILED"
  | "EXTENSION_ROLLBACK_FAILED";

export class AiVerseDataExtensionInstallError extends Error {
  readonly code: AiVerseDataExtensionInstallErrorCode;

  constructor(
    code: AiVerseDataExtensionInstallErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AiVerseDataExtensionInstallError";
    this.code = code;
  }
}
