import { createHash } from "node:crypto";

import { canonicalResultJson } from "../idempotency/fingerprint.js";
import {
  ACTOR_KINDS,
  validateJsonValue,
  type DataActor,
  type JsonObject,
} from "../protocol/index.js";
import type {
  StoredDataEvent,
  StoredDataEventInput,
  StoredMutationReceipt,
} from "../storage/index.js";
import { DataProvenanceError } from "./errors.js";
import {
  validateEventId,
  validateReceiptId,
  validateRequestId,
  validateTransactionId,
} from "./identifiers.js";
import type {
  DataEvent,
  DataEventType,
  DataMutationReceipt,
} from "./types.js";

const OPERATIONS = [
  "data.record.create",
  "data.record.update",
  "data.record.delete",
  "data.transaction.execute",
] as const;

const SAFE_ACTOR_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

type MutationOperation = (typeof OPERATIONS)[number];

const EVENT_OPERATION: Readonly<Record<DataEventType, MutationOperation>> = {
  "record.created": "data.record.create",
  "record.updated": "data.record.update",
  "record.deleted": "data.record.delete",
  "transaction.committed": "data.transaction.execute",
};

function digest(value: unknown): string {
  return createHash("sha256")
    .update(canonicalResultJson(value), "utf8")
    .digest("hex");
}

function corrupt(message: string): never {
  throw new DataProvenanceError("DATABASE_CORRUPT", message);
}

function actor(kind: string, id: string): DataActor {
  if (
    !(ACTOR_KINDS as readonly string[]).includes(kind) ||
    id.length < 1 ||
    id.length > 128 ||
    id === "." ||
    id === ".." ||
    !SAFE_ACTOR_ID_RE.test(id)
  ) {
    corrupt("Stored provenance actor is invalid.");
  }
  return { kind: kind as DataActor["kind"], id };
}

function validOperation(value: string): MutationOperation {
  if (!(OPERATIONS as readonly string[]).includes(value)) {
    corrupt("Stored provenance operation is invalid.");
  }
  return value as MutationOperation;
}

function validEventType(value: string): DataEventType {
  if (!Object.prototype.hasOwnProperty.call(EVENT_OPERATION, value)) {
    corrupt("Stored provenance event type is invalid.");
  }
  return value as DataEventType;
}

function validateCommon(
  value: {
    readonly operation: string;
    readonly requestId: string;
    readonly transactionId: string | null;
    readonly scopeKind: "unbound" | "standalone" | "workspace";
    readonly workspaceId: string | null;
    readonly idempotencyKey: string;
    readonly spaceId: string | null;
    readonly entity: string | null;
    readonly recordId: string | null;
    readonly beforeVersion: number | null;
    readonly afterVersion: number | null;
    readonly actorKind: string;
    readonly actorId: string;
    readonly committedAt: string;
  },
): {
  readonly operation: MutationOperation;
  readonly actor: DataActor;
} {
  const operation = validOperation(value.operation);

  try {
    validateRequestId(value.requestId);
    if (value.transactionId !== null) validateTransactionId(value.transactionId);
  } catch {
    corrupt("Stored provenance request/transaction identifier is invalid.");
  }

  if (
    value.scopeKind === "unbound"
      ? value.workspaceId !== null
      : value.workspaceId === null ||
        value.workspaceId.length < 1 ||
        value.workspaceId.length > 128
  ) {
    corrupt("Stored provenance scope identity is invalid.");
  }

  if (
    value.idempotencyKey.length < 1 ||
    value.idempotencyKey.length > 256 ||
    value.idempotencyKey.includes("\u0000")
  ) {
    corrupt("Stored provenance idempotency key is invalid.");
  }

  for (const part of [value.spaceId, value.entity, value.recordId]) {
    if (part !== null && (part.length < 1 || part.length > 128)) {
      corrupt("Stored provenance target identity is invalid.");
    }
  }

  for (const version of [value.beforeVersion, value.afterVersion]) {
    if (
      version !== null &&
      (!Number.isSafeInteger(version) || version < 1)
    ) {
      corrupt("Stored provenance version is invalid.");
    }
  }

  if (Number.isNaN(Date.parse(value.committedAt))) {
    corrupt("Stored provenance timestamp is invalid.");
  }

  return {
    operation,
    actor: actor(value.actorKind, value.actorId),
  };
}

function eventDigestMaterial(
  event: Omit<StoredDataEventInput, "eventDigest">,
): unknown {
  return event;
}

function receiptDigestMaterial(
  receipt: Omit<StoredMutationReceipt, "receiptDigest">,
): unknown {
  return receipt;
}

export function computeEventDigest(
  event: Omit<StoredDataEventInput, "eventDigest">,
): string {
  return digest(eventDigestMaterial(event));
}

export function computeReceiptDigest(
  receipt: Omit<StoredMutationReceipt, "receiptDigest">,
): string {
  return digest(receiptDigestMaterial(receipt));
}

function validateEventSemantics(
  eventType: DataEventType,
  operation: MutationOperation,
  transactionId: string | null,
  spaceId: string | null,
  entity: string | null,
  recordId: string | null,
  beforeVersion: number | null,
  afterVersion: number | null,
): void {
  if (EVENT_OPERATION[eventType] !== operation) {
    corrupt("Stored provenance event type does not match its operation.");
  }

  if (eventType === "transaction.committed") {
    if (
      transactionId === null ||
      spaceId !== null ||
      entity !== null ||
      recordId !== null ||
      beforeVersion !== null ||
      afterVersion !== null
    ) {
      corrupt("Stored transaction event shape is invalid.");
    }
    return;
  }

  if (spaceId === null || entity === null || recordId === null) {
    corrupt("Stored record event is missing its canonical target.");
  }

  if (eventType === "record.created") {
    if (beforeVersion !== null || afterVersion !== 1) {
      corrupt("Stored record-created event versions are invalid.");
    }
    return;
  }

  if (
    beforeVersion === null ||
    afterVersion === null ||
    afterVersion !== beforeVersion + 1
  ) {
    corrupt("Stored record mutation event versions are invalid.");
  }
}

