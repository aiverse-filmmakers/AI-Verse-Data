import { randomUUID } from "node:crypto";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  statSync,
} from "node:fs";

import { DataRecovery } from "../recovery/index.js";
import {
  TrustedDataRoot,
  createWorkspaceDataScope,
  type DataDatabaseScope,
} from "../scope/index.js";
import {
  AI_VERSE_DATA_QUARANTINE_SUFFIX,
  type DataStorageDriver,
  SqliteStorageDriver,
  type StorageDatabaseBinding,
  type StorageDatabaseMetadata,
} from "../storage/index.js";
import { AiVerseOsCompatibilityDetector } from "./compatibility.js";
import {
  buildDataExtensionEntry,
  canonicalJson,
  currentDataExtensionEntry,
  readRegistryDocument,
} from "./extension-registry.js";
import { planOwnedFiles } from "./extension-materialization.js";
import {
  AI_VERSE_WORKSPACE_MANIFEST,
  AI_VERSE_WORKSPACE_MAX_MANIFEST_BYTES,
  AI_VERSE_WORKSPACE_SUPPORTED_SCHEMA_MAJOR,
  AiVerseWorkspaceError,
  type AiVerseNativeWorkspaceApi,
  type AiVerseWorkspaceDatabaseDiscovery,
  type AiVerseWorkspaceInitializationResult,
  type AiVerseWorkspaceManifestSummary,
  type AiVerseWorkspaceResolveInput,
  type AiVerseWorkspaceResolution,
  type AiVerseWorkspaceStatus,
} from "./workspace-types.js";

const NATIVE_WORKSPACE_ID = /^[a-z0-9][a-z0-9-]*$/;
const MAX_WORKSPACE_ID_LENGTH = 128;
const REQUIRED_MANIFEST_KEYS = new Set([
  "schema_version",
  "id",
  "name",
  "type",
  "status",
  "purpose",
]);
const VALID_STATUSES = new Set<AiVerseWorkspaceStatus>([
  "active",
  "paused",
  "archived",
]);

interface ParsedScalar {
  readonly value: string | null;
  readonly isString: boolean;
}

function issueMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "Unknown native workspace failure.";
}

function parseDoubleQuoted(input: string): {
  readonly value: string | null;
  readonly consumed: number;
} {
  let escaped = false;
  for (let index = 1; index < input.length; index += 1) {
    const character = input[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      const literal = input.slice(0, index + 1);
      try {
        return {
          value: JSON.parse(literal) as string,
          consumed: index + 1,
        };
      } catch {
        return { value: null, consumed: index + 1 };
      }
    }
  }
  return { value: null, consumed: input.length };
}

function parseSingleQuoted(input: string): {
  readonly value: string | null;
  readonly consumed: number;
} {
  let output = "";
  for (let index = 1; index < input.length; index += 1) {
    const character = input[index]!;
    if (character !== "'") {
      output += character;
      continue;
    }
    if (input[index + 1] === "'") {
      output += "'";
      index += 1;
      continue;
    }
    return { value: output, consumed: index + 1 };
  }
  return { value: null, consumed: input.length };
}

function trailingIsCommentOrEmpty(input: string): boolean {
  const trailing = input.trim();
  return trailing.length === 0 || trailing.startsWith("#");
}

