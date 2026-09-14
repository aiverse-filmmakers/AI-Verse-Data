import { doctorData, statusData } from "./doctor.js";
import { discoverWorkspaceData } from "./workspace-discovery.js";
import { initWorkspaceData } from "./workspace-init.js";
import type { DataActor, DataAuthorization } from "../protocol/index.js";
import { openAiVerseDataHostSession } from "./host-adapter.js";

export const AI_VERSE_DATA_HOST_PROTOCOL = "ai-verse-data-host/1.0" as const;

export interface AiVerseDataHostEngineDescription {
  readonly protocol: typeof AI_VERSE_DATA_HOST_PROTOCOL;
  readonly extensionId: "ai-verse-data";
  readonly actorBinding: "human:local-operator";
  readonly authorizationBinding: "local-operator";
  readonly workspaceInitialization: "explicit";
  readonly hostBoundActorRequests: true;
}

export type AiVerseDataHostEngineRequest =
  | {
      readonly protocol: typeof AI_VERSE_DATA_HOST_PROTOCOL;
      readonly operation: "workspace.discover";
      readonly rootPath: string;
      readonly workspaceId: string;
    }
  | {
      readonly protocol: typeof AI_VERSE_DATA_HOST_PROTOCOL;
      readonly operation: "workspace.init";
      readonly rootPath: string;
      readonly workspaceId: string;
    }
  | {
      readonly protocol: typeof AI_VERSE_DATA_HOST_PROTOCOL;
      readonly operation: "data.request";
      readonly rootPath: string;
      readonly workspaceId: string;
      readonly data: {
        readonly operation: string;
        readonly payload: Record<string, unknown>;
      };
    }
  | {
      readonly protocol: typeof AI_VERSE_DATA_HOST_PROTOCOL;
      readonly operation: "data.host_bound_request";
      readonly rootPath: string;
      readonly workspaceId: string;
      readonly actor: DataActor;
      readonly authorization: DataAuthorization;
      readonly data: {
        readonly operation: string;
        readonly payload: Record<string, unknown>;
      };
    };

export function describeAiVerseDataHostEngine(): AiVerseDataHostEngineDescription {
  return {
    protocol: AI_VERSE_DATA_HOST_PROTOCOL,
    extensionId: "ai-verse-data",
    actorBinding: "human:local-operator",
    authorizationBinding: "local-operator",
    workspaceInitialization: "explicit",
    hostBoundActorRequests: true,
  };
}

function checkRequest(input: AiVerseDataHostEngineRequest): void {
  if (input.protocol !== AI_VERSE_DATA_HOST_PROTOCOL) {
    throw new Error(`Unsupported Data host protocol '${String(input.protocol)}'.`);
  }
}

export async function handleAiVerseDataHostRequest(
  input: AiVerseDataHostEngineRequest,
): Promise<unknown> {
  checkRequest(input);

  if (input.operation === "workspace.discover") {
    return discoverWorkspaceData({
      rootPath: input.rootPath,
      workspaceId: input.workspaceId,
    });
  }
  if (input.operation === "workspace.init") {
    return initWorkspaceData({
      rootPath: input.rootPath,
      workspaceId: input.workspaceId,
    });
  }

  if (input.data.operation === "data.doctor") {
    return doctorData({ rootPath: input.rootPath, workspaceId: input.workspaceId });
  }
  if (input.data.operation === "data.status") {
    return statusData({ rootPath: input.rootPath, workspaceId: input.workspaceId });
  }

  const hostBound = input.operation === "data.host_bound_request";
  const session = await openAiVerseDataHostSession({
    rootPath: input.rootPath,
    workspaceId: input.workspaceId,
    actor: hostBound ? input.actor : { kind: "human", id: "local-operator" },
    authorization: hostBound
      ? input.authorization
      : { mode: "local-operator" },
    initializeIfMissing:
      hostBound && input.data.operation === "data.structure.ensure",
  });
  const payload = input.data.payload as never;
  try {
    switch (input.data.operation) {
      case "data.structure.ensure":
        if (!hostBound) {
          throw new Error("data.structure.ensure requires the trusted host-bound actor path.");
        }
        return session.client.schemas.ensure(payload);
      case "data.space.list":
        return session.client.spaces.list();
      case "data.space.get":
        return session.client.spaces.get(payload);
      case "data.space.create":
        return session.client.spaces.create(payload);
      case "data.schema.list":
        return session.client.schemas.list(payload);
      case "data.schema.get":
        return session.client.schemas.get(payload);
      case "data.schema.create":
        return session.client.schemas.create(payload);
      case "data.schema.update":
        return session.client.schemas.update(payload);
      case "data.schema.migration.preview":
        return session.client.schemas.previewMigration(payload);
      case "data.schema.migration.execute":
        return session.client.schemas.executeMigration(payload);
      case "data.record.get":
        return session.client.records.get(payload);
      case "data.record.list":
        return session.client.records.list(payload);
      case "data.record.create":
        return session.client.records.create(payload);
      case "data.record.update":
        return session.client.records.update(payload);
      case "data.record.delete":
        return session.client.records.remove(payload);
      case "data.query":
        return session.client.query.query(payload);
      case "data.aggregate":
        return session.client.query.aggregate(payload);
      case "data.bulk.preview":
        return session.client.bulk.preview((input.data.payload as { operations: never[] }).operations);
      case "data.bulk.execute":
        return session.client.bulk.execute(payload);
      case "data.transaction.execute":
        return session.client.transactions.execute(payload);
      case "data.events.list":
        return session.client.provenance.listEvents(payload);
      default:
        throw new Error(`Unsupported Data operation '${input.data.operation}'.`);
    }
  } finally {
    session.close();
  }
}
