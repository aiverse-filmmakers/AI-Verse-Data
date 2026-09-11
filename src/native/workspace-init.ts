import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import {
  TrustedDataRoot,
  createWorkspaceDataScope,
  openScopedDataDatabase,
} from "../scope/index.js";
import { SqliteStorageDriver } from "../storage/index.js";
import { discoverWorkspaceData } from "./workspace-discovery.js";
import { resolveWorkspace } from "./workspace-resolver.js";
import {
  AiVerseWorkspaceError,
  type AiVerseWorkspaceInitApi,
  type AiVerseWorkspaceInitResult,
  type AiVerseWorkspaceInput,
} from "./workspace-types.js";

function ensureDatabaseParent(databasePath: string): void {
  const parent = dirname(databasePath);
  if (existsSync(parent)) {
    const info = lstatSync(parent);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new AiVerseWorkspaceError(
        "WORKSPACE_DATA_UNSAFE",
        "Workspace data/ parent must be a real non-symlink directory.",
      );
    }
    return;
  }

  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const created = lstatSync(parent);
  if (created.isSymbolicLink() || !created.isDirectory()) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_DATA_UNSAFE",
      "Workspace data/ parent could not be created as a real non-symlink directory.",
    );
  }
}

export async function initWorkspaceData(
  input: AiVerseWorkspaceInput,
): Promise<AiVerseWorkspaceInitResult> {
  const resolved = resolveWorkspace(input);

  if (resolved.manifest.status !== "active") {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_NOT_ACTIVE",
      `Workspace '${resolved.workspaceId}' has status '${resolved.manifest.status}'; fresh Data initialization requires an active workspace.`,
    );
  }

  const discovery = await discoverWorkspaceData(input);

  if (discovery.state === "compatible") {
    return {
      status: "unchanged",
      workspaceId: resolved.workspaceId,
      workspacePath: resolved.workspacePath,
      databasePath: resolved.databasePath,
      workspaceStatus: resolved.manifest.status,
      discovery,
    };
  }

  if (discovery.state !== "missing") {
    switch (discovery.state) {
      case "migration_required":
        throw new AiVerseWorkspaceError(
          "WORKSPACE_DATABASE_MIGRATION_REQUIRED",
          `Workspace '${resolved.workspaceId}' already has a Data database requiring migration; initialization must not replace or migrate it silently.`,
        );
      case "quarantined":
        throw new AiVerseWorkspaceError(
          "WORKSPACE_DATABASE_QUARANTINED",
          `Workspace '${resolved.workspaceId}' already has a quarantined or corrupt Data database; initialization must not replace it silently.`,
        );
      case "scope_conflict":
        throw new AiVerseWorkspaceError(
          "WORKSPACE_DATABASE_CONFLICT",
          `Workspace '${resolved.workspaceId}' already has a Data database bound to a different workspace; initialization must not rebind it silently.`,
        );
      case "unsupported":
        throw new AiVerseWorkspaceError(
          "WORKSPACE_DATABASE_UNSUPPORTED",
          `Workspace '${resolved.workspaceId}' already has an unsupported database file; initialization must not replace it silently.`,
        );
      case "unavailable":
        throw new AiVerseWorkspaceError(
          "WORKSPACE_DATA_UNAVAILABLE",
          `Workspace '${resolved.workspaceId}' Data path is unavailable; initialization cannot proceed safely.`,
        );
    }
  }

  const root = TrustedDataRoot.fromExistingDirectory(
    resolved.rootPath,
  );
  const scope = createWorkspaceDataScope(root, resolved.workspaceId);
  const databasePath = scope.databasePath();
  if (databasePath !== resolved.databasePath) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_DATA_UNSAFE",
      `Resolved workspace Data path drifted before initialization for workspace '${resolved.workspaceId}'.`,
    );
  }

  if (existsSync(databasePath)) {
    const raced = await discoverWorkspaceData(input);
    if (raced.state === "compatible") {
      return {
        status: "unchanged",
        workspaceId: resolved.workspaceId,
        workspacePath: resolved.workspacePath,
        databasePath: resolved.databasePath,
        workspaceStatus: resolved.manifest.status,
        discovery: raced,
      };
    }
    throw new AiVerseWorkspaceError(
      "WORKSPACE_DATABASE_CONFLICT",
      `Workspace '${resolved.workspaceId}' Data database appeared during initialization (state: ${raced.state}); refusing to replace it.`,
    );
  }

  ensureDatabaseParent(databasePath);

  const driver = new SqliteStorageDriver();
  const handle = openScopedDataDatabase(driver, scope, {
    mode: "create-or-open",
  });
  try {
    const binding = handle.database.metadata().binding;
    if (
      binding === null ||
      binding.kind !== "workspace" ||
      binding.workspaceId !== resolved.workspaceId
    ) {
      throw new AiVerseWorkspaceError(
        "WORKSPACE_DATABASE_CONFLICT",
        `Fresh workspace database did not embed the exact workspace binding for '${resolved.workspaceId}'.`,
      );
    }
  } finally {
    handle.database.close();
  }

  const after = await discoverWorkspaceData(input);
  if (after.state !== "compatible") {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_DATA_UNAVAILABLE",
      `Fresh workspace database for '${resolved.workspaceId}' did not verify compatible after initialization (state: ${after.state}).`,
    );
  }

  return {
    status: "created",
    workspaceId: resolved.workspaceId,
    workspacePath: resolved.workspacePath,
    databasePath: resolved.databasePath,
    workspaceStatus: resolved.manifest.status,
    discovery: after,
  };
}

export class AiVerseWorkspaceDataInitializer
  implements AiVerseWorkspaceInitApi
{
  initialize(
    input: AiVerseWorkspaceInput,
  ): Promise<AiVerseWorkspaceInitResult> {
    return initWorkspaceData(input);
  }
}
