import {
  existsSync,
  lstatSync,
  readFileSync,
  statSync,
} from "node:fs";
import { isAbsolute, relative } from "node:path";

import { TrustedDataRoot } from "../scope/index.js";
import { AiVerseOsCompatibilityDetector } from "./compatibility.js";
import {
  AI_VERSE_DATA_EXTENSION_ID,
  AI_VERSE_DATA_EXTENSION_MANIFEST_PATH,
  AI_VERSE_DATA_EXTENSION_ROOT,
  AI_VERSE_DATA_EXTENSION_SOURCE,
  AI_VERSE_DATA_EXTENSION_VERSION,
  AiVerseDataExtensionInstallError,
  type AiVerseDataExtensionJsonObject,
} from "./extension-types.js";
import {
  currentDataExtensionEntry,
  readRegistryDocument,
  resolveExtensionOwnedPath,
} from "./extension-registry.js";
import {
  AI_VERSE_DATA_INSTRUCTIONS_MAX_FILE_BYTES,
  AI_VERSE_DATA_INSTRUCTIONS_MAX_TASK_HINT_LENGTH,
  AiVerseDataInstructionError,
  type AiVerseDataDiscoveredFile,
  type AiVerseDataInstructionDiscoveryApi,
  type AiVerseDataInstructionDiscoveryInput,
  type AiVerseDataInstructionDiscoveryResult,
  type AiVerseDataInstructionProvenance,
} from "./instruction-types.js";

function requireCompatibleTrustedRoot(rootPath: string): TrustedDataRoot {
  const compatibility =
    new AiVerseOsCompatibilityDetector().inspect({ rootPath });

  if (compatibility.status === "no-os") {
    throw new AiVerseDataInstructionError(
      "AI_VERSE_OS_NOT_FOUND",
      "Native extension instruction discovery requires a compatible AI-Verse OS host; no AI-Verse OS was detected and there is no silent standalone fallback.",
    );
  }

  if (
    compatibility.status !== "compatible" ||
    compatibility.rootPath === null
  ) {
    throw new AiVerseDataInstructionError(
      "INCOMPATIBLE_AI_VERSE_OS",
      `Native extension instruction discovery is blocked because the host is incompatible: ${compatibility.issues
        .map((issue) => issue.code)
        .join(", ") || "unknown incompatibility"}.`,
    );
  }

  try {
    return TrustedDataRoot.fromExistingDirectory(
      compatibility.rootPath,
    );
  } catch (error) {
    throw new AiVerseDataInstructionError(
      "INCOMPATIBLE_AI_VERSE_OS",
      "Compatible AI-Verse OS root could not be trusted for instruction discovery.",
      error,
    );
  }
}

function remapRegistryError(
  error: unknown,
): AiVerseDataInstructionError {
  if (error instanceof AiVerseDataInstructionError) return error;
  if (error instanceof AiVerseDataExtensionInstallError) {
    switch (error.code) {
      case "INVALID_EXTENSION_PATH":
        return new AiVerseDataInstructionError(
          "INVALID_EXTENSION_PATH",
          error.message,
          error,
        );
      case "SYMLINK_PATH_REJECTED":
        return new AiVerseDataInstructionError(
          "SYMLINK_PATH_REJECTED",
          error.message,
          error,
        );
      case "INVALID_EXTENSION_DIRECTORY":
      case "INVALID_EXTENSION_FILE":
        return new AiVerseDataInstructionError(
          "INVALID_EXTENSION_FILE",
          error.message,
          error,
        );
      case "INVALID_EXTENSION_REGISTRY":
        return new AiVerseDataInstructionError(
          "INVALID_EXTENSION_REGISTRY",
          error.message,
          error,
        );
      case "UNSUPPORTED_EXTENSION_REGISTRY_SCHEMA":
        return new AiVerseDataInstructionError(
          "UNSUPPORTED_EXTENSION_REGISTRY_SCHEMA",
          error.message,
          error,
        );
      case "INVALID_EXISTING_EXTENSION_ENTRY":
        return new AiVerseDataInstructionError(
          "INVALID_EXISTING_EXTENSION_ENTRY",
          error.message,
          error,
        );
      default:
        return new AiVerseDataInstructionError(
          "INVALID_EXTENSION_REGISTRY",
          `AI-Verse OS extension registry could not be read safely: ${error.message}`,
          error,
        );
    }
  }
  return new AiVerseDataInstructionError(
    "INVALID_EXTENSION_REGISTRY",
    `AI-Verse OS extension registry could not be read safely: ${error instanceof Error ? error.message : "unknown filesystem error"}.`,
    error,
  );
}

function readRegistryState(root: TrustedDataRoot): {
  readonly exists: boolean;
  readonly entry: AiVerseDataExtensionJsonObject | null;
} {
  try {
    const snapshot = readRegistryDocument(root);
    return {
      exists: snapshot.exists,
      entry: currentDataExtensionEntry(snapshot.extensions),
    };
  } catch (error) {
    throw remapRegistryError(error);
  }
}

