export const AI_VERSE_DATA_INSTRUCTIONS_MAX_FILE_BYTES =
  1024 * 1024;
export const AI_VERSE_DATA_INSTRUCTIONS_MAX_TASK_HINT_LENGTH = 512;

export type AiVerseDataInstructionDiscoveryStatus =
  | "ready"
  | "disabled"
  | "not-installed";

export interface AiVerseDataInstructionProvenance {
  readonly extensionId: "ai-verse-data";
  readonly version: string;
  readonly source: string;
  readonly supported: boolean;
  readonly installed: boolean;
  readonly enabled: boolean;
  readonly registryExists: boolean;
  readonly instructionsRelativePath: string | null;
  readonly engineRelativePath: string | null;
  readonly adapterRelativePaths: readonly string[];
}

export interface AiVerseDataDiscoveredFile {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly contents: string;
}

export interface AiVerseDataInstructionDiscoveryInput {
  readonly rootPath: string;
  readonly taskHint?: string;
}

export interface AiVerseDataInstructionDiscoveryResult {
  readonly status: AiVerseDataInstructionDiscoveryStatus;
  readonly rootPath: string;
  readonly taskHint: string | null;
  readonly taskRelevant: boolean;
  readonly matchedTerms: readonly string[];
  readonly provenance: AiVerseDataInstructionProvenance;
  readonly instructions: AiVerseDataDiscoveredFile | null;
  readonly engine: AiVerseDataDiscoveredFile | null;
  readonly adapters: readonly AiVerseDataDiscoveredFile[];
  readonly manifest: AiVerseDataDiscoveredFile | null;
}

export interface AiVerseDataInstructionDiscoveryApi {
  discover(
    input: AiVerseDataInstructionDiscoveryInput,
  ): AiVerseDataInstructionDiscoveryResult;
}

export type AiVerseDataInstructionErrorCode =
  | "AI_VERSE_OS_NOT_FOUND"
  | "INCOMPATIBLE_AI_VERSE_OS"
  | "INVALID_EXTENSION_PATH"
  | "SYMLINK_PATH_REJECTED"
  | "INVALID_EXTENSION_FILE"
  | "EXTENSION_FILE_TOO_LARGE"
  | "EXTENSION_FILE_UNREADABLE"
  | "INVALID_EXTENSION_REGISTRY"
  | "UNSUPPORTED_EXTENSION_REGISTRY_SCHEMA"
  | "INVALID_EXISTING_EXTENSION_ENTRY"
  | "INVALID_TASK_HINT";

export class AiVerseDataInstructionError extends Error {
  readonly code: AiVerseDataInstructionErrorCode;

  constructor(
    code: AiVerseDataInstructionErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AiVerseDataInstructionError";
    this.code = code;
  }
}
