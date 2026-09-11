import {
  existsSync,
  lstatSync,
  readFileSync,
  statSync,
} from "node:fs";

import {
  TrustedDataRoot,
  createWorkspaceDataScope,
} from "../scope/index.js";
import { AiVerseOsCompatibilityDetector } from "./compatibility.js";
import {
  AI_VERSE_WORKSPACE_ID_PATTERN,
  AI_VERSE_WORKSPACE_MANIFEST_FILENAME,
  AI_VERSE_WORKSPACE_MAX_ID_LENGTH,
  AI_VERSE_WORKSPACE_MAX_MANIFEST_BYTES,
  AI_VERSE_WORKSPACE_SCHEMA_MAJOR,
  AiVerseWorkspaceError,
  type AiVerseResolvedWorkspace,
  type AiVerseWorkspaceInput,
  type AiVerseWorkspaceManifest,
  type AiVerseWorkspaceResolverApi,
  type AiVerseWorkspaceStatus,
} from "./workspace-types.js";

const MANIFEST_KEYS = new Set([
  "schema_version",
  "id",
  "name",
  "type",
  "status",
  "purpose",
]);

function assertValidWorkspaceId(workspaceId: string): void {
  if (
    workspaceId.length < 1 ||
    workspaceId.length > AI_VERSE_WORKSPACE_MAX_ID_LENGTH ||
    workspaceId.includes("\u0000") ||
    !AI_VERSE_WORKSPACE_ID_PATTERN.test(workspaceId)
  ) {
    throw new AiVerseWorkspaceError(
      "INVALID_WORKSPACE_ID",
      "Workspace ID must match the AI-Verse OS host contract ^[a-z0-9][a-z0-9-]*$ and remain safe as one filesystem segment.",
    );
  }
}

function requireCompatibleTrustedRoot(rootPath: string): TrustedDataRoot {
  const compatibility =
    new AiVerseOsCompatibilityDetector().inspect({ rootPath });

  if (compatibility.status === "no-os") {
    throw new AiVerseWorkspaceError(
      "AI_VERSE_OS_NOT_FOUND",
      "Native workspace resolution requires a compatible AI-Verse OS host.",
    );
  }

  if (
    compatibility.status !== "compatible" ||
    compatibility.rootPath === null
  ) {
    throw new AiVerseWorkspaceError(
      "INCOMPATIBLE_AI_VERSE_OS",
      `Native workspace resolution is blocked because the host is incompatible: ${compatibility.issues
        .map((issue) => issue.code)
        .join(", ") || "unknown incompatibility"}.`,
    );
  }

  try {
    return TrustedDataRoot.fromExistingDirectory(
      compatibility.rootPath,
    );
  } catch (error) {
    throw new AiVerseWorkspaceError(
      "INCOMPATIBLE_AI_VERSE_OS",
      "Compatible AI-Verse OS root could not be trusted for workspace resolution.",
      error,
    );
  }
}

function scalarValue(rawValue: string): string | null {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) return null;

  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    const closing = trimmed.lastIndexOf(quote);
    if (closing <= 0) return null;
    const trailing = trimmed.slice(closing + 1).trim();
    if (trailing.length > 0 && !trailing.startsWith("#")) {
      return null;
    }
    return trimmed.slice(1, closing);
  }

  const comment = trimmed.search(/\s+#/);
  return (comment === -1 ? trimmed : trimmed.slice(0, comment)).trim();
}

function manifestRootScalars(
  contents: string,
): ReadonlyMap<string, readonly string[]> {
  const values = new Map<string, string[]>();

  for (const rawLine of contents.split(/\r?\n/)) {
    if (rawLine.length === 0 || /^\s/.test(rawLine)) continue;
    const line = rawLine.trim();
    if (
      line.length === 0 ||
      line.startsWith("#") ||
      line === "---" ||
      line === "..."
    ) {
      continue;
    }

    const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (match === null) continue;
    const key = match[1]!;
    if (!MANIFEST_KEYS.has(key)) continue;
    const rawValue = match[2]!;

    const value = scalarValue(rawValue);
    const current = values.get(key) ?? [];
    current.push(value ?? "");
    if (value === null && rawValue.trim().length !== 0) {
      current[current.length - 1] = "\u0000INVALID\u0000";
    }
    values.set(key, current);
  }

  return values;
}

