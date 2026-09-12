import {
  existsSync,
  lstatSync,
  readdirSync,
  rmdirSync,
  rmSync,
} from "node:fs";
import { isAbsolute, relative } from "node:path";

import { TrustedDataRoot } from "../scope/index.js";
import { AiVerseOsCompatibilityDetector } from "./compatibility.js";
import {
  AI_VERSE_DATA_EXTENSION_ID,
  AI_VERSE_DATA_EXTENSION_MANIFEST_PATH,
  AiVerseDataExtensionInstallError,
  type AiVerseDataExtensionJsonObject,
} from "./extension-types.js";
import { AiVerseDataExtensionInstaller } from "./extension-installer.js";
import {
  currentDataExtensionEntry,
  readRegistryDocument,
  registryWithDataEntry,
  resolveExtensionOwnedPath,
  withRegistryLock,
  writeRegistryAtomic,
} from "./extension-registry.js";
import {
  AI_VERSE_DATA_EXTENSION_ENGINE_PATH,
  AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
  AI_VERSE_DATA_EXTENSION_ROOT,
} from "./extension-types.js";
import {
  AiVerseDataLifecycleError,
  type AiVerseDataLifecycleCommand,
  type AiVerseDataLifecycleInput,
  type AiVerseDataLifecycleResult,
} from "./lifecycle-types.js";

const OWNED_FILE_PATHS: readonly string[] = Object.freeze([
  AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
  AI_VERSE_DATA_EXTENSION_ENGINE_PATH,
  AI_VERSE_DATA_EXTENSION_MANIFEST_PATH,
]);

function requireCompatibleTrustedRoot(rootPath: string): TrustedDataRoot {
  const compatibility =
    new AiVerseOsCompatibilityDetector().inspect({ rootPath });

  if (compatibility.status === "no-os") {
    throw new AiVerseDataLifecycleError(
      "AI_VERSE_OS_NOT_FOUND",
      "Native AI-Verse Data lifecycle requires a compatible AI-Verse OS host; no AI-Verse OS was detected and there is no silent standalone fallback.",
    );
  }

  if (
    compatibility.status !== "compatible" ||
    compatibility.rootPath === null
  ) {
    throw new AiVerseDataLifecycleError(
      "INCOMPATIBLE_AI_VERSE_OS",
      `Native AI-Verse Data lifecycle is blocked because the host is incompatible: ${compatibility.issues
        .map((issue) => issue.code)
        .join(", ") || "unknown incompatibility"}.`,
    );
  }

  try {
    return TrustedDataRoot.fromExistingDirectory(
      compatibility.rootPath,
    );
  } catch (error) {
    throw new AiVerseDataLifecycleError(
      "INCOMPATIBLE_AI_VERSE_OS",
      "Compatible AI-Verse OS root could not be trusted for lifecycle management.",
      error,
    );
  }
}

function remapInstallError(
  error: unknown,
): AiVerseDataLifecycleError {
  if (error instanceof AiVerseDataLifecycleError) return error;
  if (error instanceof AiVerseDataExtensionInstallError) {
    return new AiVerseDataLifecycleError(
      error.code,
      error.message,
      error,
    );
  }
  return new AiVerseDataLifecycleError(
    "EXTENSION_MATERIALIZATION_FAILED",
    `Native AI-Verse Data lifecycle failed unexpectedly: ${error instanceof Error ? error.message : "unknown filesystem error"}.`,
    error,
  );
}

function baseResult(
  command: AiVerseDataLifecycleCommand,
  root: TrustedDataRoot,
  overrides: Partial<AiVerseDataLifecycleResult> & {
    readonly status: AiVerseDataLifecycleResult["status"];
  },
): AiVerseDataLifecycleResult {
  return {
    command,
    status: overrides.status,
    rootPath: root.canonicalPath,
    registryWritten: overrides.registryWritten ?? false,
    materializedPaths: overrides.materializedPaths ?? [],
    removedPaths: overrides.removedPaths ?? [],
    enabled: overrides.enabled ?? null,
    preservesCanonicalWorkspaceData: true,
    trackedOsFilesMutated: [],
  };
}

function readEnabled(entry: AiVerseDataExtensionJsonObject): boolean {
  const value = entry.enabled;
  if (typeof value !== "boolean") {
    throw new AiVerseDataLifecycleError(
      "INVALID_EXISTING_EXTENSION_ENTRY",
      "Existing ai-verse-data 'enabled' field must be boolean when present; operator intent cannot be guessed.",
    );
  }
  return value;
}

function removeOwnedFile(
  root: TrustedDataRoot,
  ownedRoot: string,
  relativePath: string,
): boolean {
  let resolved: string;
  try {
    resolved = resolveExtensionOwnedPath(root, relativePath);
  } catch (error) {
    throw remapInstallError(error);
  }

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

function removeOwnedRootIfEmpty(
  ownedRoot: string,
): boolean {
  if (!existsSync(ownedRoot)) return false;
  const info = lstatSync(ownedRoot);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new AiVerseDataLifecycleError(
      "SYMLINK_PATH_REJECTED",
      "ai-verse-data extension root is unsafe and was left unchanged.",
    );
  }
  if (readdirSync(ownedRoot).length > 0) return false;
  rmdirSync(ownedRoot);
  return true;
}