function parseInlineScalar(rawInput: string): ParsedScalar {
  const raw = rawInput.trim();
  if (raw.length === 0) return { value: null, isString: false };

  if (raw.startsWith('"')) {
    const parsed = parseDoubleQuoted(raw);
    return {
      value:
        parsed.value !== null &&
        trailingIsCommentOrEmpty(raw.slice(parsed.consumed))
          ? parsed.value
          : null,
      isString: parsed.value !== null,
    };
  }

  if (raw.startsWith("'")) {
    const parsed = parseSingleQuoted(raw);
    return {
      value:
        parsed.value !== null &&
        trailingIsCommentOrEmpty(raw.slice(parsed.consumed))
          ? parsed.value
          : null,
      isString: parsed.value !== null,
    };
  }

  const comment = raw.search(/\s+#/);
  const value = (comment === -1 ? raw : raw.slice(0, comment)).trim();
  if (value.length === 0) return { value: null, isString: false };

  if (
    value === "~" ||
    /^null$/i.test(value) ||
    /^(true|false)$/i.test(value) ||
    /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) ||
    value.startsWith("[") ||
    value.startsWith("{") ||
    value.startsWith("&") ||
    value.startsWith("*") ||
    value.startsWith("!")
  ) {
    return { value, isString: false };
  }

  return { value, isString: true };
}

function blockScalar(
  lines: readonly string[],
  startIndex: number,
  folded: boolean,
): { readonly value: string; readonly nextIndex: number } {
  const block: string[] = [];
  let index = startIndex + 1;

  while (index < lines.length) {
    const line = lines[index]!;
    if (line.trim().length === 0) {
      block.push("");
      index += 1;
      continue;
    }
    if (!/^\s/.test(line)) break;
    block.push(line);
    index += 1;
  }

  const indents = block
    .filter((line) => line.trim().length > 0)
    .map((line) => /^\s*/.exec(line)?.[0].length ?? 0);
  const indent = indents.length === 0 ? 0 : Math.min(...indents);
  const stripped = block.map((line) =>
    line.trim().length === 0 ? "" : line.slice(indent),
  );

  return {
    value: folded
      ? stripped
          .join("\n")
          .replace(/([^\n])\n([^\n])/g, "$1 $2")
      : stripped.join("\n"),
    nextIndex: index,
  };
}

function parseManifestScalars(
  contents: string,
): ReadonlyMap<string, readonly ParsedScalar[]> {
  const lines = contents.split(/\r?\n/);
  const values = new Map<string, ParsedScalar[]>();

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]!;
    if (
      rawLine.trim().length === 0 ||
      /^\s/.test(rawLine) ||
      rawLine.trim().startsWith("#") ||
      rawLine.trim() === "---" ||
      rawLine.trim() === "..."
    ) {
      continue;
    }

    const match = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(
      rawLine,
    );
    if (match === null) continue;
    const key = match[1]!;
    if (!REQUIRED_MANIFEST_KEYS.has(key)) continue;

    const rawValue = match[2]!.trim();
    let parsed: ParsedScalar;
    if (/^[|>][+-]?$/.test(rawValue)) {
      const block = blockScalar(
        lines,
        index,
        rawValue.startsWith(">"),
      );
      parsed = { value: block.value, isString: true };
      index = block.nextIndex - 1;
    } else {
      parsed = parseInlineScalar(rawValue);
    }

    const existing = values.get(key) ?? [];
    existing.push(parsed);
    values.set(key, existing);
  }

  return values;
}

function oneString(
  scalars: ReadonlyMap<string, readonly ParsedScalar[]>,
  key: string,
  options: { readonly nonEmpty: boolean },
): string {
  const entries = scalars.get(key) ?? [];
  if (entries.length !== 1) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_MANIFEST_MALFORMED",
      entries.length === 0
        ? `WORKSPACE.yaml is missing required top-level key '${key}'.`
        : `WORKSPACE.yaml declares required top-level key '${key}' more than once.`,
    );
  }

  const entry = entries[0]!;
  if (!entry.isString || entry.value === null) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_MANIFEST_MALFORMED",
      `WORKSPACE.yaml key '${key}' must be a YAML string.`,
    );
  }
  if (options.nonEmpty && entry.value.trim().length === 0) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_MANIFEST_MALFORMED",
      `WORKSPACE.yaml key '${key}' must not be empty.`,
    );
  }
  return entry.value;
}

