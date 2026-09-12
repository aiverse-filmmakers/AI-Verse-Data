import { createDataClient, type DataClient } from "../client/index.js";
import type { DataActor, DataAuthorization } from "../protocol/index.js";
import { TrustedDataRoot, createWorkspaceDataScope } from "../scope/index.js";
import { discoverWorkspaceData } from "./workspace-discovery.js";
import { initWorkspaceData } from "./workspace-init.js";
import { resolveWorkspace } from "./workspace-resolver.js";
import { AiVerseWorkspaceError } from "./workspace-types.js";

export interface OpenAiVerseDataHostSessionInput {
  readonly rootPath: string;
  readonly workspaceId: string;
  readonly actor: DataActor;
  readonly authorization: DataAuthorization;
  readonly initializeIfMissing?: boolean;
}

export interface AiVerseDataHostSession {
  readonly workspaceId: string;
  readonly workspacePath: string;
  readonly databasePath: string;
  readonly initialized: "created" | "existing";
  readonly client: DataClient;
  close(): void;
}

/**
 * Supported OS-to-Data host bridge.
 *
 * The host supplies the canonical OS root, exact workspace identity, actor, and
 * host-bound authorization. The bridge resolves that workspace without scans or
 * guessing, optionally initializes only a genuinely missing active-workspace
 * database, verifies compatibility, then returns the typed Data client.
 */
export async function openAiVerseDataHostSession(
  input: OpenAiVerseDataHostSessionInput,
): Promise<AiVerseDataHostSession> {
  const resolved = resolveWorkspace({
    rootPath: input.rootPath,
    workspaceId: input.workspaceId,
  });
  let discovery = await discoverWorkspaceData({
    rootPath: resolved.rootPath,
    workspaceId: resolved.workspaceId,
  });
  let initialized: "created" | "existing" = "existing";

  if (discovery.state === "missing") {
    if (input.initializeIfMissing !== true) {
      throw new AiVerseWorkspaceError(
        "WORKSPACE_DATA_UNAVAILABLE",
        `Workspace '${resolved.workspaceId}' has no Data database. The host must explicitly allow initializeIfMissing before Data creates canonical workspace state.`,
      );
    }
    const init = await initWorkspaceData({
      rootPath: resolved.rootPath,
      workspaceId: resolved.workspaceId,
    });
    initialized = init.status === "created" ? "created" : "existing";
    discovery = init.discovery;
  }

  if (discovery.state !== "compatible") {
    const code =
      discovery.state === "migration_required"
        ? "WORKSPACE_DATABASE_MIGRATION_REQUIRED"
        : discovery.state === "quarantined"
          ? "WORKSPACE_DATABASE_QUARANTINED"
          : discovery.state === "scope_conflict"
            ? "WORKSPACE_DATABASE_CONFLICT"
            : discovery.state === "unsupported"
              ? "WORKSPACE_DATABASE_UNSUPPORTED"
              : "WORKSPACE_DATA_UNAVAILABLE";
    throw new AiVerseWorkspaceError(
      code,
      `Workspace '${resolved.workspaceId}' Data state is '${discovery.state}' and cannot be opened as a normal host session.`,
    );
  }

  const root = TrustedDataRoot.fromExistingDirectory(resolved.rootPath);
  const scope = createWorkspaceDataScope(root, resolved.workspaceId);
  if (scope.databasePath() !== resolved.databasePath) {
    throw new AiVerseWorkspaceError(
      "WORKSPACE_DATA_UNSAFE",
      `Workspace '${resolved.workspaceId}' Data path drifted before host-session open.`,
    );
  }
  const client = createDataClient({
    scope,
    actor: input.actor,
    authorization: input.authorization,
  });

  return {
    workspaceId: resolved.workspaceId,
    workspacePath: resolved.workspacePath,
    databasePath: resolved.databasePath,
    initialized,
    client,
    close(): void {
      client.close();
    },
  };
}