function stringField(
  entry: AiVerseDataExtensionJsonObject,
  key: string,
): string {
  const value = entry[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new AiVerseDataInstructionError(
      "INVALID_EXISTING_EXTENSION_ENTRY",
      `Existing ai-verse-data '${key}' field must be a non-empty path string when the extension is active.`,
    );
  }
  return value;
}

function adapterFields(
  entry: AiVerseDataExtensionJsonObject,
): readonly string[] {
  const value = entry.adapters;
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new AiVerseDataInstructionError(
      "INVALID_EXISTING_EXTENSION_ENTRY",
      "Existing ai-verse-data 'adapters' field must be an array of path strings when present.",
    );
  }
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) {
      throw new AiVerseDataInstructionError(
        "INVALID_EXISTING_EXTENSION_ENTRY",
        "Existing ai-verse-data 'adapters' entries must be non-empty path strings.",
      );
    }
  }
  return value as readonly string[];
}

function booleanField(
  entry: AiVerseDataExtensionJsonObject,
  key: "supported" | "installed" | "enabled",
): boolean {
  const value = entry[key];
  if (typeof value !== "boolean") {
    throw new AiVerseDataInstructionError(
      "INVALID_EXISTING_EXTENSION_ENTRY",
      `Existing ai-verse-data '${key}' field must be boolean when present; operator intent cannot be guessed.`,
    );
  }
  return value;
}

function ownedRootPath(root: TrustedDataRoot): string {
  try {
    return resolveExtensionOwnedPath(root, AI_VERSE_DATA_EXTENSION_ROOT);
  } catch (error) {
    throw remapRegistryError(error);
  }
}

function resolveOwnedFile(
  root: TrustedDataRoot,
  ownedRoot: string,
  relativePath: string,
): string {
  let resolved: string;
  try {
    resolved = resolveExtensionOwnedPath(root, relativePath);
  } catch (error) {
    throw remapRegistryError(error);
  }

  const child = relative(ownedRoot, resolved);
  if (child === "" || child.startsWith("..") || isAbsolute(child)) {
    throw new AiVerseDataInstructionError(
      "INVALID_EXTENSION_PATH",
      `ai-verse-data extension file must remain inside the Data-owned extension directory: ${relativePath}`,
    );
  }

  return resolved;
}

function readOwnedFile(
  relativePath: string,
  absolutePath: string,
): AiVerseDataDiscoveredFile {
  if (!existsSync(absolutePath)) {
    throw new AiVerseDataInstructionError(
      "INVALID_EXTENSION_FILE",
      `ai-verse-data extension file is missing: ${relativePath}`,
    );
  }

  let info;
  try {
    info = lstatSync(absolutePath);
  } catch (error) {
    throw new AiVerseDataInstructionError(
      "EXTENSION_FILE_UNREADABLE",
      `ai-verse-data extension file could not be inspected: ${relativePath}`,
      error,
    );
  }

  if (info.isSymbolicLink()) {
    throw new AiVerseDataInstructionError(
      "SYMLINK_PATH_REJECTED",
      `ai-verse-data extension file must not be a symbolic link: ${relativePath}`,
    );
  }

  if (!info.isFile()) {
    throw new AiVerseDataInstructionError(
      "INVALID_EXTENSION_FILE",
      `ai-verse-data extension file must be a regular file: ${relativePath}`,
    );
  }

  let size: number;
  try {
    size = statSync(absolutePath).size;
  } catch (error) {
    throw new AiVerseDataInstructionError(
      "EXTENSION_FILE_UNREADABLE",
      `ai-verse-data extension file could not be measured: ${relativePath}`,
      error,
    );
  }

  if (size > AI_VERSE_DATA_INSTRUCTIONS_MAX_FILE_BYTES) {
    throw new AiVerseDataInstructionError(
      "EXTENSION_FILE_TOO_LARGE",
      `ai-verse-data extension file exceeds ${AI_VERSE_DATA_INSTRUCTIONS_MAX_FILE_BYTES} bytes: ${relativePath}`,
    );
  }

  try {
    return {
      relativePath,
      absolutePath,
      contents: readFileSync(absolutePath, "utf8"),
    };
  } catch (error) {
    throw new AiVerseDataInstructionError(
      "EXTENSION_FILE_UNREADABLE",
      `ai-verse-data extension file could not be read: ${relativePath}`,
      error,
    );
  }
}

function normalizeTaskHint(
  taskHint: string | undefined,
): string | null {
  if (taskHint === undefined) return null;
  if (typeof taskHint !== "string") {
    throw new AiVerseDataInstructionError(
      "INVALID_TASK_HINT",
      "Task hint must be a string when provided.",
    );
  }
  if (taskHint.includes("\u0000")) {
    throw new AiVerseDataInstructionError(
      "INVALID_TASK_HINT",
      "Task hint must not contain NUL characters.",
    );
  }
  if (
    taskHint.length > AI_VERSE_DATA_INSTRUCTIONS_MAX_TASK_HINT_LENGTH
  ) {
    throw new AiVerseDataInstructionError(
      "INVALID_TASK_HINT",
      `Task hint exceeds ${AI_VERSE_DATA_INSTRUCTIONS_MAX_TASK_HINT_LENGTH} characters.`,
    );
  }
  const trimmed = taskHint.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function matchedTermsFor(
  taskHint: string | null,
  corpus: string,
): readonly string[] {
  if (taskHint === null) return [];
  const lowered = corpus.toLowerCase();
  const terms = new Set<string>();
  for (const raw of taskHint.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 3) terms.add(raw);
  }
  return [...terms]
    .filter((term) => lowered.includes(term))
    .sort();
}

