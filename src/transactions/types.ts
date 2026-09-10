import type {
  DataActor,
  DataRecord,
  TransactionExecutePayload,
} from "../protocol/index.js";
import type { DataMutationReceipt } from "../provenance/index.js";

export interface DataTransactionExecuteInput {
  readonly actor: DataActor;
  readonly payload: TransactionExecutePayload;
  readonly requestId?: string;
}

export interface DataTransactionOperationResult {
  readonly index: number;
  readonly operation:
    | "data.record.create"
    | "data.record.update"
    | "data.record.delete";
  readonly record: DataRecord;
}

export interface DataTransactionResult {
  readonly operations: readonly DataTransactionOperationResult[];
  readonly clientRefs: Readonly<Record<string, string>>;
}

export interface DataTransactionWithReceipt {
  readonly result: DataTransactionResult;
  readonly receipt: DataMutationReceipt;
}

export interface DataTransactionsApi {
  execute(input: DataTransactionExecuteInput): DataTransactionResult;
  executeWithReceipt(input: DataTransactionExecuteInput): DataTransactionWithReceipt;
}