function singleField(
  scalars: ReadonlyMap<string, readonly string[]>,
  key: string,
  manifestPath: string,
): string {
  const entries = scalars.get(key) ?? [];
  if (entries.length !== 1) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_MANIFEST_MALFORMED",
      `WORKSPACE.yaml must declare '${key}' exactly once: ${manifestPath}.`,
    );
  }
  const value = entries[0]!;
  if (value === "\u0000INVALID\u0000") {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_MANIFEST_MALFORMED",
      `WORKSPACE.yaml field '${key}' is malformed: ${manifestPath}.`,
    );
  }
  return value;
}

function parseSchemaMajor(raw: string, manifestPath: string): number {
  const match = /^(\d+)(?:\.\d+){0,2}$/.exec(raw.trim());
  if (match === null) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_MANIFEST_MALFORMED",
      `WORKSPACE.yaml schema_version is not a valid numeric major/version: ${manifestPath}.`,
    );
  }
  const major = Number.parseInt(match[1]!, 10);
  if (!Number.isSafeInteger(major)) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_MANIFEST_MALFORMED",
      `WORKSPACE.yaml schema_version is not a valid numeric major/version: ${manifestPath}.`,
    );
  }
  return major;
}

function parseManifest(
  contents: string,
  manifestPath: string,
): AiVerseWorkspaceManifest {
  const scalars = manifestRootScalars(contents);

  const schemaRaw = singleField(scalars, "schema_version", manifestPath);
  const schemaMajor = parseSchemaMajor(schemaRaw, manifestPath);
  if (schemaMajor !== AI_VERSE_WORKSPACE_SCHEMA_MAJOR) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_SCHEMA_UNSUPPORTED",
      `Workspace schema major ${schemaMajor} is unsupported; Data requires major ${AI_VERSE_WORKSPACE_SCHEMA_MAJOR}: ${manifestPath}.`,
    );
  }

  const manifestId = singleField(scalars, "id", manifestPath);
  if (
    manifestId.length < 1 ||
    manifestId.length > AI_VERSE_WORKSPACE_MAX_ID_LENGTH ||
    !AI_VERSE_WORKSPACE_ID_PATTERN.test(manifestId)
  ) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_MANIFEST_MALFORMED",
      `WORKSPACE.yaml id does not satisfy the AI-Verse OS workspace contract: ${manifestPath}.`,
    );
  }

  const name = singleField(scalars, "name", manifestPath);
  if (name.trim().length < 1) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_MANIFEST_MALFORMED",
      `WORKSPACE.yaml name must be a non-empty string: ${manifestPath}.`,
    );
  }

  const type = singleField(scalars, "type", manifestPath);
  if (type.trim().length < 1) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_MANIFEST_MALFORMED",
      `WORKSPACE.yaml type must be a non-empty string: ${manifestPath}.`,
    );
  }

  const statusRaw = singleField(scalars, "status", manifestPath);
  if (
    statusRaw !== "active" &&
    statusRaw !== "paused" &&
    statusRaw !== "archived"
  ) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_STATUS_INVALID",
      `WORKSPACE.yaml status must be one of active, paused, or archived: ${manifestPath}.`,
    );
  }
  const status: AiVerseWorkspaceStatus = statusRaw;

  const purpose = singleField(scalars, "purpose", manifestPath);

  return {
    schemaMajor,
    workspaceId: manifestId,
    name,
    type,
    status,
    purpose,
  };
}

