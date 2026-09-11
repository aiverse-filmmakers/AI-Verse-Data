import type { DataRecoveryReport, DataRecoveryState } from "../recovery/index.js";
import type {
  DataDatabaseScope,
  ScopedDatabaseHandle,
} from "../scope/index.js";
import type { StorageDatabaseMetadata } from "../storage/index.js";

export const AI_VERSE_WORKSPACE_SUPPORTED_SCHEMA_MAJOR = 2 as const;
export const AI_VERSE_WORKSPACE_MANIFEST = "WORKSPACE.yaml" as const;
export const AI_VERSE_WORKSPACE_MAX_MANIFEST_BYTES = 1024 * 1024 as const;

export type AiVerseWorkspaceStatus = "active" | "paused" | "archived";

export interface AiVerseWorkspaceManifestSummary {
  readonly schemaMajor: typeof AI_VERSE_WORKSPACE_SUPPORTED_SCHEMA_MAJOR;
  readonly schemaVersion: string;
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly status: AiVerseWorkspaceStatus;
  readonly purpose: string;
}

export interface AiVerseWorkspaceResolveInput {
  readonly rootPath: string;
  readonly workspaceId: string;
}

export interface AiVerseWorkspaceResolution {
  readonly rootPath: string;
  readonly workspaceId: string;
  readonly workspaceRelativePath: string;
  readonly manifestRelativePath: string;
  readonly databaseRelativePath: string;
  readonly manifest: AiVerseWorkspaceManifestSummary;
  readonly scope: DataDatabaseScope;
}

export interface AiVerseWorkspaceDatabaseDiscovery {
  readonly workspace: AiVerseWorkspaceResolution;
  readonly state: DataRecoveryState;
  readonly recovery: DataRecoveryReport;
  readonly auxiliaryResidue: readonly string[];
  readonly cleanMissing: boolean;
}

export type AiVerseWorkspaceInitializationStatus =
  | "initialized"
  | "already_initialized";

export interface AiVerseWorkspaceInitializationResult {
  readonly status: AiVerseWorkspaceInitializationStatus;
  readonly workspace: AiVerseWorkspaceResolution;
  readonly discovery: AiVerseWorkspaceDatabaseDiscovery;
  readonly metadata: StorageDatabaseMetadata;
}

export interface AiVerseWorkspaceOpenResult {
  readonly workspace: AiVerseWorkspaceResolution;
  readonly handle: ScopedDatabaseHandle;
}

export interface AiVerseNativeWorkspaceApi {
  resolve(
    input: AiVerseWorkspaceResolveInput,
  ): AiVerseWorkspaceResolution;
  discover(
    input: AiVerseWorkspaceResolveInput,
  ): Promise<AiVerseWorkspaceDatabaseDiscovery>;
  initialize(
    input: AiVerseWorkspaceResolveInput,
  ): Promise<AiVerseWorkspaceInitializationResult>;
  openExisting(
    input: AiVerseWorkspaceResolveInput,
  ): AiVerseWorkspaceOpenResult;
}

export type AiVerseWorkspaceErrorCode =
  | "AI_VERSE_OS_NOT_FOUND"
  | "INCOMPATIBLE_AI_VERSE_OS"
  | "WORKSPACE_ID_INVALID"
  | "WORKSPACE_NOT_FOUND"
  | "WORKSPACE_UNSAFE"
  | "WORKSPACE_MANIFEST_MISSING"
  | "WORKSPACE_MANIFEST_UNSAFE"
  | "WORKSPACE_MANIFEST_TOO_LARGE"
  | "WORKSPACE_MANIFEST_MALFORMED"
  | "WORKSPACE_SCHEMA_UNSUPPORTED"
  | "WORKSPACE_ID_MISMATCH"
  | "WORKSPACE_STATUS_INVALID"
  | "WORKSPACE_INACTIVE"
  | "EXTENSION_NOT_INSTALLED"
  | "EXTENSION_DISABLED"
  | "EXTENSION_INSTALLATION_INCOMPLETE"
  | "DATABASE_PATH_UNSAFE"
  | "DATABASE_RESIDUE_PRESENT"
  | "DATABASE_NOT_INITIALIZABLE"
  | "DATABASE_INITIALIZATION_FAILED"
  | "DATABASE_NOT_HEALTHY";

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
