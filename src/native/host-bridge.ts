import { randomUUID } from "node:crypto";

import { createDataClient } from "../client/index.js";
import {
  DATA_PROTOCOL_LIMITS,
  DATA_PROTOCOL_VERSION,
  type DataOperation,
  type DataRequestEnvelope,
  validateRequestEnvelope,
} from "../protocol/index.js";
import {
  TrustedDataRoot,
  createWorkspaceDataScope,
} from "../scope/index.js";
import {
  discoverWorkspaceData,
} from "./workspace-discovery.js";
import {
  initWorkspaceData,
} from "./workspace-init.js";

export const AI_VERSE_DATA_HOST_PROTOCOL =
  "ai-verse-data-host/1.0" as const;

export type AiVerseDataHostOperation =
  | "describe"
  | "workspace.discover"
  | "workspace.init"
  | "data.request";

export interface AiVerseDataHostRequest {
  readonly protocol: typeof AI_VERSE_DATA_HOST_PROTOCOL;
  readonly operation: AiVerseDataHostOperation;
  readonly rootPath: string;
  readonly workspaceId?: string;
  readonly data?: {
    readonly operation: DataOperation;
    readonly payload: unknown;
  };
}

export class AiVerseDataHostBridgeError extends Error {
  readonly code:
    | "HOST_REQUEST_INVALID"
    | "HOST_DATA_NOT_INITIALIZED"
    | "HOST_DATA_UNAVAILABLE";

  constructor(
    code: AiVerseDataHostBridgeError["code"],
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AiVerseDataHostBridgeError";
    this.code = code;
  }
}

const HOST_REQUEST_KEYS = new Set([
  "protocol",
  "operation",
  "rootPath",
  "workspaceId",
  "data",
]);

function invalid(message: string): never {
  throw new AiVerseDataHostBridgeError(
    "HOST_REQUEST_INVALID",
    message,
  );
}

function validateHostRequest(
  input: unknown,
): AiVerseDataHostRequest {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input)
  ) {
    invalid("Data host request must be an object.");
  }
  const value = input as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (!HOST_REQUEST_KEYS.has(key)) {
      invalid(`Unknown Data host request field '${key}'.`);
    }
  }
  if (value.protocol !== AI_VERSE_DATA_HOST_PROTOCOL) {
    invalid(
      `Data host protocol must equal '${AI_VERSE_DATA_HOST_PROTOCOL}'.`,
    );
  }
  if (
    value.operation !== "describe" &&
    value.operation !== "workspace.discover" &&
    value.operation !== "workspace.init" &&
    value.operation !== "data.request"
  ) {
    invalid("Data host operation is unsupported.");
  }
  if (
    typeof value.rootPath !== "string" ||
    value.rootPath.length < 1 ||
    value.rootPath.length > 4096 ||
    value.rootPath.includes("\u0000")
  ) {
    invalid("Data host rootPath is invalid.");
  }

  if (value.operation !== "describe") {
    if (
      typeof value.workspaceId !== "string" ||
      value.workspaceId.length < 1 ||
      value.workspaceId.length > DATA_PROTOCOL_LIMITS.maxIdLength ||
      !/^[a-z0-9][a-z0-9-]*$/.test(value.workspaceId)
    ) {
      invalid(
        "Data host workspaceId must be a valid AI-Verse workspace ID.",
      );
    }
  }

  if (value.operation === "data.request") {
    if (
      typeof value.data !== "object" ||
      value.data === null ||
      Array.isArray(value.data)
    ) {
      invalid("data.request requires a data object.");
    }
    const data = value.data as Record<string, unknown>;
    const keys = Object.keys(data);
    if (
      keys.some((key) => key !== "operation" && key !== "payload") ||
      keys.length !== 2
    ) {
      invalid(
        "data.request data must contain exactly operation and payload.",
      );
    }
    if (typeof data.operation !== "string") {
      invalid("data.request operation must be a string.");
    }
  } else if (value.data !== undefined) {
    invalid("Only data.request may include a data field.");
  }

  let bytes: number;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    invalid("Data host request must be JSON-serializable.");
  }
  if (bytes! > DATA_PROTOCOL_LIMITS.maxRequestBytes) {
    invalid(
      `Data host request exceeds ${DATA_PROTOCOL_LIMITS.maxRequestBytes} bytes.`,
    );
  }

  return input as AiVerseDataHostRequest;
}

