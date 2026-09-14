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

interface OwnedFileSpec {
  readonly relativePath: string;
  readonly contents: string;
}

export interface OwnedFileSnapshot {
  readonly relativePath: string;
  readonly existed: boolean;
  readonly previousContents: string | null;
  readonly installedContents: string;
}

export interface MaterializationResult {
  readonly changedPaths: readonly string[];
  readonly snapshots: readonly OwnedFileSnapshot[];
}

const DATA_RUNTIME_URL = new URL("../index.js", import.meta.url).href;

const INSTRUCTIONS_CONTENT = `# AI-Verse Data Extension

AI-Verse Data is the canonical structured operational data layer for AI-Verse OS.

This directory is owned by AI-Verse Data. Canonical workspace databases remain user-owned and are never deleted merely because extension software is disabled, updated, or uninstalled.

Release 0.1 / Phase 5.6 contract:

- use the public @ai-verse/data surfaces instead of opening canonical SQLite files directly;
- AI-Verse OS remains authoritative for host identity, workspace identity, actor identity, and host-bound authorization;
- AI-Verse OS invokes the registered engine through protocol ai-verse-data-host/1.0; the engine delegates to the public Data host handlers;
- the engine records the concrete Data runtime that installed it, so OS loading does not depend on ambient node_modules lookup;
- use openAiVerseDataHostSession() for direct trusted-host workspace sessions;
- installation/materialization does not initialize any workspace database; initialization is explicit and is never performed by a normal data.request;
- trusted OS host-bound requests may preserve an already-authorized actor identity for automatic Data writes; ordinary legacy data.request remains local-operator bound;
- migration-required, quarantined, conflicting, unsupported, paused, or archived workspace state is never silently repaired or rebound;
- Bots and Apps must use their bounded adapters rather than the raw client;
- Brain is a trusted read surface and must only receive a client whose entire read scope was already authorized by the host.
`;

const ENGINE_CONTENT = `export const aiVerseDataExtension = Object.freeze({
  id: "ai-verse-data",
  package: "@ai-verse/data",
  version: "${AI_VERSE_DATA_EXTENSION_VERSION}",
  source: "AI-Verse-Data",
  phase: "5.6",
  registrationOnly: false,
  protocol: "ai-verse-data-host/1.0"
});

const installedRuntimeUrl = ${JSON.stringify(DATA_RUNTIME_URL)};

async function dataPackage() {
  let data;
  try {
    data = await import("@ai-verse/data");
  } catch (bareImportError) {
    try {
      data = await import(installedRuntimeUrl);
    } catch (installedRuntimeError) {
      throw new Error(
        "AI-Verse Data runtime is unavailable. Reinstall the Data extension from an installed @ai-verse/data package.",
        { cause: { bareImportError, installedRuntimeError } }
      );
    }
  }
  if (
    typeof data.describeAiVerseDataHostEngine !== "function" ||
    typeof data.handleAiVerseDataHostRequest !== "function"
  ) {
    throw new Error("Installed @ai-verse/data package does not expose the required AI-Verse OS host-engine interface.");
  }
  return data;
}

export function describe() {
  return {
    protocol: "ai-verse-data-host/1.0",
    extensionId: "ai-verse-data",
    actorBinding: "human:local-operator",
    authorizationBinding: "local-operator",
    workspaceInitialization: "explicit",
    hostBoundActorRequests: true
  };
}

export async function handleRequest(input) {
  const data = await dataPackage();
  return data.handleAiVerseDataHostRequest(input);
}

export async function openDataHostSession(input) {
  const data = await dataPackage();
  if (typeof data.openAiVerseDataHostSession !== "function") {
    throw new Error("Installed @ai-verse/data package does not expose openAiVerseDataHostSession().");
  }
  return data.openAiVerseDataHostSession(input);
}

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
    release_phase: "5.6",
    supported_host_schema_major: AI_VERSE_OS_REQUIRED_SCHEMA_MAJOR,
    supported_host_architecture: AI_VERSE_OS_REQUIRED_ARCHITECTURE,
    registry_path: AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
    registry_lock_path: AI_VERSE_OS_EXTENSION_REGISTRY_LOCK_PATH,
    registry_schema: AI_VERSE_OS_EXTENSION_REGISTRY_SCHEMA,
    installation_root: AI_VERSE_DATA_EXTENSION_ROOT,
    instructions: AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
    engine: AI_VERSE_DATA_EXTENSION_ENGINE_PATH,
    host_protocol: "ai-verse-data-host/1.0",
    host_adapter: "openAiVerseDataHostSession",
    runtime_module_url: DATA_RUNTIME_URL,
    adapters: ["host-session"],
    tracked_os_files_mutated: [],
    initializes_workspace_data: false,
    workspace_initialization: "explicit-only",
    registration_grants_permissions: false,
    registration_asserts_health: false,
    owns_os_canonical_state: false,
    source: AI_VERSE_DATA_EXTENSION_SOURCE,
  },
  null,
  2,
)}\n`;

