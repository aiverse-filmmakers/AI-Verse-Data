export type StoredDataEventType =
  | "record.created"
  | "record.updated"
  | "record.deleted"
  | "transaction.committed";

export interface StoredDataEventInput {
  readonly eventId: string;
  readonly eventType: StoredDataEventType;
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
  readonly detailsJson: string;
  readonly eventDigest: string;
}

export interface StoredDataEvent extends StoredDataEventInput {
  readonly sequence: number;
}

export interface StoredMutationReceipt {
  readonly receiptId: string;
  readonly eventId: string;
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
  readonly receiptDigest: string;
}

export interface DataEventListQuery {
  readonly spaceId?: string;
  readonly entity?: string;
  readonly recordId?: string;
  readonly afterSequence: number;
  readonly limit: number;
}

export interface DataProvenanceStorage {
  initialize(): void;
  append(
    event: StoredDataEventInput,
    receipt: StoredMutationReceipt,
  ): StoredDataEvent;
  listEvents(query: DataEventListQuery): readonly StoredDataEvent[];
  getEvent(eventId: string): StoredDataEvent | null;
  getReceipt(receiptId: string): StoredMutationReceipt | null;
  getReceiptByEventId(eventId: string): StoredMutationReceipt | null;
  getReceiptByIdempotencyKey(
    idempotencyKey: string,
  ): StoredMutationReceipt | null;
  listReceiptsByTransactionId(
    transactionId: string,
  ): readonly StoredMutationReceipt[];
}
