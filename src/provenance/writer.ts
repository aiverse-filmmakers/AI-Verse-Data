import {
  canonicalResultJson,
} from "../idempotency/fingerprint.js";
import {
  validateJsonValue,
  type DataActor,
  type JsonObject,
} from "../protocol/index.js";
import type {
  DataProvenanceStorage,
  DataStorageDatabase,
  StoredDataEventInput,
  StoredMutationReceipt,
} from "../storage/index.js";
import {
  computeEventDigest,
  computeReceiptDigest,
  hydrateStoredEvent,
  hydrateStoredReceipt,
} from "./integrity.js";
import {
  createEventId,
  createReceiptId,
  validateRequestId,
  validateTransactionId,
} from "./identifiers.js";
import type {
  DataEventType,
  DataMutationProvenance,
} from "./types.js";

export interface RecordMutationProvenanceInput {
  readonly operation:
    | "data.record.create"
    | "data.record.update"
    | "data.record.delete";
  readonly requestId: string;
  readonly transactionId?: string;
  readonly idempotencyKey: string;
  readonly spaceId: string;
  readonly entity: string;
  readonly recordId: string;
  readonly beforeVersion: number | null;
  readonly afterVersion: number;
  readonly actor: DataActor;
  readonly committedAt: string;
  readonly details?: JsonObject;
}

export interface TransactionCommitProvenanceInput {
  readonly requestId: string;
  readonly transactionId: string;
  readonly idempotencyKey: string;
  readonly actor: DataActor;
  readonly committedAt: string;
  readonly childEventIds: readonly string[];
  readonly childReceiptIds: readonly string[];
  readonly operationCount: number;
}

function eventTypeFor(
  operation: RecordMutationProvenanceInput["operation"],
): DataEventType {
  switch (operation) {
    case "data.record.create":
      return "record.created";
    case "data.record.update":
      return "record.updated";
    case "data.record.delete":
      return "record.deleted";
  }
}

function validateDetails(details: JsonObject | undefined): JsonObject {
  const input = details ?? {};
  const validated = validateJsonValue(input, "$provenance.details");
  if (
    validated === null ||
    Array.isArray(validated) ||
    typeof validated !== "object"
  ) {
    throw new Error("Provenance details must be a JSON object.");
  }
  return validated as JsonObject;
}

export class DataProvenanceWriter {
  private readonly store: DataProvenanceStorage;
  private readonly scopeKind: "unbound" | "standalone" | "workspace";
  private readonly workspaceId: string | null;

  constructor(database: DataStorageDatabase) {
    this.store = database.provenanceStorage();
    this.store.initialize();
    const binding = database.metadata().binding;
    this.scopeKind = binding?.kind ?? "unbound";
    this.workspaceId = binding?.workspaceId ?? null;
  }

  recordMutation(
    input: RecordMutationProvenanceInput,
  ): DataMutationProvenance {
    validateRequestId(input.requestId);
    if (input.transactionId !== undefined) {
      validateTransactionId(input.transactionId);
    }

    const details = validateDetails(input.details);
    return this.append({
      eventType: eventTypeFor(input.operation),
      operation: input.operation,
      requestId: input.requestId,
      transactionId: input.transactionId ?? null,
      idempotencyKey: input.idempotencyKey,
      spaceId: input.spaceId,
      entity: input.entity,
      recordId: input.recordId,
      beforeVersion: input.beforeVersion,
      afterVersion: input.afterVersion,
      actor: input.actor,
      committedAt: input.committedAt,
      details,
    });
  }

  transactionCommitted(
    input: TransactionCommitProvenanceInput,
  ): DataMutationProvenance {
    validateRequestId(input.requestId);
    validateTransactionId(input.transactionId);

    return this.append({
      eventType: "transaction.committed",
      operation: "data.transaction.execute",
      requestId: input.requestId,
      transactionId: input.transactionId,
      idempotencyKey: input.idempotencyKey,
      spaceId: null,
      entity: null,
      recordId: null,
      beforeVersion: null,
      afterVersion: null,
      actor: input.actor,
      committedAt: input.committedAt,
      details: {
        operationCount: input.operationCount,
        childEventIds: [...input.childEventIds],
        childReceiptIds: [...input.childReceiptIds],
      },
    });
  }

  private append(input: {
    readonly eventType: DataEventType;
    readonly operation:
      | "data.record.create"
      | "data.record.update"
      | "data.record.delete"
      | "data.transaction.execute";
    readonly requestId: string;
    readonly transactionId: string | null;
    readonly idempotencyKey: string;
    readonly spaceId: string | null;
    readonly entity: string | null;
    readonly recordId: string | null;
    readonly beforeVersion: number | null;
    readonly afterVersion: number | null;
    readonly actor: DataActor;
    readonly committedAt: string;
    readonly details: JsonObject;
  }): DataMutationProvenance {
    const eventId = createEventId();
    const receiptId = createReceiptId();
    const detailsJson = canonicalResultJson(input.details);

    const eventBase: Omit<StoredDataEventInput, "eventDigest"> = {
      eventId,
      eventType: input.eventType,
      operation: input.operation,
      requestId: input.requestId,
      transactionId: input.transactionId,
      scopeKind: this.scopeKind,
      workspaceId: this.workspaceId,
      idempotencyKey: input.idempotencyKey,
      spaceId: input.spaceId,
      entity: input.entity,
      recordId: input.recordId,
      beforeVersion: input.beforeVersion,
      afterVersion: input.afterVersion,
      actorKind: input.actor.kind,
      actorId: input.actor.id,
      committedAt: input.committedAt,
      detailsJson,
    };
    const event: StoredDataEventInput = {
      ...eventBase,
      eventDigest: computeEventDigest(eventBase),
    };

    const receiptBase: Omit<StoredMutationReceipt, "receiptDigest"> = {
      receiptId,
      eventId,
      operation: input.operation,
      requestId: input.requestId,
      transactionId: input.transactionId,
      scopeKind: this.scopeKind,
      workspaceId: this.workspaceId,
      idempotencyKey: input.idempotencyKey,
      spaceId: input.spaceId,
      entity: input.entity,
      recordId: input.recordId,
      beforeVersion: input.beforeVersion,
      afterVersion: input.afterVersion,
      actorKind: input.actor.kind,
      actorId: input.actor.id,
      committedAt: input.committedAt,
    };
    const receipt: StoredMutationReceipt = {
      ...receiptBase,
      receiptDigest: computeReceiptDigest(receiptBase),
    };

    const storedEvent = this.store.append(event, receipt);
    return {
      event: hydrateStoredEvent(storedEvent),
      receipt: hydrateStoredReceipt(receipt),
    };
  }
}
