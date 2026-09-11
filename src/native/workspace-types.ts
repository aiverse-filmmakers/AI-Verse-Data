export const AI_VERSE_WORKSPACE_SCHEMA_MAJOR = 2 as const;
export const AI_VERSE_WORKSPACE_MANIFEST_FILENAME =
  "WORKSPACE.yaml" as const;
export const AI_VERSE_WORKSPACE_DATA_FILENAME =
  "ai-verse-data.sqlite" as const;
export const AI_VERSE_WORKSPACE_ID_PATTERN =
  /^[a-z0-9][a-z0-9-]*$/;
export const AI_VERSE_WORKSPACE_MAX_ID_LENGTH = 128 as const;
export const AI_VERSE_WORKSPACE_MAX_MANIFEST_BYTES = 1024 * 1024;

export type AiVerseWorkspaceStatus =
  | "active"
  | "paused"
  | "archived";

export interface AiVerseWorkspaceManifest {
  readonly schemaMajor: number;
  readonly workspaceId: string;
  readonly name: string;
  readonly type: string;
  readonly status: AiVerseWorkspaceStatus;
  readonly purpose: string;
}

export interface AiVerseWorkspaceInput {
  readonly rootPath: string;
  readonly workspaceId: string;
}

export interface AiVerseResolvedWorkspace {
  readonly rootPath: string;
  readonly workspaceId: string;
  readonly workspacePath: string;
  readonly manifestPath: string;
  readonly manifest: AiVerseWorkspaceManifest;
  readonly databaseRelativePath: string;
  readonly databasePath: string;
}

export type AiVerseWorkspaceDataDiscoveryState =
  | "missing"
  | "compatible"
  | "migration_required"
  | "quarantined"
  | "scope_conflict"
  | "unsupported"
  | "unavailable";

export interface AiVerseWorkspaceDataDiscoveryResult {
  readonly state: AiVerseWorkspaceDataDiscoveryState;
  readonly workspaceId: string;
  readonly databasePath: string;
  readonly detail: string;
  readonly nativeDetail?:
    | "current"
    | "required"
    | "incomplete"
    | "quarantined"
    | "corrupt"
    | "unrecognized"
    | "unsupported"
    | "scope_conflict"
    | "missing"
    | "unavailable";
  readonly databaseFormatVersion: number | null;
  readonly bindingWorkspaceId: string | null;
}

export type AiVerseWorkspaceInitStatus = "created" | "unchanged";

export interface AiVerseWorkspaceInitResult {
  readonly status: AiVerseWorkspaceInitStatus;
  readonly workspaceId: string;
  readonly workspacePath: string;
  readonly databasePath: string;
  readonly workspaceStatus: AiVerseWorkspaceStatus;
  readonly discovery: AiVerseWorkspaceDataDiscoveryResult;
}

export interface AiVerseWorkspaceResolverApi {
  resolve(
    input: AiVerseWorkspaceInput,
  ): AiVerseResolvedWorkspace;
}

export interface AiVerseWorkspaceInitApi {
  initialize(
    input: AiVerseWorkspaceInput,
  ): Promise<AiVerseWorkspaceInitResult>;
}

export interface AiVerseWorkspaceDiscoveryApi {
  discover(
    input: AiVerseWorkspaceInput,
  ): Promise<AiVerseWorkspaceDataDiscoveryResult>;
}

export type AiVerseWorkspaceErrorCode =
  | "AI_VERSE_OS_NOT_FOUND"
  | "INCOMPATIBLE_AI_VERSE_OS"
  | "INVALID_WORKSPACE_ID"
  | "WORKSPACE_NOT_FOUND"
  | "WORKSPACE_UNSAFE"
  | "WORKSPACE_MANIFEST_MISSING"
  | "WORKSPACE_MANIFEST_UNSAFE"
  | "WORKSPACE_MANIFEST_TOO_LARGE"
  | "WORKSPACE_MANIFEST_MALFORMED"
  | "WORKSPACE_SCHEMA_UNSUPPORTED"
  | "WORKSPACE_ID_MISMATCH"
  | "WORKSPACE_STATUS_INVALID"
  | "WORKSPACE_NOT_ACTIVE"
  | "WORKSPACE_DATA_UNSAFE"
  | "WORKSPACE_DATA_UNAVAILABLE"
  | "WORKSPACE_DATABASE_CONFLICT"
  | "WORKSPACE_DATABASE_MIGRATION_REQUIRED"
  | "WORKSPACE_DATABASE_QUARANTINED"
  | "WORKSPACE_DATABASE_UNSUPPORTED";

export class AiVerseWorkspaceError extends Error {
  readonly code: AiVerseWorkspaceErrorCode;

  constructor(
    code: AiVerseWorkspaceErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AiVerseWorkspaceError";
    this.code = code;
  }
}