function parseWorkspaceManifest(
  contents: string,
  expectedId: string,
): AiVerseWorkspaceManifestSummary {
  const scalars = parseManifestScalars(contents);
  const schemaVersion = oneString(scalars, "schema_version", {
    nonEmpty: true,
  });
  const versionMatch = /^(\d+)(?:\.\d+){0,2}$/.exec(
    schemaVersion.trim(),
  );
  if (
    versionMatch === null ||
    Number.parseInt(versionMatch[1]!, 10) !==
      AI_VERSE_WORKSPACE_SUPPORTED_SCHEMA_MAJOR
  ) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_SCHEMA_UNSUPPORTED",
      `Unsupported WORKSPACE.yaml schema_version '${schemaVersion}'. AI-Verse Data requires major ${AI_VERSE_WORKSPACE_SUPPORTED_SCHEMA_MAJOR}.`,
    );
  }

  const id = oneString(scalars, "id", { nonEmpty: true });
  if (id !== expectedId) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_ID_MISMATCH",
      `WORKSPACE.yaml id '${id}' does not match requested workspace '${expectedId}'.`,
    );
  }

  const name = oneString(scalars, "name", { nonEmpty: true });
  const type = oneString(scalars, "type", { nonEmpty: true });
  const statusRaw = oneString(scalars, "status", {
    nonEmpty: true,
  });
  if (!VALID_STATUSES.has(statusRaw as AiVerseWorkspaceStatus)) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_STATUS_INVALID",
      `WORKSPACE.yaml status '${statusRaw}' is invalid; expected active, paused, or archived.`,
    );
  }
  const purpose = oneString(scalars, "purpose", {
    nonEmpty: false,
  });

  return {
    schemaMajor: AI_VERSE_WORKSPACE_SUPPORTED_SCHEMA_MAJOR,
    schemaVersion,
    id,
    name,
    type,
    status: statusRaw as AiVerseWorkspaceStatus,
    purpose,
  };
}

function bindingEquals(
  left: StorageDatabaseBinding | null,
  right: StorageDatabaseBinding,
): boolean {
  return (
    left !== null &&
    left.bindingVersion === right.bindingVersion &&
    left.kind === right.kind &&
    left.workspaceId === right.workspaceId
  );
}

function validateWorkspaceId(workspaceId: string): void {
  if (
    workspaceId.length < 1 ||
    workspaceId.length > MAX_WORKSPACE_ID_LENGTH ||
    !NATIVE_WORKSPACE_ID.test(workspaceId)
  ) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_ID_INVALID",
      "Workspace ID must match ^[a-z0-9][a-z0-9-]*$ and be at most 128 characters.",
    );
  }
}

function requireCompatibleRoot(rootPath: string): TrustedDataRoot {
  const compatibility =
    new AiVerseOsCompatibilityDetector().inspect({ rootPath });
  if (compatibility.status === "no-os") {
    throw new AiVerseWorkspaceError(
      "AI_VERSE_OS_NOT_FOUND",
      "Native workspace resolution requires an AI-Verse OS host.",
    );
  }
  if (
    compatibility.status !== "compatible" ||
    compatibility.rootPath === null
  ) {
    throw new AiVerseWorkspaceError(
      "INCOMPATIBLE_AI_VERSE_OS",
      `Native workspace resolution is blocked because the AI-Verse OS host is incompatible: ${compatibility.issues
        .map((issue) => issue.code)
        .join(", ") || "unknown incompatibility"}.`,
    );
  }
  return TrustedDataRoot.fromExistingDirectory(
    compatibility.rootPath,
  );
}

function resolveWorkspacePath(
  root: TrustedDataRoot,
  workspaceId: string,
): string {
  let workspacePath: string;
  try {
    workspacePath = root.resolve("workspaces", workspaceId);
  } catch (error) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_UNSAFE",
      "Workspace path is unsafe under the trusted AI-Verse OS root.",
      error,
    );
  }

  if (!existsSync(workspacePath)) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_NOT_FOUND",
      `Workspace '${workspaceId}' does not exist.`,
    );
  }

  const info = lstatSync(workspacePath);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_UNSAFE",
      `Workspace '${workspaceId}' must be a real non-symlink directory.`,
    );
  }
  return workspacePath;
}

