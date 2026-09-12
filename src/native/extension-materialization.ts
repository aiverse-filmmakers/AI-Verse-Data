import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import { TrustedDataRoot } from "../scope/index.js";
import {
  AI_VERSE_DATA_EXTENSION_ENGINE_PATH,
  AI_VERSE_DATA_EXTENSION_ID,
  AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
  AI_VERSE_DATA_EXTENSION_MANIFEST_PATH,
  AI_VERSE_DATA_EXTENSION_ROOT,
  AI_VERSE_DATA_EXTENSION_SOURCE,
  AI_VERSE_DATA_EXTENSION_VERSION,
  AI_VERSE_OS_EXTENSION_REGISTRY_LOCK_PATH,
  AI_VERSE_OS_EXTENSION_REGISTRY_SCHEMA,
  AiVerseDataExtensionInstallError,
  type AiVerseDataOwnedFilePlan,
} from "./extension-types.js";
import {
  ensureSafeDirectory,
  resolveExtensionOwnedPath,
  validateAiVerseOsExtensionRelativePath,
} from "./extension-registry.js";
import {
  AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
  AI_VERSE_OS_REQUIRED_ARCHITECTURE,
  AI_VERSE_OS_REQUIRED_SCHEMA_MAJOR,
} from "./types.js";

const HOST_BRIDGE_MODULE_URL = new URL(
  "./host-bridge.js",
  import.meta.url,
).href;

interface OwnedFileSpec {
  readonly relativePath: string;
  readonly contents: string;
}

interface OwnedFileSnapshot {
  readonly relativePath: string;
  readonly existed: boolean;
  readonly previousContents: string | null;
  readonly installedContents: string;
}

export interface MaterializationResult {
  readonly changedPaths: readonly string[];
  readonly snapshots: readonly OwnedFileSnapshot[];
}

const INSTRUCTIONS_CONTENT = `# AI-Verse Data Extension

AI-Verse Data is the structured operational data layer for AI-Verse OS.

This installed file is owned by AI-Verse Data.

First-release boundary:

- use the public @ai-verse/data package surfaces for structured Data operations;
- do not open canonical SQLite files directly from model, Bot, App, Brain, Memory, or Dashboard code;
- AI-Verse OS remains authoritative for host identity, workspace scope, permissions, and routing;
- extension installation is registration-only with respect to workspace data: it never creates a workspace database implicitly;
- workspace discovery and initialization are explicit native operations, and doctor/status are read-only health operations;
- Bots, Brain, Memory, Dashboard, Apps, Connections, and Automation integrations must use their scoped Data adapters rather than bypassing them.

Canonical Data remains user-owned and must not be deleted merely because extension software is updated or removed.
`;

const ENGINE_CONTENT = `import {
  handleNativeDataHostRequest,
  describeNativeDataHost
} from ${JSON.stringify(HOST_BRIDGE_MODULE_URL)};

export const aiVerseDataExtension = Object.freeze({
  id: "ai-verse-data",
  package: "@ai-verse/data",
  version: "${AI_VERSE_DATA_EXTENSION_VERSION}",
  source: "AI-Verse-Data",
  phase: "5.6",
  releaseComplete: true,
  workspaceInitialization: "explicit",
  registrationOnly: false,
  hostProtocol: "ai-verse-data-host/1.0"
});

export const describe = describeNativeDataHost;
export const handleRequest = handleNativeDataHostRequest;

export default aiVerseDataExtension;
`;

const MANIFEST_CONTENT = `${JSON.stringify(
  {
    schema_version: "1.0",
    id: AI_VERSE_DATA_EXTENSION_ID,
    display_name: "AI-Verse Data",
    host: "ai-verse-os",
    package: "@ai-verse/data",
    package_version: AI_VERSE_DATA_EXTENSION_VERSION,
    supported_host_schema_major: AI_VERSE_OS_REQUIRED_SCHEMA_MAJOR,
    supported_host_architecture: AI_VERSE_OS_REQUIRED_ARCHITECTURE,
    registry_path: AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
    registry_lock_path: AI_VERSE_OS_EXTENSION_REGISTRY_LOCK_PATH,
    registry_schema: AI_VERSE_OS_EXTENSION_REGISTRY_SCHEMA,
    installation_root: AI_VERSE_DATA_EXTENSION_ROOT,
    instructions: AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
    engine: AI_VERSE_DATA_EXTENSION_ENGINE_PATH,
    adapters: [],
    tracked_os_files_mutated: [],
    initializes_workspace_data: false,
    workspace_initialization: "explicit",
    release_phase: "5.6",
    release_complete: true,
    registration_grants_permissions: false,
    registration_asserts_health: false,
    owns_os_canonical_state: false,
    source: AI_VERSE_DATA_EXTENSION_SOURCE,
  },
  null,
  2,
)}\n`;

