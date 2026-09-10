import type {
  BulkMutationOperation,
  DataActor,
} from "../protocol/index.js";
import type { DataMutationReceipt } from "../provenance/index.js";
import type { DataTransactionResult } from "../transactions/index.js";

export interface DataBulkPreviewInput {
  readonly actor: DataActor;
  readonly operations: readonly BulkMutationOperation[];
}

export interface DataBulkPreviewItem {
  readonly index: number;
  readonly operation:
    | "data.record.create"
    | "data.record.update"
    | "data.record.delete";
  readonly spaceId: string;
  readonly entity: string;
  readonly recordId: string | null;
  readonly schemaVersion: number;
  readonly beforeVersion: number | null;
  readonly afterVersion: number;
  readonly wouldBeDeleted: boolean;
}

export interface DataBulkPreview {
  readonly previewDigest: string;
  readonly operationCount: number;
  readonly requestBytes: number;
  readonly atomicity: "all-or-nothing";
  readonly items: readonly DataBulkPreviewItem[];
}

export interface DataBulkExecuteInput {
  readonly actor: DataActor;
  readonly requestId?: string;
  readonly idempotencyKey: string;
  readonly expectedPreviewDigest: string;
  readonly operations: readonly BulkMutationOperation[];
}

export interface DataBulkExecuteResult {
  readonly previewDigest: string;
  readonly atomicity: "all-or-nothing";
  readonly transaction: DataTransactionResult;
  readonly transactionReceipt: DataMutationReceipt;
}

export interface DataBulkApi {
  preview(input: DataBulkPreviewInput): DataBulkPreview;
  execute(input: DataBulkExecuteInput): DataBulkExecuteResult;
}