export function resolveWorkspace(
  input: AiVerseWorkspaceInput,
): AiVerseResolvedWorkspace {
  assertValidWorkspaceId(input.workspaceId);

  const root = requireCompatibleTrustedRoot(input.rootPath);

  let workspacePath: string;
  try {
    workspacePath = root.resolve("workspaces", input.workspaceId);
  } catch (error) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_UNSAFE",
      `Workspace '${input.workspaceId}' could not be resolved safely beneath the trusted OS root.`,
      error,
    );
  }

  if (!existsSync(workspacePath)) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_NOT_FOUND",
      `Workspace '${input.workspaceId}' does not exist under workspaces/.`,
    );
  }

  let workspaceInfo;
  try {
    workspaceInfo = lstatSync(workspacePath);
  } catch (error) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_UNSAFE",
      `Workspace '${input.workspaceId}' could not be inspected safely.`,
      error,
    );
  }
  if (workspaceInfo.isSymbolicLink() || !workspaceInfo.isDirectory()) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_UNSAFE",
      `Workspace '${input.workspaceId}' must be a real non-symlink directory.`,
    );
  }

  let manifestPath: string;
  try {
    manifestPath = root.resolve(
      "workspaces",
      input.workspaceId,
      AI_VERSE_WORKSPACE_MANIFEST_FILENAME,
    );
  } catch (error) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_MANIFEST_UNSAFE",
      `WORKSPACE.yaml for workspace '${input.workspaceId}' could not be resolved safely.`,
      error,
    );
  }

  if (!existsSync(manifestPath)) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_MANIFEST_MISSING",
      `WORKSPACE.yaml is missing for workspace '${input.workspaceId}'.`,
    );
  }

  let manifestInfo;
  try {
    manifestInfo = lstatSync(manifestPath);
  } catch (error) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_MANIFEST_UNSAFE",
      `WORKSPACE.yaml for workspace '${input.workspaceId}' could not be inspected safely.`,
      error,
    );
  }
  if (manifestInfo.isSymbolicLink() || !manifestInfo.isFile()) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_MANIFEST_UNSAFE",
      `WORKSPACE.yaml for workspace '${input.workspaceId}' must be a regular non-symlink file.`,
    );
  }

  let manifestSize: number;
  try {
    manifestSize = statSync(manifestPath).size;
  } catch (error) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_MANIFEST_UNSAFE",
      `WORKSPACE.yaml for workspace '${input.workspaceId}' could not be measured safely.`,
      error,
    );
  }
  if (manifestSize > AI_VERSE_WORKSPACE_MAX_MANIFEST_BYTES) {
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
      `WORKSPACE.yaml for workspace '${input.workspaceId}' could not be read safely.`,
      error,
    );
  }

  const manifest = parseManifest(contents, manifestPath);

  if (manifest.workspaceId !== input.workspaceId) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_ID_MISMATCH",
      `WORKSPACE.yaml id '${manifest.workspaceId}' does not match the requested workspace '${input.workspaceId}'; a copied or misplaced workspace fails closed.`,
    );
  }

  let databasePath: string;
  try {
    databasePath = createWorkspaceDataScope(
      root,
      input.workspaceId,
    ).databasePath();
  } catch (error) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_DATA_UNSAFE",
      `Workspace Data path for '${input.workspaceId}' could not be derived safely.`,
      error,
    );
  }

  return {
    rootPath: root.canonicalPath,
    workspaceId: input.workspaceId,
    workspacePath,
    manifestPath,
    manifest,
    databaseRelativePath: `workspaces/${input.workspaceId}/data/${"ai-verse-data.sqlite"}`,
    databasePath,
  };
}

export class AiVerseWorkspaceResolver
  implements AiVerseWorkspaceResolverApi
{
  resolve(input: AiVerseWorkspaceInput): AiVerseResolvedWorkspace {
    return resolveWorkspace(input);
  }
}
