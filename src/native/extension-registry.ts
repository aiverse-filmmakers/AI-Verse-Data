import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";

import {
  DataScopeError,
  TrustedDataRoot,
} from "../scope/index.js";
import { AI_VERSE_OS_EXTENSION_REGISTRY_PATH } from "./types.js";
import {
  AI_VERSE_DATA_EXTENSION_ENGINE_PATH,
  AI_VERSE_DATA_EXTENSION_ID,
  AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
  AI_VERSE_DATA_EXTENSION_SOURCE,
  AI_VERSE_DATA_EXTENSION_VERSION,
  AI_VERSE_OS_EXTENSION_REGISTRY_LOCK_PATH,
  AI_VERSE_OS_EXTENSION_REGISTRY_SCHEMA,
  AiVerseDataExtensionInstallError,
  type JsonObject,
} from "./extension-types.js";

const MAX_REGISTRY_BYTES = 1024 * 1024;

export interface RegistryDocumentSnapshot {
  readonly document: JsonObject;
  readonly extensions: JsonObject;
  readonly exists: boolean;
  readonly rawText: string | null;
}

function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

export function validateAiVerseOsExtensionRelativePath(input: string): string {
  if (input.length === 0 || input.includes("\u0000")) {
    throw new AiVerseDataExtensionInstallError(
      "INVALID_EXTENSION_PATH",
      "Extension path must be a non-empty repository-relative path without NUL.",
    );
  }

  if (
    input.startsWith("/") ||
    input.startsWith("\\") ||
    input.startsWith("//") ||
    /^[A-Za-z]:[\\/]/.test(input)
  ) {
    throw new AiVerseDataExtensionInstallError(
      "INVALID_EXTENSION_PATH",
      `Extension path must be repository-relative: ${input}`,
    );
  }

  const normalized = input.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === "..",
    )
  ) {
    throw new AiVerseDataExtensionInstallError(
      "INVALID_EXTENSION_PATH",
      `Extension path contains unsafe traversal or empty segments: ${input}`,
    );
  }

  return segments.join("/");
}

function resolveSafe(
  root: TrustedDataRoot,
  relativePath: string,
): string {
  const safe = validateAiVerseOsExtensionRelativePath(relativePath);
  try {
    return root.resolve(...safe.split("/"));
  } catch (error) {
    if (
      error instanceof DataScopeError &&
      error.code === "PATH_SYMLINK_UNSAFE"
    ) {
      throw new AiVerseDataExtensionInstallError(
        "SYMLINK_PATH_REJECTED",
        `Extension path traverses a symbolic link: ${safe}`,
        error,
      );
    }

    throw new AiVerseDataExtensionInstallError(
      "INVALID_EXTENSION_PATH",
      `Extension path is not safe under the trusted OS root: ${safe}`,
      error,
    );
  }
}

export function ensureSafeDirectory(
  root: TrustedDataRoot,
  relativePath: string,
): string {
  const safe = validateAiVerseOsExtensionRelativePath(relativePath);
  const segments = safe.split("/");
  const current: string[] = [];

  for (const segment of segments) {
    current.push(segment);
    const currentRelative = current.join("/");
    const currentPath = resolveSafe(root, currentRelative);

    if (!existsSync(currentPath)) {
      try {
        mkdirSync(currentPath, { mode: 0o700 });
      } catch (error) {
        if (!existsSync(currentPath)) {
          throw new AiVerseDataExtensionInstallError(
            "INVALID_EXTENSION_DIRECTORY",
            `Could not create extension-owned directory '${currentRelative}'.`,
            error,
          );
        }
      }
    }

    const info = lstatSync(currentPath);
    if (info.isSymbolicLink()) {
      throw new AiVerseDataExtensionInstallError(
        "SYMLINK_PATH_REJECTED",
        `Extension directory must not be a symbolic link: ${currentRelative}`,
      );
    }
    if (!info.isDirectory()) {
      throw new AiVerseDataExtensionInstallError(
        "INVALID_EXTENSION_DIRECTORY",
        `Extension path component is not a directory: ${currentRelative}`,
      );
    }
  }

  return resolveSafe(root, safe);
}

export function readRegistryDocument(
  root: TrustedDataRoot,
): RegistryDocumentSnapshot {
  const registryPath = resolveSafe(
    root,
    AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
  );

  if (!existsSync(registryPath)) {
    const extensions: JsonObject = {};
    return {
      document: {
        schema_version: AI_VERSE_OS_EXTENSION_REGISTRY_SCHEMA,
        extensions,
      },
      extensions,
      exists: false,
      rawText: null,
    };
  }

  const info = lstatSync(registryPath);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new AiVerseDataExtensionInstallError(
      "INVALID_EXTENSION_REGISTRY",
      "AI-Verse OS extension registry must be a regular non-symlink file.",
    );
  }
  if (statSync(registryPath).size > MAX_REGISTRY_BYTES) {
    throw new AiVerseDataExtensionInstallError(
      "INVALID_EXTENSION_REGISTRY",
      `AI-Verse OS extension registry exceeds ${MAX_REGISTRY_BYTES} bytes.`,
    );
  }

  let rawText: string;
  let parsed: unknown;
  try {
    rawText = readFileSync(registryPath, "utf8");
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new AiVerseDataExtensionInstallError(
      "INVALID_EXTENSION_REGISTRY",
      "AI-Verse OS extension registry is unreadable or invalid JSON; it was left unchanged.",
      error,
    );
  }

  const document = asObject(parsed);
  if (document === null) {
    throw new AiVerseDataExtensionInstallError(
      "INVALID_EXTENSION_REGISTRY",
      "AI-Verse OS extension registry must contain a JSON object.",
    );
  }

  if (
    document.schema_version !== AI_VERSE_OS_EXTENSION_REGISTRY_SCHEMA
  ) {
    throw new AiVerseDataExtensionInstallError(
      "UNSUPPORTED_EXTENSION_REGISTRY_SCHEMA",
      `Unsupported AI-Verse OS extension registry schema '${String(document.schema_version ?? "missing")}'; expected '${AI_VERSE_OS_EXTENSION_REGISTRY_SCHEMA}'.`,
    );
  }

  const extensions = asObject(document.extensions);
  if (extensions === null) {
    throw new AiVerseDataExtensionInstallError(
      "INVALID_EXTENSION_REGISTRY",
      "AI-Verse OS extension registry 'extensions' must be a JSON object.",
    );
  }

  return {
    document,
    extensions,
    exists: true,
    rawText,
  };
}