const OWNED_FILES: readonly OwnedFileSpec[] = Object.freeze([
  Object.freeze({
    relativePath: AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
    contents: INSTRUCTIONS_CONTENT,
  }),
  Object.freeze({
    relativePath: AI_VERSE_DATA_EXTENSION_ENGINE_PATH,
    contents: ENGINE_CONTENT,
  }),
  Object.freeze({
    relativePath: AI_VERSE_DATA_EXTENSION_MANIFEST_PATH,
    contents: MANIFEST_CONTENT,
  }),
]);

function inspectOwnedFile(
  root: TrustedDataRoot,
  spec: OwnedFileSpec,
): AiVerseDataOwnedFilePlan {
  const target = resolveExtensionOwnedPath(root, spec.relativePath);
  if (!existsSync(target)) {
    return {
      relativePath: spec.relativePath,
      exists: false,
      requiresWrite: true,
    };
  }

  const info = lstatSync(target);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new AiVerseDataExtensionInstallError(
      "INVALID_EXTENSION_FILE",
      `Data-owned extension path must be a regular non-symlink file: ${spec.relativePath}`,
    );
  }

  const current = readFileSync(target, "utf8");
  return {
    relativePath: spec.relativePath,
    exists: true,
    requiresWrite: current !== spec.contents,
  };
}

export function planOwnedFiles(
  root: TrustedDataRoot,
): readonly AiVerseDataOwnedFilePlan[] {
  const extensionRoot = resolveExtensionOwnedPath(
    root,
    AI_VERSE_DATA_EXTENSION_ROOT,
  );

  if (existsSync(extensionRoot)) {
    const info = lstatSync(extensionRoot);
    if (info.isSymbolicLink()) {
      throw new AiVerseDataExtensionInstallError(
        "SYMLINK_PATH_REJECTED",
        "AI-Verse Data extension root must not be a symbolic link.",
      );
    }
    if (!info.isDirectory()) {
      throw new AiVerseDataExtensionInstallError(
        "INVALID_EXTENSION_DIRECTORY",
        "AI-Verse Data extension root must be a directory when it exists.",
      );
    }
  }

  return OWNED_FILES.map((spec) => inspectOwnedFile(root, spec));
}

function atomicWriteOwnedFile(
  root: TrustedDataRoot,
  spec: OwnedFileSpec,
): OwnedFileSnapshot | null {
  ensureSafeDirectory(root, AI_VERSE_DATA_EXTENSION_ROOT);
  const target = resolveExtensionOwnedPath(root, spec.relativePath);

  let existed = false;
  let previousContents: string | null = null;

  if (existsSync(target)) {
    const info = lstatSync(target);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new AiVerseDataExtensionInstallError(
        "INVALID_EXTENSION_FILE",
        `Data-owned extension path must be a regular non-symlink file: ${spec.relativePath}`,
      );
    }
    existed = true;
    previousContents = readFileSync(target, "utf8");
    if (previousContents === spec.contents) return null;
  }

  const parentSegments = spec.relativePath.split("/");
  parentSegments.pop();
  const temporaryRelative =
    `${parentSegments.join("/")}/.${spec.relativePath.split("/").at(-1)}.${randomUUID()}.tmp`;
  validateAiVerseOsExtensionRelativePath(temporaryRelative);
  const temporary = resolveExtensionOwnedPath(root, temporaryRelative);

  try {
    writeFileSync(temporary, spec.contents, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });

    if (readFileSync(temporary, "utf8") !== spec.contents) {
      throw new AiVerseDataExtensionInstallError(
        "EXTENSION_MATERIALIZATION_FAILED",
        `Staged extension file failed verification: ${spec.relativePath}`,
      );
    }

    resolveExtensionOwnedPath(root, spec.relativePath);
    if (existsSync(target)) {
      const info = lstatSync(target);
      if (info.isSymbolicLink() || !info.isFile()) {
        throw new AiVerseDataExtensionInstallError(
          "INVALID_EXTENSION_FILE",
          `Data-owned extension path became unsafe before replacement: ${spec.relativePath}`,
        );
      }
    }

    renameSync(temporary, target);

    if (readFileSync(target, "utf8") !== spec.contents) {
      throw new AiVerseDataExtensionInstallError(
        "EXTENSION_MATERIALIZATION_FAILED",
        `Installed extension file failed verification: ${spec.relativePath}`,
      );
    }
  } catch (error) {
    if (error instanceof AiVerseDataExtensionInstallError) throw error;
    throw new AiVerseDataExtensionInstallError(
      "EXTENSION_MATERIALIZATION_FAILED",
      `Could not materialize Data-owned extension file: ${spec.relativePath}`,
      error,
    );
  } finally {
    rmSync(temporary, { force: true });
  }

  return {
    relativePath: spec.relativePath,
    existed,
    previousContents,
    installedContents: spec.contents,
  };
}

