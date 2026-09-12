import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative } from "node:path";
import { randomUUID } from "node:crypto";

import { TrustedDataRoot } from "../scope/index.js";
import { AiVerseOsCompatibilityDetector } from "./compatibility.js";
import {
  AI_VERSE_DATA_EXTENSION_ENGINE_PATH,
  AI_VERSE_DATA_EXTENSION_ID,
  AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
  AI_VERSE_DATA_EXTENSION_MANIFEST_PATH,
  AI_VERSE_DATA_EXTENSION_ROOT,
  AiVerseDataExtensionInstallError,
  type AiVerseDataExtensionJsonObject,
} from "./extension-types.js";
import {
  currentDataExtensionEntry,
  readRegistryDocument,
  resolveExtensionOwnedPath,
  withRegistryLock,
  writeRegistryAtomic,
} from "./extension-registry.js";
import { AI_VERSE_OS_EXTENSION_REGISTRY_PATH } from "./types.js";
import {
  disableDataExtension as disableBase,
  enableDataExtension as enableBase,
  installDataExtension as installBase,
  updateDataExtension as updateBase,
} from "./lifecycle.js";
import {
  AiVerseDataLifecycleError,
  type AiVerseDataLifecycleInput,
  type AiVerseDataLifecycleResult,
} from "./lifecycle-types.js";

const OWNED_FILE_PATHS = [
  AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
  AI_VERSE_DATA_EXTENSION_ENGINE_PATH,
  AI_VERSE_DATA_EXTENSION_MANIFEST_PATH,
] as const;

type FileSnapshot = { readonly path: string; readonly content: Buffer; readonly mode: number };

function remap(error: unknown): AiVerseDataLifecycleError {
  if (error instanceof AiVerseDataLifecycleError) return error;
  if (error instanceof AiVerseDataExtensionInstallError) {
    return new AiVerseDataLifecycleError(error.code, error.message, error);
  }
  return new AiVerseDataLifecycleError(
    "EXTENSION_MATERIALIZATION_FAILED",
    `Native AI-Verse Data lifecycle failed unexpectedly: ${error instanceof Error ? error.message : "unknown filesystem error"}.`,
    error,
  );
}

function trustedRoot(rootPath: string): TrustedDataRoot {
  const compatibility = new AiVerseOsCompatibilityDetector().inspect({ rootPath });
  if (compatibility.status === "no-os") {
    throw new AiVerseDataLifecycleError(
      "AI_VERSE_OS_NOT_FOUND",
      "Native AI-Verse Data lifecycle requires a compatible AI-Verse OS host; no AI-Verse OS was detected and there is no silent standalone fallback.",
    );
  }
  if (compatibility.status !== "compatible" || compatibility.rootPath === null) {
    throw new AiVerseDataLifecycleError(
      "INCOMPATIBLE_AI_VERSE_OS",
      `Native AI-Verse Data lifecycle is blocked because the host is incompatible: ${compatibility.issues.map((issue) => issue.code).join(", ") || "unknown incompatibility"}.`,
    );
  }
  try {
    return TrustedDataRoot.fromExistingDirectory(compatibility.rootPath);
  } catch (error) {
    throw new AiVerseDataLifecycleError(
      "INCOMPATIBLE_AI_VERSE_OS",
      "Compatible AI-Verse OS root could not be trusted for lifecycle management.",
      error,
    );
  }
}

function result(
  root: TrustedDataRoot,
  status: AiVerseDataLifecycleResult["status"],
  overrides: Partial<AiVerseDataLifecycleResult> = {},
): AiVerseDataLifecycleResult {
  return {
    command: "uninstall",
    status,
    rootPath: root.canonicalPath,
    registryWritten: overrides.registryWritten ?? false,
    materializedPaths: [],
    removedPaths: overrides.removedPaths ?? [],
    enabled: null,
    preservesCanonicalWorkspaceData: true,
    trackedOsFilesMutated: [],
  };
}

function removeOwnedFile(root: TrustedDataRoot, ownedRoot: string, relativePath: string): boolean {
  const resolved = resolveExtensionOwnedPath(root, relativePath);
  const child = relative(ownedRoot, resolved);
  if (child === "" || child.startsWith("..") || isAbsolute(child)) {
    throw new AiVerseDataLifecycleError(
      "INVALID_EXTENSION_PATH",
      `ai-verse-data extension file must remain inside the Data-owned extension directory: ${relativePath}`,
    );
  }
  if (!existsSync(resolved)) return false;
  const info = lstatSync(resolved);
  if (info.isSymbolicLink()) {
    throw new AiVerseDataLifecycleError(
      "SYMLINK_PATH_REJECTED",
      `ai-verse-data extension file must not be a symbolic link: ${relativePath}`,
    );
  }
  if (!info.isFile()) {
    throw new AiVerseDataLifecycleError(
      "INVALID_EXTENSION_FILE",
      `ai-verse-data extension path is not a regular file and was left unchanged: ${relativePath}`,
    );
  }
  rmSync(resolved);
  return true;
}

