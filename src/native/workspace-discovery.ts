import { existsSync, lstatSync } from "node:fs";

import { DataRecovery } from "../recovery/index.js";
import {
  TrustedDataRoot,
  createWorkspaceDataScope,
} from "../scope/index.js";
import { SqliteStorageDriver } from "../storage/index.js";
import { resolveWorkspace } from "./workspace-resolver.js";
import {
  AiVerseWorkspaceError,
  type AiVerseWorkspaceDataDiscoveryResult,
  type AiVerseWorkspaceDiscoveryApi,
  type AiVerseWorkspaceInput,
} from "./workspace-types.js";

function detailFor(
  state: AiVerseWorkspaceDataDiscoveryResult["state"],
  native: string,
  extra: string | null,
): string {
  switch (state) {
    case "missing":
      return "No AI-Verse Data database exists at the resolved workspace Data path.";
    case "compatible":
      return "Existing workspace database is compatible and current.";
    case "migration_required":
      return extra !== null && extra.length > 0
        ? `Existing workspace database requires internal migration (${extra}).`
        : "Existing workspace database requires internal migration before normal use.";
    case "quarantined":
      return "Existing workspace database is quarantined or corrupt; canonical writes remain blocked.";
    case "scope_conflict":
      return "Existing workspace database is bound to a different workspace scope and cannot be rebound.";
    case "unsupported":
      return "Existing file is not a supported AI-Verse Data database for this workspace.";
    case "unavailable":
      return `Existing workspace database is unavailable (${native}).`;
  }
}