export function materializeOwnedFiles(
  root: TrustedDataRoot,
): MaterializationResult {
  const snapshots: OwnedFileSnapshot[] = [];
  const changedPaths: string[] = [];

  try {
    for (const spec of OWNED_FILES) {
      const snapshot = atomicWriteOwnedFile(root, spec);
      if (snapshot !== null) {
        snapshots.push(snapshot);
        changedPaths.push(spec.relativePath);
      }
    }
  } catch (error) {
    try {
      rollbackOwnedFiles(root, snapshots);
    } catch (rollbackError) {
      throw new AiVerseDataExtensionInstallError(
        "EXTENSION_ROLLBACK_FAILED",
        "Extension materialization failed and rollback could not safely restore all Data-owned files.",
        {
          materializationError: error,
          rollbackError,
        },
      );
    }
    throw error;
  }

  return {
    changedPaths,
    snapshots,
  };
}

function restoreSnapshot(
  root: TrustedDataRoot,
  snapshot: OwnedFileSnapshot,
): void {
  const target = resolveExtensionOwnedPath(root, snapshot.relativePath);

  if (!existsSync(target)) {
    throw new AiVerseDataExtensionInstallError(
      "EXTENSION_ROLLBACK_FAILED",
      `Cannot roll back missing Data-owned file: ${snapshot.relativePath}`,
    );
  }

  const info = lstatSync(target);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new AiVerseDataExtensionInstallError(
      "EXTENSION_ROLLBACK_FAILED",
      `Cannot roll back unsafe Data-owned file: ${snapshot.relativePath}`,
    );
  }

  const current = readFileSync(target, "utf8");
  if (current !== snapshot.installedContents) {
    throw new AiVerseDataExtensionInstallError(
      "EXTENSION_ROLLBACK_FAILED",
      `Data-owned file changed after materialization; refusing destructive rollback: ${snapshot.relativePath}`,
    );
  }

  if (!snapshot.existed) {
    rmSync(target);
    return;
  }

  const previous = snapshot.previousContents;
  if (previous === null) {
    throw new AiVerseDataExtensionInstallError(
      "EXTENSION_ROLLBACK_FAILED",
      `Previous contents are unavailable for rollback: ${snapshot.relativePath}`,
    );
  }

  const spec: OwnedFileSpec = {
    relativePath: snapshot.relativePath,
    contents: previous,
  };
  const restored = atomicWriteOwnedFile(root, spec);
  if (restored === null && current !== previous) {
    throw new AiVerseDataExtensionInstallError(
      "EXTENSION_ROLLBACK_FAILED",
      `Could not restore previous Data-owned file contents: ${snapshot.relativePath}`,
    );
  }
}

export function rollbackOwnedFiles(
  root: TrustedDataRoot,
  snapshots: readonly OwnedFileSnapshot[],
): void {
  for (const snapshot of [...snapshots].reverse()) {
    restoreSnapshot(root, snapshot);
  }
}

export function ownedFileContentsForTesting(
  relativePath: string,
): string | null {
  return OWNED_FILES.find((file) => file.relativePath === relativePath)
    ?.contents ?? null;
}