function protocolEnvelope(
  workspaceId: string,
  data: NonNullable<AiVerseDataHostRequest["data"]>,
): DataRequestEnvelope {
  const envelope = {
    protocol: DATA_PROTOCOL_VERSION,
    requestId: `req_${randomUUID().replaceAll("-", "")}`,
    operation: data.operation,
    scope: { workspaceId },
    actor: { kind: "human", id: "local-operator" },
    authorization: { mode: "local-operator" },
    payload: data.payload,
  };
  return validateRequestEnvelope(envelope);
}

function dispatch(
  client: ReturnType<typeof createDataClient>,
  request: DataRequestEnvelope,
): unknown {
  switch (request.operation) {
    case "data.space.list":
      return client.spaces.list();
    case "data.space.get":
      return client.spaces.get(request.payload);
    case "data.space.create":
      return client.spaces.create(request.payload);
    case "data.schema.list":
      return client.schemas.list(request.payload);
    case "data.schema.get":
      return client.schemas.get(request.payload);
    case "data.schema.create":
      return client.schemas.create(request.payload);
    case "data.schema.update":
      return client.schemas.update(request.payload);
    case "data.schema.migration.preview":
      return client.schemas.previewMigration(request.payload);
    case "data.schema.migration.execute":
      return client.schemas.executeMigration(request.payload);
    case "data.record.create":
      return client.records.create(request.payload);
    case "data.record.get":
      return client.records.get(request.payload);
    case "data.record.list":
      return client.records.list(request.payload);
    case "data.record.update":
      return client.records.update(request.payload);
    case "data.record.delete":
      return client.records.remove(request.payload);
    case "data.query":
      return client.query.query(request.payload);
    case "data.aggregate":
      return client.query.aggregate(request.payload);
    case "data.bulk.preview":
      return client.bulk.preview(request.payload.operations);
    case "data.bulk.execute":
      return client.bulk.execute(request.payload);
    case "data.transaction.execute":
      return client.transactions.execute(request.payload);
    case "data.events.list":
      return client.provenance.listEvents(request.payload);
    case "data.doctor":
      return client.health.integrityCheck();
    case "data.status":
      return {
        diagnostics: client.health.diagnostics(),
        migration: client.health.migrationStatus(),
      };
  }
}

export function describeNativeDataHost(): {
  readonly protocol: typeof AI_VERSE_DATA_HOST_PROTOCOL;
  readonly actorBinding: "human:local-operator";
  readonly authorizationBinding: "local-operator";
  readonly workspaceInitialization: "explicit";
  readonly dataProtocol: typeof DATA_PROTOCOL_VERSION;
} {
  return {
    protocol: AI_VERSE_DATA_HOST_PROTOCOL,
    actorBinding: "human:local-operator",
    authorizationBinding: "local-operator",
    workspaceInitialization: "explicit",
    dataProtocol: DATA_PROTOCOL_VERSION,
  };
}

export async function handleNativeDataHostRequest(
  input: unknown,
): Promise<unknown> {
  const request = validateHostRequest(input);

  if (request.operation === "describe") {
    return describeNativeDataHost();
  }

  const workspaceId = request.workspaceId as string;

  if (request.operation === "workspace.discover") {
    return discoverWorkspaceData({
      rootPath: request.rootPath,
      workspaceId,
    });
  }

  if (request.operation === "workspace.init") {
    return initWorkspaceData({
      rootPath: request.rootPath,
      workspaceId,
    });
  }

  const discovery = await discoverWorkspaceData({
    rootPath: request.rootPath,
    workspaceId,
  });
  if (discovery.state === "missing") {
    throw new AiVerseDataHostBridgeError(
      "HOST_DATA_NOT_INITIALIZED",
      `Workspace '${workspaceId}' has no Data database. Initialize it explicitly before Data operations.`,
    );
  }
  if (discovery.state !== "compatible") {
    throw new AiVerseDataHostBridgeError(
      "HOST_DATA_UNAVAILABLE",
      `Workspace '${workspaceId}' Data state is '${discovery.state}' and cannot serve operations.`,
    );
  }

  const data = request.data;
  if (data === undefined) {
    invalid("data.request requires a data object.");
  }
  const envelope = protocolEnvelope(workspaceId, data);
  const root = TrustedDataRoot.fromExistingDirectory(request.rootPath);
  const client = createDataClient({
    scope: createWorkspaceDataScope(root, workspaceId),
    actor: { kind: "human", id: "local-operator" },
    authorization: { mode: "local-operator" },
  });
  try {
    return dispatch(client, envelope);
  } finally {
    client.close();
  }
}