function notInstalledResult(
  root: TrustedDataRoot,
  taskHint: string | null,
): AiVerseDataInstructionDiscoveryResult {
  const provenance: AiVerseDataInstructionProvenance = {
    extensionId: AI_VERSE_DATA_EXTENSION_ID,
    version: AI_VERSE_DATA_EXTENSION_VERSION,
    source: AI_VERSE_DATA_EXTENSION_SOURCE,
    supported: false,
    installed: false,
    enabled: false,
    registryExists: false,
    instructionsRelativePath: null,
    engineRelativePath: null,
    adapterRelativePaths: [],
  };
  return {
    status: "not-installed",
    rootPath: root.canonicalPath,
    taskHint,
    taskRelevant: taskHint === null,
    matchedTerms: [],
    provenance,
    instructions: null,
    engine: null,
    adapters: [],
    manifest: null,
  };
}

export function discoverExtensionInstructions(
  input: AiVerseDataInstructionDiscoveryInput,
): AiVerseDataInstructionDiscoveryResult {
  const taskHint = normalizeTaskHint(input.taskHint);
  const root = requireCompatibleTrustedRoot(input.rootPath);

  const registry = readRegistryState(root);
  if (!registry.exists || registry.entry === null) {
    if (registry.exists && registry.entry === null) {
      const base = notInstalledResult(root, taskHint);
      return {
        ...base,
        provenance: { ...base.provenance, registryExists: true },
      };
    }
    return notInstalledResult(root, taskHint);
  }

  const entry = registry.entry;
  const supported = booleanField(entry, "supported");
  const installed = booleanField(entry, "installed");
  const enabled = booleanField(entry, "enabled");

  const instructionsRelative = stringField(entry, "instructions");
  const engineRelative = stringField(entry, "engine");
  const adapterRelatives = adapterFields(entry);
  const version =
    typeof entry.version === "string" && entry.version.length > 0
      ? entry.version
      : AI_VERSE_DATA_EXTENSION_VERSION;
  const source =
    typeof entry.source === "string" && entry.source.length > 0
      ? entry.source
      : AI_VERSE_DATA_EXTENSION_SOURCE;

  const provenance: AiVerseDataInstructionProvenance = {
    extensionId: AI_VERSE_DATA_EXTENSION_ID,
    version,
    source,
    supported,
    installed,
    enabled,
    registryExists: true,
    instructionsRelativePath: instructionsRelative,
    engineRelativePath: engineRelative,
    adapterRelativePaths: [...adapterRelatives],
  };

  if (!supported || !installed || !enabled) {
    return {
      status: "disabled",
      rootPath: root.canonicalPath,
      taskHint,
      taskRelevant: false,
      matchedTerms: [],
      provenance,
      instructions: null,
      engine: null,
      adapters: [],
      manifest: null,
    };
  }

  const ownedRoot = ownedRootPath(root);
  const instructions = readOwnedFile(
    instructionsRelative,
    resolveOwnedFile(root, ownedRoot, instructionsRelative),
  );
  const engine = readOwnedFile(
    engineRelative,
    resolveOwnedFile(root, ownedRoot, engineRelative),
  );
  const adapters = adapterRelatives.map((relativePath) =>
    readOwnedFile(
      relativePath,
      resolveOwnedFile(root, ownedRoot, relativePath),
    ),
  );
  const manifest = readOwnedFile(
    AI_VERSE_DATA_EXTENSION_MANIFEST_PATH,
    resolveOwnedFile(
      root,
      ownedRoot,
      AI_VERSE_DATA_EXTENSION_MANIFEST_PATH,
    ),
  );

  const corpus = [
    instructions.contents,
    engine.contents,
    manifest.contents,
    ...adapters.map((file) => file.contents),
    version,
    source,
    instructionsRelative,
    engineRelative,
    ...adapterRelatives,
  ].join("\n");
  const matchedTerms = matchedTermsFor(taskHint, corpus);

  return {
    status: "ready",
    rootPath: root.canonicalPath,
    taskHint,
    taskRelevant: taskHint === null || matchedTerms.length > 0,
    matchedTerms,
    provenance,
    instructions,
    engine,
    adapters,
    manifest,
  };
}

export class AiVerseDataInstructionDiscovery
  implements AiVerseDataInstructionDiscoveryApi
{
  discover(
    input: AiVerseDataInstructionDiscoveryInput,
  ): AiVerseDataInstructionDiscoveryResult {
    return discoverExtensionInstructions(input);
  }
}