export function hydrateStoredEvent(stored: StoredDataEvent): DataEvent {
  if (!Number.isSafeInteger(stored.sequence) || stored.sequence < 1) {
    corrupt("Stored event sequence is invalid.");
  }

  try {
    validateEventId(stored.eventId);
  } catch {
    corrupt("Stored event identifier is invalid.");
  }

  const eventType = validEventType(stored.eventType);
  const common = validateCommon(stored);
  validateEventSemantics(
    eventType,
    common.operation,
    stored.transactionId,
    stored.spaceId,
    stored.entity,
    stored.recordId,
    stored.beforeVersion,
    stored.afterVersion,
  );

  let details: JsonObject;
  try {
    const parsed = JSON.parse(stored.detailsJson) as unknown;
    const validated = validateJsonValue(parsed, "$event.details");
    if (
      validated === null ||
      Array.isArray(validated) ||
      typeof validated !== "object"
    ) {
      corrupt("Stored event details are not an object.");
    }
    details = JSON.parse(JSON.stringify(validated)) as JsonObject;
  } catch (error) {
    if (error instanceof DataProvenanceError) throw error;
    corrupt("Stored event details JSON is invalid.");
  }

  const expected = computeEventDigest({
    eventId: stored.eventId,
    eventType: stored.eventType,
    operation: stored.operation,
    requestId: stored.requestId,
    transactionId: stored.transactionId,
    scopeKind: stored.scopeKind,
    workspaceId: stored.workspaceId,
    idempotencyKey: stored.idempotencyKey,
    spaceId: stored.spaceId,
    entity: stored.entity,
    recordId: stored.recordId,
    beforeVersion: stored.beforeVersion,
    afterVersion: stored.afterVersion,
    actorKind: stored.actorKind,
    actorId: stored.actorId,
    committedAt: stored.committedAt,
    detailsJson: stored.detailsJson,
  });

  if (stored.eventDigest !== expected) {
    corrupt("Stored event digest does not match its canonical provenance.");
  }

  return {
    eventId: stored.eventId,
    eventType,
    operation: common.operation,
    requestId: stored.requestId,
    transactionId: stored.transactionId,
    scopeKind: stored.scopeKind,
    workspaceId: stored.workspaceId,
    idempotencyKey: stored.idempotencyKey,
    spaceId: stored.spaceId,
    entity: stored.entity,
    recordId: stored.recordId,
    beforeVersion: stored.beforeVersion,
    afterVersion: stored.afterVersion,
    actor: common.actor,
    committedAt: stored.committedAt,
    details,
  };
}

export function hydrateStoredReceipt(
  stored: StoredMutationReceipt,
): DataMutationReceipt {
  try {
    validateReceiptId(stored.receiptId);
    validateEventId(stored.eventId);
  } catch {
    corrupt("Stored receipt/event identifier is invalid.");
  }

  const common = validateCommon(stored);
  const expected = computeReceiptDigest({
    receiptId: stored.receiptId,
    eventId: stored.eventId,
    operation: stored.operation,
    requestId: stored.requestId,
    transactionId: stored.transactionId,
    scopeKind: stored.scopeKind,
    workspaceId: stored.workspaceId,
    idempotencyKey: stored.idempotencyKey,
    spaceId: stored.spaceId,
    entity: stored.entity,
    recordId: stored.recordId,
    beforeVersion: stored.beforeVersion,
    afterVersion: stored.afterVersion,
    actorKind: stored.actorKind,
    actorId: stored.actorId,
    committedAt: stored.committedAt,
  });

  if (stored.receiptDigest !== expected) {
    corrupt("Stored receipt digest does not match its canonical provenance.");
  }

  return {
    receiptId: stored.receiptId,
    eventId: stored.eventId,
    operation: common.operation,
    requestId: stored.requestId,
    transactionId: stored.transactionId,
    scopeKind: stored.scopeKind,
    workspaceId: stored.workspaceId,
    idempotencyKey: stored.idempotencyKey,
    spaceId: stored.spaceId,
    entity: stored.entity,
    recordId: stored.recordId,
    beforeVersion: stored.beforeVersion,
    afterVersion: stored.afterVersion,
    actor: common.actor,
    committedAt: stored.committedAt,
  };
}

export function assertReceiptMatchesEvent(
  receipt: DataMutationReceipt,
  event: DataEvent,
): void {
  const pairs: Array<readonly [unknown, unknown]> = [
    [receipt.eventId, event.eventId],
    [receipt.operation, event.operation],
    [receipt.requestId, event.requestId],
    [receipt.transactionId, event.transactionId],
    [receipt.scopeKind, event.scopeKind],
    [receipt.workspaceId, event.workspaceId],
    [receipt.idempotencyKey, event.idempotencyKey],
    [receipt.spaceId, event.spaceId],
    [receipt.entity, event.entity],
    [receipt.recordId, event.recordId],
    [receipt.beforeVersion, event.beforeVersion],
    [receipt.afterVersion, event.afterVersion],
    [receipt.actor.kind, event.actor.kind],
    [receipt.actor.id, event.actor.id],
    [receipt.committedAt, event.committedAt],
  ];

  if (pairs.some(([left, right]) => left !== right)) {
    corrupt("Stored receipt does not match its linked event.");
  }
}
