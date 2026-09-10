import type {
  DataActor,
  DataRecord,
  TransactionExecutePayload,
} from "../protocol/index.js";

export interface DataTransactionExecuteInput {
  readonly actor: DataActor;
  readonly payload: TransactionExecutePayload;
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

export interface DataTransactionsApi {
  execute(input: DataTransactionExecuteInput): DataTransactionResult;
}