export async function discoverWorkspaceData(
  input: AiVerseWorkspaceInput,
): Promise<AiVerseWorkspaceDataDiscoveryResult> {
  const resolved = resolveWorkspace(input);

  let root: TrustedDataRoot;
  try {
    root = TrustedDataRoot.fromExistingDirectory(resolved.rootPath);
  } catch (error) {
    return {
      state: "unavailable",
      workspaceId: resolved.workspaceId,
      databasePath: resolved.databasePath,
      detail: `Trusted OS root became unavailable after workspace resolution: ${error instanceof Error ? error.message : "unknown filesystem error"}.`,
      nativeDetail: "unavailable",
      databaseFormatVersion: null,
      bindingWorkspaceId: null,
    };
  }

  const scope = createWorkspaceDataScope(root, resolved.workspaceId);
  const databasePath = scope.databasePath();
  if (databasePath !== resolved.databasePath) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_DATA_UNSAFE",
      `Resolved workspace Data path drifted during discovery for workspace '${resolved.workspaceId}'.`,
    );
  }

  if (!existsSync(databasePath)) {
    return {
      state: "missing",
      workspaceId: resolved.workspaceId,
      databasePath,
      detail: detailFor("missing", "missing", null),
      nativeDetail: "missing",
      databaseFormatVersion: null,
      bindingWorkspaceId: null,
    };
  }

  let info;
  try {
    info = lstatSync(databasePath);
  } catch {
    return {
      state: "unavailable",
      workspaceId: resolved.workspaceId,
      databasePath,
      detail: detailFor("unavailable", "lstat-failed", null),
      nativeDetail: "unavailable",
      databaseFormatVersion: null,
      bindingWorkspaceId: null,
    };
  }

  if (info.isSymbolicLink()) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_DATA_UNSAFE",
      `Workspace Data database must be a regular non-symlink file: workspaces/${resolved.workspaceId}/data/ai-verse-data.sqlite.`,
    );
  }

  if (!info.isFile()) {
    return {
      state: "unavailable",
      workspaceId: resolved.workspaceId,
      databasePath,
      detail: "Canonical database path exists but is not a regular file.",
      nativeDetail: "unavailable",
      databaseFormatVersion: null,
      bindingWorkspaceId: null,
    };
  }

  const recovery = new DataRecovery(new SqliteStorageDriver());
  const report = await recovery.inspect({ source: scope });

  switch (report.state) {
    case "healthy":
      return {
        state: "compatible",
        workspaceId: resolved.workspaceId,
        databasePath,
        detail: detailFor("compatible", "current", null),
        nativeDetail: "current",
        databaseFormatVersion: report.databaseFormatVersion,
        bindingWorkspaceId:
          report.binding?.workspaceId ?? scope.binding.workspaceId,
      };
    case "missing":
      return {
        state: "missing",
        workspaceId: resolved.workspaceId,
        databasePath,
        detail: detailFor("missing", "missing", null),
        nativeDetail: "missing",
        databaseFormatVersion: report.databaseFormatVersion,
        bindingWorkspaceId: report.binding?.workspaceId ?? null,
      };
    case "migration_required":
      return {
        state: "migration_required",
        workspaceId: resolved.workspaceId,
        databasePath,
        detail: detailFor(
          "migration_required",
          "required",
          report.migration?.pendingMigrationIds.join(", ") ?? null,
        ),
        nativeDetail: "required",
        databaseFormatVersion: report.databaseFormatVersion,
        bindingWorkspaceId: report.binding?.workspaceId ?? null,
      };
    case "migration_incomplete":
      return {
        state: "migration_required",
        workspaceId: resolved.workspaceId,
        databasePath,
        detail: detailFor(
          "migration_required",
          "incomplete",
          report.migration?.incompleteMigrationIds.join(", ") ?? null,
        ),
        nativeDetail: "incomplete",
        databaseFormatVersion: report.databaseFormatVersion,
        bindingWorkspaceId: report.binding?.workspaceId ?? null,
      };
    case "quarantined":
      return {
        state: "quarantined",
        workspaceId: resolved.workspaceId,
        databasePath,
        detail: detailFor("quarantined", "quarantined", null),
        nativeDetail: "quarantined",
        databaseFormatVersion: report.databaseFormatVersion,
        bindingWorkspaceId: report.binding?.workspaceId ?? null,
      };
    case "corrupt":
      return {
        state: "quarantined",
        workspaceId: resolved.workspaceId,
        databasePath,
        detail: detailFor("quarantined", "corrupt", null),
        nativeDetail: "corrupt",
        databaseFormatVersion: report.databaseFormatVersion,
        bindingWorkspaceId: report.binding?.workspaceId ?? null,
      };
    case "scope_conflict":
      return {
        state: "scope_conflict",
        workspaceId: resolved.workspaceId,
        databasePath,
        detail: detailFor("scope_conflict", "scope_conflict", null),
        nativeDetail: "scope_conflict",
        databaseFormatVersion: report.databaseFormatVersion,
        bindingWorkspaceId: report.binding?.workspaceId ?? null,
      };
    case "unrecognized":
      return {
        state: "unsupported",
        workspaceId: resolved.workspaceId,
        databasePath,
        detail: detailFor("unsupported", "unrecognized", null),
        nativeDetail: "unrecognized",
        databaseFormatVersion: report.databaseFormatVersion,
        bindingWorkspaceId: report.binding?.workspaceId ?? null,
      };
    case "unsupported":
      return {
        state: "unsupported",
        workspaceId: resolved.workspaceId,
        databasePath,
        detail: detailFor("unsupported", "unsupported", null),
        nativeDetail: "unsupported",
        databaseFormatVersion: report.databaseFormatVersion,
        bindingWorkspaceId: report.binding?.workspaceId ?? null,
      };
    case "unavailable":
      return {
        state: "unavailable",
        workspaceId: resolved.workspaceId,
        databasePath,
        detail: detailFor("unavailable", "unavailable", null),
        nativeDetail: "unavailable",
        databaseFormatVersion: report.databaseFormatVersion,
        bindingWorkspaceId: report.binding?.workspaceId ?? null,
      };
  }
}

export class AiVerseWorkspaceDiscovery
  implements AiVerseWorkspaceDiscoveryApi
{
  discover(
    input: AiVerseWorkspaceInput,
  ): Promise<AiVerseWorkspaceDataDiscoveryResult> {
    return discoverWorkspaceData(input);
  }
}
