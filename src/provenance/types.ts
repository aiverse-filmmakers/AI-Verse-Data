import type {
  DataActor,
  JsonObject,
} from "../protocol/index.js";

export type DataEventType =
  | "record.created"
  | "record.updated"
  | "record.deleted"
  | "transaction.committed";

export type ProvenanceScopeKind =
  | "unbound"
  | "standalone"
  | "workspace";

export interface DataEvent {
  readonly eventId: string;
  readonly eventType: DataEventType;
  readonly operation:
    | "data.record.create"
    | "data.record.update"
    | "data.record.delete"
    | "data.transaction.execute";
  readonly requestId: string;
  readonly transactionId: string | null;
  readonly scopeKind: ProvenanceScopeKind;
  readonly workspaceId: string | null;
  readonly idempotencyKey: string;
  readonly spaceId: string | null;
  readonly entity: string | null;
  readonly recordId: string | null;
  readonly beforeVersion: number | null;
  readonly afterVersion: number | null;
  readonly actor: DataActor;
  readonly committedAt: string;
  readonly details: JsonObject;
}

export interface DataMutationReceipt {
  readonly receiptId: string;
  readonly eventId: string;
  readonly operation: DataEvent["operation"];
  readonly requestId: string;
  readonly transactionId: string | null;
  readonly scopeKind: ProvenanceScopeKind;
  readonly workspaceId: string | null;
  readonly idempotencyKey: string;
  readonly spaceId: string | null;
  readonly entity: string | null;
  readonly recordId: string | null;
  readonly beforeVersion: number | null;
  readonly afterVersion: number | null;
  readonly actor: DataActor;
  readonly committedAt: string;
}

export interface DataMutationProvenance {
  readonly event: DataEvent;
  readonly receipt: DataMutationReceipt;
}

export interface DataEventListInput {
  readonly spaceId?: string;
  readonly entity?: string;
  readonly recordId?: string;
  readonly after?: string | null;
  readonly limit?: number;
}

export interface DataEventPage {
  readonly items: readonly DataEvent[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export interface DataReceiptGetInput {
  readonly receiptId: string;
}

export interface DataReceiptByIdempotencyKeyInput {
  readonly idempotencyKey: string;
}

export interface DataTransactionReceiptsInput {
  readonly transactionId: string;
}

export interface DataProvenanceApi {
  listEvents(input?: DataEventListInput): DataEventPage;
  getReceipt(input: DataReceiptGetInput): DataMutationReceipt;
  getReceiptByIdempotencyKey(
    input: DataReceiptByIdempotencyKeyInput,
  ): DataMutationReceipt;
  listTransactionReceipts(
    input: DataTransactionReceiptsInput,
  ): readonly DataMutationReceipt[];
}
