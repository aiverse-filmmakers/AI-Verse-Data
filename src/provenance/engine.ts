import {
  DATA_PROTOCOL_LIMITS,
} from "../protocol/index.js";
import type {
  DataStorageDatabase,
  StoredMutationReceipt,
} from "../storage/index.js";
import {
  decodeEventCursor,
  encodeEventCursor,
  type EventCursorFilter,
} from "./cursor.js";
import { DataProvenanceError } from "./errors.js";
import {
  assertReceiptMatchesEvent,
  hydrateStoredEvent,
  hydrateStoredReceipt,
} from "./integrity.js";
import {
  validateReceiptId,
  validateTransactionId,
} from "./identifiers.js";
import type {
  DataEventListInput,
  DataEventPage,
  DataMutationReceipt,
  DataProvenanceApi,
  DataReceiptByIdempotencyKeyInput,
  DataReceiptGetInput,
  DataTransactionReceiptsInput,
} from "./types.js";

const SLUG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function queryInvalid(message: string): never {
  throw new DataProvenanceError("QUERY_INVALID", message);
}

function validateSlug(value: string, field: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 64 ||
    !SLUG_RE.test(value)
  ) {
    queryInvalid(`${field} must be a lowercase Data identifier slug.`);
  }
  return value;
}

function validateRecordId(value: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > DATA_PROTOCOL_LIMITS.maxIdLength ||
    value === "." ||
    value === ".." ||
    !SAFE_ID_RE.test(value)
  ) {
    queryInvalid("recordId is invalid.");
  }
  return value;
}

function validateIdempotencyKey(value: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > DATA_PROTOCOL_LIMITS.maxIdempotencyKeyLength ||
    value.includes("\u0000")
  ) {
    queryInvalid("idempotencyKey is invalid.");
  }
  return value;
}

function validateFilters(input: DataEventListInput): EventCursorFilter {
  if (input.spaceId !== undefined) validateSlug(input.spaceId, "spaceId");
  if (input.entity !== undefined) {
    if (input.spaceId === undefined) {
      queryInvalid("entity requires spaceId.");
    }
    validateSlug(input.entity, "entity");
  }
  if (input.recordId !== undefined) {
    if (input.entity === undefined) {
      queryInvalid("recordId requires spaceId and entity.");
    }
    validateRecordId(input.recordId);
  }

  return {
    ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
    ...(input.entity === undefined ? {} : { entity: input.entity }),
    ...(input.recordId === undefined ? {} : { recordId: input.recordId }),
  };
}

function validateLimit(value: number | undefined): number {
  const limit = value ?? DATA_PROTOCOL_LIMITS.defaultEventPageSize;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > DATA_PROTOCOL_LIMITS.maxEventPageSize
  ) {
    queryInvalid(
      `Event limit must be an integer in 1..${DATA_PROTOCOL_LIMITS.maxEventPageSize}.`,
    );
  }
  return limit;
}

export class DataProvenance implements DataProvenanceApi {
  private readonly store;

  constructor(database: DataStorageDatabase) {
    this.store = database.provenanceStorage();
    this.store.initialize();
  }

  listEvents(input: DataEventListInput = {}): DataEventPage {
    const filter = validateFilters(input);
    const limit = validateLimit(input.limit);
    const afterSequence =
      input.after === undefined || input.after === null
        ? 0
        : decodeEventCursor(input.after, filter);

    const stored = this.store.listEvents({
      ...filter,
      afterSequence,
      limit: limit + 1,
    });
    const hasMore = stored.length > limit;
    const pageRows = hasMore ? stored.slice(0, limit) : stored;
    const items = pageRows.map(hydrateStoredEvent);
    const last = pageRows.at(-1);

    return {
      items,
      nextCursor:
        hasMore && last !== undefined
          ? encodeEventCursor(last.sequence, filter)
          : null,
      hasMore,
    };
  }

  getReceipt(input: DataReceiptGetInput): DataMutationReceipt {
    try {
      validateReceiptId(input.receiptId);
    } catch {
      queryInvalid("receiptId is invalid.");
    }
    const stored = this.store.getReceipt(input.receiptId);
    if (stored === null) {
      throw new DataProvenanceError(
        "RECEIPT_NOT_FOUND",
        `Receipt '${input.receiptId}' does not exist.`,
      );
    }
    return this.hydrateReceiptWithEvent(stored);
  }

  getReceiptByIdempotencyKey(
    input: DataReceiptByIdempotencyKeyInput,
  ): DataMutationReceipt {
    validateIdempotencyKey(input.idempotencyKey);
    const stored = this.store.getReceiptByIdempotencyKey(input.idempotencyKey);
    if (stored === null) {
      throw new DataProvenanceError(
        "RECEIPT_NOT_FOUND",
        `No receipt exists for idempotency key '${input.idempotencyKey}'.`,
      );
    }
    return this.hydrateReceiptWithEvent(stored);
  }

  listTransactionReceipts(
    input: DataTransactionReceiptsInput,
  ): readonly DataMutationReceipt[] {
    try {
      validateTransactionId(input.transactionId);
    } catch {
      queryInvalid("transactionId is invalid.");
    }

    return this.store
      .listReceiptsByTransactionId(input.transactionId)
      .map((stored) => this.hydrateReceiptWithEvent(stored));
  }

  private hydrateReceiptWithEvent(
    stored: StoredMutationReceipt,
  ): DataMutationReceipt {
    const receipt = hydrateStoredReceipt(stored);
    const linked = this.store.getEvent(receipt.eventId);
    if (linked === null) {
      throw new DataProvenanceError(
        "DATABASE_CORRUPT",
        "Stored receipt references a missing provenance event.",
      );
    }
    const event = hydrateStoredEvent(linked);
    assertReceiptMatchesEvent(receipt, event);
    return receipt;
  }
}