function readWorkspaceManifest(
  root: TrustedDataRoot,
  workspaceId: string,
): AiVerseWorkspaceManifestSummary {
  let manifestPath: string;
  try {
    manifestPath = root.resolve(
      "workspaces",
      workspaceId,
      AI_VERSE_WORKSPACE_MANIFEST,
    );
  } catch (error) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_MANIFEST_UNSAFE",
      "WORKSPACE.yaml path is unsafe.",
      error,
    );
  }

  if (!existsSync(manifestPath)) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_MANIFEST_MISSING",
      `Workspace '${workspaceId}' is missing WORKSPACE.yaml.`,
    );
  }
  const info = lstatSync(manifestPath);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_MANIFEST_UNSAFE",
      "WORKSPACE.yaml must be a regular non-symlink file.",
    );
  }
  if (statSync(manifestPath).size > AI_VERSE_WORKSPACE_MAX_MANIFEST_BYTES) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_MANIFEST_TOO_LARGE",
      `WORKSPACE.yaml exceeds ${AI_VERSE_WORKSPACE_MAX_MANIFEST_BYTES} bytes.`,
    );
  }

  let contents: string;
  try {
    contents = readFileSync(manifestPath, "utf8");
  } catch (error) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_MANIFEST_UNSAFE",
      "WORKSPACE.yaml could not be read.",
      error,
    );
  }

  return parseWorkspaceManifest(contents, workspaceId);
}

function databaseRelativePath(workspaceId: string): string {
  return `workspaces/${workspaceId}/data/ai-verse-data.sqlite`;
}

function createResolvedScope(
  root: TrustedDataRoot,
  workspaceId: string,
): DataDatabaseScope {
  const scope = createWorkspaceDataScope(root, workspaceId);
  try {
    scope.databasePath();
  } catch (error) {
    throw new AiVerseWorkspaceError(
      "DATABASE_PATH_UNSAFE",
      "Canonical workspace Data path is unsafe.",
      error,
    );
  }
  return scope;
}

function auxiliaryResidue(
  root: TrustedDataRoot,
  workspaceId: string,
): readonly string[] {
  const base = databaseRelativePath(workspaceId);
  const candidates = [
    `${base}-wal`,
    `${base}-shm`,
    `${base}${AI_VERSE_DATA_QUARANTINE_SUFFIX}`,
  ];
  const found: string[] = [];

  for (const relativePath of candidates) {
    const segments = relativePath.split("/");
    let path: string;
    try {
      path = root.resolve(...segments);
    } catch (error) {
      throw new AiVerseWorkspaceError(
        "DATABASE_PATH_UNSAFE",
        `Canonical Data auxiliary path is unsafe: ${relativePath}`,
        error,
      );
    }
    if (existsSync(path)) found.push(relativePath);
  }

  return found;
}

function currentMetadata(
  driver: DataStorageDriver,
  scope: DataDatabaseScope,
): StorageDatabaseMetadata {
  const database = driver.open({
    location: scope.databasePath(),
    mode: "open-existing",
    expectedBinding: scope.binding,
  });
  try {
    return database.metadata();
  } finally {
    database.close();
  }
}