export function installDataExtension(
  input: AiVerseDataLifecycleInput,
): AiVerseDataLifecycleResult {
  try {
    const installer = new AiVerseDataExtensionInstaller();
    const result = installer.install({ rootPath: input.rootPath });
    const root = TrustedDataRoot.fromExistingDirectory(
      result.rootPath,
    );
    return baseResult("install", root, {
      status: result.status,
      registryWritten: result.registryWritten,
      materializedPaths: [...result.materializedPaths],
      enabled:
        typeof result.nextEntry.enabled === "boolean"
          ? result.nextEntry.enabled
          : true,
    });
  } catch (error) {
    throw remapInstallError(error);
  }
}

export function updateDataExtension(
  input: AiVerseDataLifecycleInput,
): AiVerseDataLifecycleResult {
  try {
    const installer = new AiVerseDataExtensionInstaller();
    const result = installer.install({ rootPath: input.rootPath });
    const root = TrustedDataRoot.fromExistingDirectory(
      result.rootPath,
    );
    return baseResult("update", root, {
      status: result.status,
      registryWritten: result.registryWritten,
      materializedPaths: [...result.materializedPaths],
      enabled:
        typeof result.nextEntry.enabled === "boolean"
          ? result.nextEntry.enabled
          : true,
    });
  } catch (error) {
    throw remapInstallError(error);
  }
}

export function disableDataExtension(
  input: AiVerseDataLifecycleInput,
): AiVerseDataLifecycleResult {
  const initialRoot = requireCompatibleTrustedRoot(input.rootPath);

  try {
    return withRegistryLock(initialRoot, () => {
      const root = requireCompatibleTrustedRoot(
        initialRoot.canonicalPath,
      );
      const snapshot = readRegistryDocument(root);
      const current = currentDataExtensionEntry(snapshot.extensions);

      if (current === null) {
        throw new AiVerseDataLifecycleError(
          "EXTENSION_NOT_INSTALLED",
          "ai-verse-data is not registered; nothing was disabled.",
        );
      }

      if (readEnabled(current) === false) {
        return baseResult("disable", root, {
          status: "unchanged",
          enabled: false,
        });
      }

      const next: AiVerseDataExtensionJsonObject = {
        ...current,
        id: AI_VERSE_DATA_EXTENSION_ID,
        enabled: false,
      };

      writeRegistryAtomic(
        root,
        registryWithDataEntry(snapshot, next),
        snapshot.rawText,
      );

      const finalEntry = currentDataExtensionEntry(
        readRegistryDocument(root).extensions,
      );
      if (finalEntry === null || readEnabled(finalEntry) !== false) {
        throw new AiVerseDataLifecycleError(
          "EXTENSION_REGISTRY_CHANGED",
          "ai-verse-data registry state changed after disable; no destructive rollback was attempted.",
        );
      }

      return baseResult("disable", root, {
        status: "disabled",
        registryWritten: true,
        enabled: false,
      });
    });
  } catch (error) {
    throw remapInstallError(error);
  }
}

export function uninstallDataExtension(
  input: AiVerseDataLifecycleInput,
): AiVerseDataLifecycleResult {
  const initialRoot = requireCompatibleTrustedRoot(input.rootPath);

  try {
    return withRegistryLock(initialRoot, () => {
      const root = requireCompatibleTrustedRoot(
        initialRoot.canonicalPath,
      );
      const snapshot = readRegistryDocument(root);
      const current = currentDataExtensionEntry(snapshot.extensions);

      if (current === null) {
        return baseResult("uninstall", root, {
          status: "not-installed",
          enabled: null,
        });
      }

      const ownedRoot = resolveExtensionOwnedPath(
        root,
        AI_VERSE_DATA_EXTENSION_ROOT,
      );
      const removed: string[] = [];
      if (existsSync(ownedRoot)) {
        for (const relativePath of OWNED_FILE_PATHS) {
          if (removeOwnedFile(root, ownedRoot, relativePath)) {
            removed.push(relativePath);
          }
        }
        if (removeOwnedRootIfEmpty(ownedRoot)) {
          removed.push(AI_VERSE_DATA_EXTENSION_ROOT);
        }
      }

      const { [AI_VERSE_DATA_EXTENSION_ID]: _dropped, ...rest } =
        snapshot.extensions;
      void _dropped;
      const document: AiVerseDataExtensionJsonObject = {
        ...snapshot.document,
        extensions: { ...rest },
      };
      writeRegistryAtomic(root, document, snapshot.rawText);

      const finalEntry = currentDataExtensionEntry(
        readRegistryDocument(root).extensions,
      );
      if (finalEntry !== null) {
        throw new AiVerseDataLifecycleError(
          "EXTENSION_REGISTRY_CHANGED",
          "ai-verse-data registry state changed after uninstall; installed files were preserved and no destructive rollback was attempted.",
        );
      }

      return baseResult("uninstall", root, {
        status: "uninstalled",
        registryWritten: true,
        removedPaths: removed,
        enabled: null,
      });
    });
  } catch (error) {
    throw remapInstallError(error);
  }
}

export class AiVerseDataExtensionLifecycle {
  install(
    input: AiVerseDataLifecycleInput,
  ): AiVerseDataLifecycleResult {
    return installDataExtension(input);
  }

  update(
    input: AiVerseDataLifecycleInput,
  ): AiVerseDataLifecycleResult {
    return updateDataExtension(input);
  }

  disable(
    input: AiVerseDataLifecycleInput,
  ): AiVerseDataLifecycleResult {
    return disableDataExtension(input);
  }

  uninstall(
    input: AiVerseDataLifecycleInput,
  ): AiVerseDataLifecycleResult {
    return uninstallDataExtension(input);
  }
}

export type { AiVerseDataLifecycleCommand as LifecycleCommand };