export function currentDataExtensionEntry(
  extensions: JsonObject,
): JsonObject | null {
  const raw = extensions[AI_VERSE_DATA_EXTENSION_ID];
  if (raw === undefined || raw === null) return null;

  const entry = asObject(raw);
  if (entry === null) {
    throw new AiVerseDataExtensionInstallError(
      "INVALID_EXISTING_EXTENSION_ENTRY",
      "Existing ai-verse-data extension registration must be a JSON object.",
    );
  }

  if (
    entry.enabled !== undefined &&
    typeof entry.enabled !== "boolean"
  ) {
    throw new AiVerseDataExtensionInstallError(
      "INVALID_EXISTING_EXTENSION_ENTRY",
      "Existing ai-verse-data 'enabled' field must be boolean when present.",
    );
  }

  return entry;
}

export function buildDataExtensionEntry(
  existing: JsonObject | null,
): JsonObject {
  const current = existing ?? {};
  const enabled =
    typeof current.enabled === "boolean" ? current.enabled : true;

  return {
    ...current,
    id: AI_VERSE_DATA_EXTENSION_ID,
    supported: true,
    installed: true,
    enabled,
    version: AI_VERSE_DATA_EXTENSION_VERSION,
    source: AI_VERSE_DATA_EXTENSION_SOURCE,
    instructions: AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
    engine: AI_VERSE_DATA_EXTENSION_ENGINE_PATH,
    adapters: [],
  };
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = asObject(value);
  if (record !== null) {
    return `{${Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(record[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function registryWithDataEntry(
  snapshot: RegistryDocumentSnapshot,
  entry: JsonObject,
): JsonObject {
  return {
    ...snapshot.document,
    schema_version: AI_VERSE_OS_EXTENSION_REGISTRY_SCHEMA,
    extensions: {
      ...snapshot.extensions,
      [AI_VERSE_DATA_EXTENSION_ID]: entry,
    },
  };
}

export function writeRegistryAtomic(
  root: TrustedDataRoot,
  document: JsonObject,
  expectedRawText: string | null,
): void {
  ensureSafeDirectory(root, ".aiverse/extensions");
  const registryPath = resolveSafe(
    root,
    AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
  );
  const temporaryRelative =
    `.aiverse/extensions/registry.json.${randomUUID()}.tmp`;
  const temporaryPath = resolveSafe(root, temporaryRelative);

  try {
    writeFileSync(
      temporaryPath,
      `${JSON.stringify(document, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      },
    );

    resolveSafe(root, AI_VERSE_OS_EXTENSION_REGISTRY_PATH);
    const currentRawText = existsSync(registryPath)
      ? readFileSync(registryPath, "utf8")
      : null;

    if (currentRawText !== expectedRawText) {
      throw new AiVerseDataExtensionInstallError(
        "EXTENSION_REGISTRY_CHANGED",
        "AI-Verse OS extension registry changed during installation; no registry replacement was applied.",
      );
    }

    if (existsSync(registryPath)) {
      const info = lstatSync(registryPath);
      if (info.isSymbolicLink() || !info.isFile()) {
        throw new AiVerseDataExtensionInstallError(
          "INVALID_EXTENSION_REGISTRY",
          "AI-Verse OS extension registry changed into an unsafe path before replacement.",
        );
      }
    }

    renameSync(temporaryPath, registryPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

export function withRegistryLock<T>(
  root: TrustedDataRoot,
  operation: () => T,
): T {
  ensureSafeDirectory(root, ".aiverse/extensions");
  const lockPath = resolveSafe(
    root,
    AI_VERSE_OS_EXTENSION_REGISTRY_LOCK_PATH,
  );

  let acquired = false;
  try {
    try {
      writeFileSync(
        lockPath,
        `${JSON.stringify({
          extension_id: AI_VERSE_DATA_EXTENSION_ID,
          created_at: new Date().toISOString(),
        })}\n`,
        {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        },
      );
      acquired = true;
    } catch (error) {
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error
          ? String((error as { readonly code?: unknown }).code ?? "")
          : "";

      if (code === "EEXIST") {
        throw new AiVerseDataExtensionInstallError(
          "EXTENSION_REGISTRY_BUSY",
          `AI-Verse OS extension registry is locked at '${AI_VERSE_OS_EXTENSION_REGISTRY_LOCK_PATH}'. The lock is never stolen automatically.`,
        );
      }

      if (error instanceof AiVerseDataExtensionInstallError) {
        throw error;
      }

      throw new AiVerseDataExtensionInstallError(
        "EXTENSION_REGISTRY_LOCK_FAILED",
        "Could not acquire the AI-Verse OS extension registry lock.",
        error,
      );
    }

    return operation();
  } finally {
    if (acquired) rmSync(lockPath, { force: true });
  }
}

export function resolveExtensionOwnedPath(
  root: TrustedDataRoot,
  relativePath: string,
): string {
  return resolveSafe(root, relativePath);
}