function requireCurrentEnabledExtension(root: TrustedDataRoot): void {
  let registry;
  try {
    registry = readRegistryDocument(root);
  } catch (error) {
    throw new AiVerseWorkspaceError(
      "EXTENSION_INSTALLATION_INCOMPLETE",
      "AI-Verse Data extension registry state is not current and valid.",
      error,
    );
  }

  let entry;
  try {
    entry = currentDataExtensionEntry(registry.extensions);
  } catch (error) {
    throw new AiVerseWorkspaceError(
      "EXTENSION_INSTALLATION_INCOMPLETE",
      "AI-Verse Data extension registration is malformed.",
      error,
    );
  }
  if (entry === null) {
    throw new AiVerseWorkspaceError(
      "EXTENSION_NOT_INSTALLED",
      "AI-Verse Data must be installed before a native workspace database can be initialized.",
    );
  }
  if (entry.enabled === false) {
    throw new AiVerseWorkspaceError(
      "EXTENSION_DISABLED",
      "AI-Verse Data is disabled in the AI-Verse OS local extension registry.",
    );
  }

  const canonical = buildDataExtensionEntry(entry);
  if (canonicalJson(entry) !== canonicalJson(canonical)) {
    throw new AiVerseWorkspaceError(
      "EXTENSION_INSTALLATION_INCOMPLETE",
      "AI-Verse Data extension registration is not current; reinstall/update the extension before workspace initialization.",
    );
  }

  let ownedFiles;
  try {
    ownedFiles = planOwnedFiles(root);
  } catch (error) {
    throw new AiVerseWorkspaceError(
      "EXTENSION_INSTALLATION_INCOMPLETE",
      "AI-Verse Data extension-owned files are unsafe or incomplete.",
      error,
    );
  }
  if (ownedFiles.some((file) => file.requiresWrite)) {
    throw new AiVerseWorkspaceError(
      "EXTENSION_INSTALLATION_INCOMPLETE",
      "AI-Verse Data extension-owned files are missing or outdated.",
    );
  }
}

function ensureWorkspaceDataDirectory(
  root: TrustedDataRoot,
  workspaceId: string,
): { readonly path: string; readonly created: boolean } {
  let path: string;
  try {
    path = root.resolve("workspaces", workspaceId, "data");
  } catch (error) {
    throw new AiVerseWorkspaceError(
      "DATABASE_PATH_UNSAFE",
      "Workspace Data directory path is unsafe.",
      error,
    );
  }

  if (existsSync(path)) {
    const info = lstatSync(path);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new AiVerseWorkspaceError(
        "DATABASE_PATH_UNSAFE",
        "Workspace Data path must be a real non-symlink directory.",
      );
    }
    return { path, created: false };
  }

  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if (!existsSync(path)) {
      throw new AiVerseWorkspaceError(
        "DATABASE_INITIALIZATION_FAILED",
        "Workspace Data directory could not be created.",
        error,
      );
    }
  }

  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new AiVerseWorkspaceError(
      "DATABASE_PATH_UNSAFE",
      "Workspace Data path became unsafe during initialization.",
    );
  }
  return { path, created: true };
}

function cleanTemporaryDatabase(path: string): void {
  rmSync(path, { force: true });
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });
  rmSync(`${path}${AI_VERSE_DATA_QUARANTINE_SUFFIX}`, {
    force: true,
  });
}