function snapshotOwnedFiles(root: TrustedDataRoot): readonly FileSnapshot[] {
  const snapshots: FileSnapshot[] = [];
  for (const relativePath of OWNED_FILE_PATHS) {
    const path = resolveExtensionOwnedPath(root, relativePath);
    if (!existsSync(path)) continue;
    const info = lstatSync(path);
    if (info.isSymbolicLink() || !info.isFile()) continue;
    snapshots.push({ path, content: readFileSync(path), mode: info.mode & 0o777 });
  }
  return snapshots;
}

function restoreAtomic(path: string, content: Buffer | string, mode = 0o600): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.rollback.tmp`;
  try {
    writeFileSync(temporary, content, { mode, flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function rollback(
  root: TrustedDataRoot,
  registryRaw: string | null,
  files: readonly FileSnapshot[],
): void {
  for (const file of files) restoreAtomic(file.path, file.content, file.mode);
  const registryPath = root.resolve(...AI_VERSE_OS_EXTENSION_REGISTRY_PATH.split("/"));
  if (registryRaw === null) {
    rmSync(registryPath, { force: true });
  } else {
    restoreAtomic(registryPath, registryRaw);
  }
}

export const installDataExtension = installBase;
export const updateDataExtension = updateBase;
export const enableDataExtension = enableBase;
export const disableDataExtension = disableBase;

export function uninstallDataExtension(input: AiVerseDataLifecycleInput): AiVerseDataLifecycleResult {
  const initialRoot = trustedRoot(input.rootPath);
  try {
    return withRegistryLock(initialRoot, () => {
      const root = trustedRoot(initialRoot.canonicalPath);
      const snapshot = readRegistryDocument(root);
      const current = currentDataExtensionEntry(snapshot.extensions);
      if (current === null) return result(root, "not-installed");

      const fileSnapshots = snapshotOwnedFiles(root);
      const ownedRoot = resolveExtensionOwnedPath(root, AI_VERSE_DATA_EXTENSION_ROOT);
      const removed: string[] = [];
      let mutated = false;
      try {
        if (existsSync(ownedRoot)) {
          for (const relativePath of OWNED_FILE_PATHS) {
            if (removeOwnedFile(root, ownedRoot, relativePath)) {
              mutated = true;
              removed.push(relativePath);
            }
          }
          const info = lstatSync(ownedRoot);
          if (info.isSymbolicLink() || !info.isDirectory()) {
            throw new AiVerseDataLifecycleError(
              "SYMLINK_PATH_REJECTED",
              "ai-verse-data extension root is unsafe and was left unchanged.",
            );
          }
          if (readdirSync(ownedRoot).length === 0) {
            rmdirSync(ownedRoot);
            removed.push(AI_VERSE_DATA_EXTENSION_ROOT);
          }
        }

        const { [AI_VERSE_DATA_EXTENSION_ID]: _dropped, ...rest } = snapshot.extensions;
        void _dropped;
        const document: AiVerseDataExtensionJsonObject = {
          ...snapshot.document,
          extensions: { ...rest },
        };
        writeRegistryAtomic(root, document, snapshot.rawText);
        mutated = true;

        const finalEntry = currentDataExtensionEntry(readRegistryDocument(root).extensions);
        if (finalEntry !== null) {
          throw new AiVerseDataLifecycleError(
            "EXTENSION_REGISTRY_CHANGED",
            "ai-verse-data registry state changed after uninstall; rollback will restore the pre-uninstall state.",
          );
        }
        return result(root, "uninstalled", {
          registryWritten: true,
          removedPaths: removed,
        });
      } catch (error) {
        if (mutated || fileSnapshots.length > 0) {
          try {
            rollback(root, snapshot.rawText, fileSnapshots);
          } catch (rollbackError) {
            throw new AiVerseDataLifecycleError(
              "EXTENSION_ROLLBACK_FAILED",
              "Uninstall failed and the pre-uninstall extension state could not be fully restored.",
              rollbackError,
            );
          }
        }
        throw error;
      }
    });
  } catch (error) {
    throw remap(error);
  }
}

export class AiVerseDataExtensionLifecycle {
  install(input: AiVerseDataLifecycleInput): AiVerseDataLifecycleResult {
    return installDataExtension(input);
  }
  update(input: AiVerseDataLifecycleInput): AiVerseDataLifecycleResult {
    return updateDataExtension(input);
  }
  enable(input: AiVerseDataLifecycleInput): AiVerseDataLifecycleResult {
    return enableDataExtension(input);
  }
  disable(input: AiVerseDataLifecycleInput): AiVerseDataLifecycleResult {
    return disableDataExtension(input);
  }
  uninstall(input: AiVerseDataLifecycleInput): AiVerseDataLifecycleResult {
    return uninstallDataExtension(input);
  }
}