const OWNED_FILES: readonly OwnedFileSpec[] = Object.freeze([
  Object.freeze({ relativePath: AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH, contents: INSTRUCTIONS_CONTENT }),
  Object.freeze({ relativePath: AI_VERSE_DATA_EXTENSION_ENGINE_PATH, contents: ENGINE_CONTENT }),
  Object.freeze({ relativePath: AI_VERSE_DATA_EXTENSION_MANIFEST_PATH, contents: MANIFEST_CONTENT }),
]);

function targetFor(root: TrustedDataRoot, relativePath: string): string {
  validateAiVerseOsExtensionRelativePath(relativePath);
  return resolveExtensionOwnedPath(root, relativePath);
}

function verifyRegularFile(path: string, relativePath: string): void {
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new AiVerseDataExtensionInstallError(
      "INVALID_EXTENSION_FILE",
      `Data-owned extension path must be a regular non-symlink file: ${relativePath}`,
    );
  }
}

function inspectOwnedFile(root: TrustedDataRoot, spec: OwnedFileSpec): AiVerseDataOwnedFilePlan {
  const target = targetFor(root, spec.relativePath);
  if (!existsSync(target)) {
    return { relativePath: spec.relativePath, exists: false, requiresWrite: true };
  }
  verifyRegularFile(target, spec.relativePath);
  return {
    relativePath: spec.relativePath,
    exists: true,
    requiresWrite: readFileSync(target, "utf8") !== spec.contents,
  };
}

export function planOwnedFiles(root: TrustedDataRoot): readonly AiVerseDataOwnedFilePlan[] {
  const extensionRoot = targetFor(root, AI_VERSE_DATA_EXTENSION_ROOT);
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

function atomicWrite(root: TrustedDataRoot, spec: OwnedFileSpec): OwnedFileSnapshot | null {
  ensureSafeDirectory(root, AI_VERSE_DATA_EXTENSION_ROOT);
  const target = targetFor(root, spec.relativePath);
  let existed = false;
  let previousContents: string | null = null;

  if (existsSync(target)) {
    verifyRegularFile(target, spec.relativePath);
    existed = true;
    previousContents = readFileSync(target, "utf8");
    if (previousContents === spec.contents) return null;
  }

  const parts = spec.relativePath.split("/");
  const name = parts.pop() as string;
  const temporaryRelative = `${parts.join("/")}/.${name}.${randomUUID()}.tmp`;
  validateAiVerseOsExtensionRelativePath(temporaryRelative);
  const temporary = targetFor(root, temporaryRelative);

  try {
    writeFileSync(temporary, spec.contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
    if (readFileSync(temporary, "utf8") !== spec.contents) {
      throw new AiVerseDataExtensionInstallError(
        "EXTENSION_MATERIALIZATION_FAILED",
        `Staged extension file failed verification: ${spec.relativePath}`,
      );
    }
    if (existsSync(target)) verifyRegularFile(target, spec.relativePath);
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

  return { relativePath: spec.relativePath, existed, previousContents, installedContents: spec.contents };
}

export function materializeOwnedFiles(root: TrustedDataRoot): MaterializationResult {
  const snapshots: OwnedFileSnapshot[] = [];
  const changedPaths: string[] = [];
  try {
    for (const spec of OWNED_FILES) {
      const snapshot = atomicWrite(root, spec);
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
        { materializationError: error, rollbackError },
      );
    }
    throw error;
  }
  return { changedPaths, snapshots };
}

function restoreSnapshot(root: TrustedDataRoot, snapshot: OwnedFileSnapshot): void {
  const target = targetFor(root, snapshot.relativePath);
  if (!existsSync(target)) {
    throw new AiVerseDataExtensionInstallError(
      "EXTENSION_ROLLBACK_FAILED",
      `Cannot roll back missing Data-owned file: ${snapshot.relativePath}`,
    );
  }
  verifyRegularFile(target, snapshot.relativePath);
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
  if (snapshot.previousContents === null) {
    throw new AiVerseDataExtensionInstallError(
      "EXTENSION_ROLLBACK_FAILED",
      `Previous contents are unavailable for rollback: ${snapshot.relativePath}`,
    );
  }
  const restored = atomicWrite(root, {
    relativePath: snapshot.relativePath,
    contents: snapshot.previousContents,
  });
  if (restored === null && current !== snapshot.previousContents) {
    throw new AiVerseDataExtensionInstallError(
      "EXTENSION_ROLLBACK_FAILED",
      `Could not restore previous Data-owned file contents: ${snapshot.relativePath}`,
    );
  }
}

export function rollbackOwnedFiles(root: TrustedDataRoot, snapshots: readonly OwnedFileSnapshot[]): void {
  for (const snapshot of [...snapshots].reverse()) restoreSnapshot(root, snapshot);
}

export function ownedFileContentsForTesting(relativePath: string): string | null {
  return OWNED_FILES.find((file) => file.relativePath === relativePath)?.contents ?? null;
}