export class AiVerseDataWorkspaceManager
  implements AiVerseNativeWorkspaceApi
{
  constructor(
    private readonly driver: DataStorageDriver = new SqliteStorageDriver(),
  ) {}

  resolve(
    input: AiVerseWorkspaceResolveInput,
  ): AiVerseWorkspaceResolution {
    validateWorkspaceId(input.workspaceId);
    const root = requireCompatibleRoot(input.rootPath);
    resolveWorkspacePath(root, input.workspaceId);
    const manifest = readWorkspaceManifest(root, input.workspaceId);
    const scope = createResolvedScope(root, input.workspaceId);

    return {
      rootPath: root.canonicalPath,
      workspaceId: input.workspaceId,
      workspaceRelativePath: `workspaces/${input.workspaceId}`,
      manifestRelativePath:
        `workspaces/${input.workspaceId}/${AI_VERSE_WORKSPACE_MANIFEST}`,
      databaseRelativePath: databaseRelativePath(input.workspaceId),
      manifest,
      scope,
    };
  }

  async discover(
    input: AiVerseWorkspaceResolveInput,
  ): Promise<AiVerseWorkspaceDatabaseDiscovery> {
    const workspace = this.resolve(input);
    const root = TrustedDataRoot.fromExistingDirectory(
      workspace.rootPath,
    );
    const residue = auxiliaryResidue(root, workspace.workspaceId);
    const recovery = await new DataRecovery(this.driver).inspect({
      source: workspace.scope,
    });

    if (recovery.state === "missing") {
      if (residue.length > 0) {
        return {
          workspace,
          state: "residue",
          recovery,
          auxiliaryResidue: residue,
          cleanMissing: false,
          exactBinding: false,
        };
      }
      return {
        workspace,
        state: "missing",
        recovery,
        auxiliaryResidue: [],
        cleanMissing: true,
        exactBinding: false,
      };
    }

    let exactBinding = bindingEquals(
      recovery.binding,
      workspace.scope.binding,
    );

    if (recovery.state === "healthy") {
      try {
        const migration = this.driver.inspectMigration({
          location: workspace.scope.databasePath(),
          expectedBinding: workspace.scope.binding,
        });
        exactBinding = bindingEquals(
          migration.binding,
          workspace.scope.binding,
        );
        if (!exactBinding) {
          return {
            workspace,
            state: "unbound",
            recovery,
            auxiliaryResidue: residue,
            cleanMissing: false,
            exactBinding: false,
          };
        }
      } catch {
        exactBinding = false;
      }
    }

    return {
      workspace,
      state: recovery.state,
      recovery,
      auxiliaryResidue: residue,
      cleanMissing: false,
      exactBinding,
    };
  }

  async initialize(
    input: AiVerseWorkspaceResolveInput,
  ): Promise<AiVerseWorkspaceInitializationResult> {
    const workspace = this.resolve(input);
    if (workspace.manifest.status !== "active") {
      throw new AiVerseWorkspaceError(
        "WORKSPACE_INACTIVE",
        `Workspace '${workspace.workspaceId}' is ${workspace.manifest.status}; fresh native Data initialization requires an active workspace.`,
      );
    }

    const root = TrustedDataRoot.fromExistingDirectory(
      workspace.rootPath,
    );
    requireCurrentEnabledExtension(root);

    const before = await this.discover(input);
    if (before.state === "healthy" && before.exactBinding) {
      return {
        status: "already_initialized",
        workspace,
        discovery: before,
        metadata: currentMetadata(this.driver, workspace.scope),
      };
    }

    if (before.state === "residue") {
      throw new AiVerseWorkspaceError(
        "DATABASE_RESIDUE_PRESENT",
        `Workspace '${workspace.workspaceId}' has no canonical database but has residual database safety/runtime files: ${before.auxiliaryResidue.join(", ")}. Refusing empty replacement.`,
      );
    }

    if (before.state !== "missing" || !before.cleanMissing) {
      throw new AiVerseWorkspaceError(
        "DATABASE_NOT_INITIALIZABLE",
        `Workspace '${workspace.workspaceId}' database state is '${before.state}', not a clean missing state. Migration, recovery, repair, rebinding, or replacement is never implicit.`,
      );
    }

    const directory = ensureWorkspaceDataDirectory(
      root,
      workspace.workspaceId,
    );
    const temporaryRelative =
      `workspaces/${workspace.workspaceId}/data/.ai-verse-data-init-${randomUUID()}.sqlite`;
    const temporaryPath = root.resolve(
      ...temporaryRelative.split("/"),
    );
    const canonicalPath = workspace.scope.databasePath();
    let metadata: StorageDatabaseMetadata | null = null;

    try {
      const staged = this.driver.open({
        location: temporaryPath,
        mode: "create-or-open",
        expectedBinding: workspace.scope.binding,
      });
      try {
        metadata = staged.metadata();
        const integrity = staged.integrityCheck();
        if (!integrity.ok) {
          throw new AiVerseWorkspaceError(
            "DATABASE_INITIALIZATION_FAILED",
            `Staged workspace database failed integrity verification: ${integrity.messages.join("; ")}`,
          );
        }
      } finally {
        staged.close();
      }

      for (const auxiliary of [
        `${temporaryPath}-wal`,
        `${temporaryPath}-shm`,
        `${temporaryPath}${AI_VERSE_DATA_QUARANTINE_SUFFIX}`,
      ]) {
        if (existsSync(auxiliary)) {
          throw new AiVerseWorkspaceError(
            "DATABASE_INITIALIZATION_FAILED",
            "Staged workspace database left unresolved auxiliary state after close.",
          );
        }
      }

      const reopened = this.driver.open({
        location: temporaryPath,
        mode: "open-existing",
        expectedBinding: workspace.scope.binding,
      });
      try {
        const reopenedMetadata = reopened.metadata();
        if (
          !bindingEquals(
            reopenedMetadata.binding,
            workspace.scope.binding,
          )
        ) {
          throw new AiVerseWorkspaceError(
            "DATABASE_INITIALIZATION_FAILED",
            "Staged workspace database binding failed verification.",
          );
        }
        const integrity = reopened.integrityCheck();
        if (!integrity.ok) {
          throw new AiVerseWorkspaceError(
            "DATABASE_INITIALIZATION_FAILED",
            "Staged workspace database failed reopen integrity verification.",
          );
        }
      } finally {
        reopened.close();
      }

      try {
        linkSync(temporaryPath, canonicalPath);
      } catch (error) {
        const code =
          typeof error === "object" &&
          error !== null &&
          "code" in error
            ? String((error as { readonly code?: unknown }).code ?? "")
            : "";
        if (code === "EEXIST") {
          cleanTemporaryDatabase(temporaryPath);
          const concurrent = await this.discover(input);
          if (
            concurrent.state === "healthy" &&
            concurrent.exactBinding
          ) {
            return {
              status: "already_initialized",
              workspace,
              discovery: concurrent,
              metadata: currentMetadata(
                this.driver,
                workspace.scope,
              ),
            };
          }
          throw new AiVerseWorkspaceError(
            "DATABASE_NOT_INITIALIZABLE",
            `Canonical workspace Data path appeared concurrently in state '${concurrent.state}'. It was not overwritten.`,
            error,
          );
        }
        throw new AiVerseWorkspaceError(
          "DATABASE_INITIALIZATION_FAILED",
          "Could not atomically publish the staged workspace database without overwrite.",
          error,
        );
      }

      cleanTemporaryDatabase(temporaryPath);

      const after = await this.discover(input);
      if (after.state !== "healthy" || !after.exactBinding) {
        throw new AiVerseWorkspaceError(
          "DATABASE_NOT_HEALTHY",
          `New workspace database did not verify as healthy exact-binding state (state: ${after.state}). The canonical file was preserved for diagnosis.`,
        );
      }

      if (metadata === null) {
        throw new AiVerseWorkspaceError(
          "DATABASE_INITIALIZATION_FAILED",
          "Staged database metadata was unavailable after initialization.",
        );
      }

      return {
        status: "initialized",
        workspace,
        discovery: after,
        metadata,
      };
    } catch (error) {
      cleanTemporaryDatabase(temporaryPath);
      if (
        directory.created &&
        existsSync(directory.path) &&
        readdirSync(directory.path).length === 0
      ) {
        try {
          rmdirSync(directory.path);
        } catch {
          // Empty-directory cleanup is best effort and never overrides
          // the primary initialization failure.
        }
      }
      if (error instanceof AiVerseWorkspaceError) throw error;
      throw new AiVerseWorkspaceError(
        "DATABASE_INITIALIZATION_FAILED",
        issueMessage(error),
        error,
      );
    }
  }
}
