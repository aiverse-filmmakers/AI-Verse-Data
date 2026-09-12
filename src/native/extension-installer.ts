import { TrustedDataRoot } from "../scope/index.js";
import { AiVerseOsCompatibilityDetector } from "./compatibility.js";
import {
  AI_VERSE_DATA_EXTENSION_ROOT,
  AI_VERSE_OS_EXTENSION_REGISTRY_LOCK_PATH,
  AiVerseDataExtensionInstallError,
  type AiVerseDataExtensionInstallInput,
  type AiVerseDataExtensionInstallPlan,
  type AiVerseDataExtensionInstallResult,
  type AiVerseDataExtensionInstallerApi,
  type AiVerseDataExtensionJsonObject,
} from "./extension-types.js";
import {
  buildDataExtensionEntry,
  canonicalJson,
  currentDataExtensionEntry,
  readRegistryDocument,
  registryWithDataEntry,
  withRegistryLock,
  writeRegistryAtomic,
} from "./extension-registry.js";
import {
  materializeOwnedFiles,
  planOwnedFiles,
  rollbackOwnedFiles,
} from "./extension-materialization.js";
import { AI_VERSE_OS_EXTENSION_REGISTRY_PATH } from "./types.js";

function requireCompatibleRoot(
  rootPath: string,
): TrustedDataRoot {
  const compatibility =
    new AiVerseOsCompatibilityDetector().inspect({ rootPath });

  if (compatibility.status === "no-os") {
    throw new AiVerseDataExtensionInstallError(
      "AI_VERSE_OS_NOT_FOUND",
      "Native AI-Verse Data installation requires a compatible AI-Verse OS host.",
    );
  }

  if (compatibility.status !== "compatible" || compatibility.rootPath === null) {
    throw new AiVerseDataExtensionInstallError(
      "INCOMPATIBLE_AI_VERSE_OS",
      `Native AI-Verse Data installation is blocked because the host is incompatible: ${compatibility.issues
        .map((issue) => issue.code)
        .join(", ") || "unknown incompatibility"}.`,
    );
  }

  return TrustedDataRoot.fromExistingDirectory(
    compatibility.rootPath,
  );
}

function executableDataEntry(
  existing: AiVerseDataExtensionJsonObject | null,
): AiVerseDataExtensionJsonObject {
  return {
    ...buildDataExtensionEntry(existing),
    adapters: ["host-session"],
    host_adapter: "openAiVerseDataHostSession",
  };
}

function planWithRoot(
  root: TrustedDataRoot,
): AiVerseDataExtensionInstallPlan {
  const registry = readRegistryDocument(root);
  const currentEntry = currentDataExtensionEntry(
    registry.extensions,
  );
  const nextEntry = executableDataEntry(currentEntry);
  const ownedFiles = planOwnedFiles(root);
  const registryRequiresWrite =
    currentEntry === null ||
    canonicalJson(currentEntry) !== canonicalJson(nextEntry);

  return {
    rootPath: root.canonicalPath,
    registryRelativePath: AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
    registryLockRelativePath:
      AI_VERSE_OS_EXTENSION_REGISTRY_LOCK_PATH,
    extensionRootRelativePath: AI_VERSE_DATA_EXTENSION_ROOT,
    currentEntry,
    nextEntry,
    ownedFiles,
    registryExists: registry.exists,
    registryRequiresWrite,
    requiresWrite:
      registryRequiresWrite ||
      ownedFiles.some((file) => file.requiresWrite),
    trackedOsFilesMutated: [],
    preservesUnknownRegistryFields: true,
    preservesCanonicalWorkspaceData: true,
  };
}

export class AiVerseDataExtensionInstaller
  implements AiVerseDataExtensionInstallerApi
{
  plan(
    input: AiVerseDataExtensionInstallInput,
  ): AiVerseDataExtensionInstallPlan {
    return planWithRoot(requireCompatibleRoot(input.rootPath));
  }

  install(
    input: AiVerseDataExtensionInstallInput,
  ): AiVerseDataExtensionInstallResult {
    const initialRoot = requireCompatibleRoot(input.rootPath);

    return withRegistryLock(initialRoot, () => {
      const root = requireCompatibleRoot(initialRoot.canonicalPath);
      const registry = readRegistryDocument(root);
      const currentEntry = currentDataExtensionEntry(
        registry.extensions,
      );
      const nextEntry = executableDataEntry(currentEntry);
      const ownedFiles = planOwnedFiles(root);
      const registryRequiresWrite =
        currentEntry === null ||
        canonicalJson(currentEntry) !== canonicalJson(nextEntry);

      const plan: AiVerseDataExtensionInstallPlan = {
        rootPath: root.canonicalPath,
        registryRelativePath: AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
        registryLockRelativePath:
          AI_VERSE_OS_EXTENSION_REGISTRY_LOCK_PATH,
        extensionRootRelativePath: AI_VERSE_DATA_EXTENSION_ROOT,
        currentEntry,
        nextEntry,
        ownedFiles,
        registryExists: registry.exists,
        registryRequiresWrite,
        requiresWrite:
          registryRequiresWrite ||
          ownedFiles.some((file) => file.requiresWrite),
        trackedOsFilesMutated: [],
        preservesUnknownRegistryFields: true,
        preservesCanonicalWorkspaceData: true,
      };

      if (!plan.requiresWrite) {
        return {
          ...plan,
          status: "unchanged",
          materializedPaths: [],
          registryWritten: false,
        };
      }

      const materialization = materializeOwnedFiles(root);
      let registryWritten = false;

      try {
        const remainingFileChanges = planOwnedFiles(root).filter(
          (file) => file.requiresWrite,
        );
        if (remainingFileChanges.length > 0) {
          throw new AiVerseDataExtensionInstallError(
            "EXTENSION_MATERIALIZATION_FAILED",
            "Installed Data-owned extension files failed verification before registry commit.",
          );
        }

        if (registryRequiresWrite) {
          writeRegistryAtomic(
            root,
            registryWithDataEntry(registry, nextEntry),
            registry.rawText,
          );
          registryWritten = true;
        }
      } catch (error) {
        try {
          rollbackOwnedFiles(root, materialization.snapshots);
        } catch (rollbackError) {
          throw new AiVerseDataExtensionInstallError(
            "EXTENSION_ROLLBACK_FAILED",
            "Pre-commit installation failed and Data-owned extension files could not be safely rolled back.",
            {
              installationError: error,
              rollbackError,
            },
          );
        }
        throw error;
      }

      const finalRegistry = readRegistryDocument(root);
      const finalEntry = currentDataExtensionEntry(
        finalRegistry.extensions,
      );
      if (
        finalEntry === null ||
        canonicalJson(finalEntry) !== canonicalJson(nextEntry)
      ) {
        throw new AiVerseDataExtensionInstallError(
          "EXTENSION_REGISTRY_CHANGED",
          "ai-verse-data registry state changed after commit; installed files were preserved and no destructive rollback was attempted.",
        );
      }

      return {
        ...plan,
        status: currentEntry === null ? "installed" : "updated",
        materializedPaths: materialization.changedPaths,
        registryWritten,
      };
    });
  }
}
