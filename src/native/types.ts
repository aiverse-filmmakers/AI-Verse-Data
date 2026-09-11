export const AI_VERSE_OS_REQUIRED_SCHEMA_MAJOR = 2 as const;
export const AI_VERSE_OS_REQUIRED_ARCHITECTURE =
  "unified-workspace" as const;
export const AI_VERSE_OS_EXTENSION_REGISTRY_PATH =
  ".aiverse/extensions/registry.json" as const;

export type AiVerseOsCompatibilityStatus =
  | "compatible"
  | "no-os"
  | "incompatible";

export type AiVerseOsCompatibilityIssueCode =
  | "AI_VERSE_NOT_DETECTED"
  | "ROOT_INVALID"
  | "ROOT_UNSAFE"
  | "MANIFEST_MISSING"
  | "MANIFEST_UNSAFE"
  | "MANIFEST_TOO_LARGE"
  | "MANIFEST_MALFORMED"
  | "SCHEMA_VERSION_MISSING"
  | "SCHEMA_VERSION_UNSUPPORTED"
  | "ARCHITECTURE_MISSING"
  | "ARCHITECTURE_UNSUPPORTED"
  | "AGENTS_MISSING"
  | "AGENTS_UNSAFE"
  | "OPERATOR_MISSING"
  | "OPERATOR_UNSAFE"
  | "WORKSPACES_MISSING"
  | "WORKSPACES_UNSAFE"
  | "EXTENSION_CONTRACT_MISSING"
  | "EXTENSION_CONTRACT_UNSAFE"
  | "EXTENSION_CONTRACT_UNSUPPORTED"
  | "EXTENSION_REGISTRY_PATH_UNSAFE";

export interface AiVerseOsCompatibilityIssue {
  readonly code: AiVerseOsCompatibilityIssueCode;
  readonly message: string;
  readonly relativePath?: string;
}

export interface AiVerseOsManifestSummary {
  readonly schemaMajor: number;
  readonly architecture: string;
}

export interface AiVerseOsCompatibilityResult {
  readonly status: AiVerseOsCompatibilityStatus;
  readonly rootPath: string | null;
  readonly manifest: AiVerseOsManifestSummary | null;
  readonly extensionRegistryRelativePath:
    | typeof AI_VERSE_OS_EXTENSION_REGISTRY_PATH
    | null;
  readonly issues: readonly AiVerseOsCompatibilityIssue[];
}

export interface AiVerseOsCompatibilityInput {
  readonly rootPath: string;
}

export interface AiVerseOsCompatibilityApi {
  inspect(
    input: AiVerseOsCompatibilityInput,
  ): AiVerseOsCompatibilityResult;
}
