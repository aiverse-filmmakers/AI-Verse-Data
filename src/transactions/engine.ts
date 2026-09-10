import { DataCatalog } from "../catalog/index.js";
import {
  DATA_PROTOCOL_LIMITS,
  DataProtocolValidationError,
  type EntitySchemaDefinition,
  type JsonObject,
  type JsonValue,
  type RecordCreatePayload,
  type RecordUpdatePayload,
  validateTransactionExecutePayload,
} from "../protocol/index.js";
import { DataRecords } from "../records/index.js";
import type { DataStorageDatabase } from "../storage/index.js";
import { DataTransactionError } from "./errors.js";
import type {
  DataTransactionExecuteInput,
  DataTransactionOperationResult,
  DataTransactionResult,
  DataTransactionsApi,
} from "./types.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveReferenceValue(
  value: JsonValue,
  field: string,
  schema: EntitySchemaDefinition,
  clientRefs: ReadonlyMap<string, string>,
): JsonValue {
  const definition = schema.fields[field];
  if (definition?.type !== "reference") return value;
  if (!isPlainObject(value) || Object.keys(value).length !== 1 || !("$ref" in value)) {
    return value;
  }

  const clientRef = value.$ref;
  if (
    typeof clientRef !== "string" ||
    clientRef.length < 1 ||
    clientRef.length > DATA_PROTOCOL_LIMITS.maxIdLength
  ) {
    throw new DataTransactionError(
      "REFERENCE_INVALID",
      `Transaction reference marker for field '${field}' is invalid.`,
      { field },
    );
  }

  const recordId = clientRefs.get(clientRef);
  if (recordId === undefined) {
    throw new DataTransactionError(
      "REFERENCE_INVALID",
      `Transaction reference '${clientRef}' is unresolved. Only earlier created clientRef values may be referenced.`,
      { field, clientRef },
    );
  }

  return recordId;
}

function resolveData(
  data: JsonObject,
  schema: EntitySchemaDefinition,
  clientRefs: ReadonlyMap<string, string>,
): JsonObject {
  const output: Record<string, JsonValue> = {};
  for (const [field, value] of Object.entries(data)) {
    output[field] = resolveReferenceValue(value, field, schema, clientRefs);
  }
  return output;
}

export class DataTransactions implements DataTransactionsApi {
  private readonly records: DataRecords;
  private readonly catalog: DataCatalog;

  constructor(private readonly database: DataStorageDatabase) {
    this.records = new DataRecords(database);
    this.catalog = new DataCatalog(database);
  }

  execute(input: DataTransactionExecuteInput): DataTransactionResult {
    let payload;
    try {
      payload = validateTransactionExecutePayload(input.payload, "$transaction");
    } catch (error) {
      if (error instanceof DataProtocolValidationError) {
        throw new DataTransactionError(
          "TRANSACTION_INVALID",
          error.message,
          undefined,
          error,
        );
      }
      throw error;
    }

    if (payload.operations.length > DATA_PROTOCOL_LIMITS.maxTransactionOperations) {
      throw new DataTransactionError(
        "QUERY_LIMIT_EXCEEDED",
        `Transaction cannot exceed ${DATA_PROTOCOL_LIMITS.maxTransactionOperations} operations.`,
      );
    }

    return this.database.transaction(() => {
      const clientRefs = new Map<string, string>();
      const results: DataTransactionOperationResult[] = [];

      for (let index = 0; index < payload.operations.length; index += 1) {
        const item = payload.operations[index]!;
        if (item.operation === "data.record.create") {
          const create = item.payload as RecordCreatePayload;
          const schema = this.catalog.getSchema(create.spaceId, create.entity);
          const data = resolveData(create.data, schema, clientRefs);

          if (create.clientRef !== undefined && clientRefs.has(create.clientRef)) {
            throw new DataTransactionError(
              "TRANSACTION_INVALID",
              `Duplicate transaction clientRef '${create.clientRef}'.`,
              { clientRef: create.clientRef, index },
            );
          }

          const record = this.records.create({
            spaceId: create.spaceId,
            entity: create.entity,
            data,
            actor: input.actor,
          });

          if (create.clientRef !== undefined) {
            clientRefs.set(create.clientRef, record.recordId);
          }

          results.push({ index, operation: item.operation, record });
          continue;
        }

        if (item.operation === "data.record.update") {
          const update = item.payload as RecordUpdatePayload;
          const schema = this.catalog.getSchema(update.spaceId, update.entity);
          const patch = resolveData(update.patch, schema, clientRefs);
          const record = this.records.update({
            spaceId: update.spaceId,
            entity: update.entity,
            recordId: update.recordId,
            expectedVersion: update.expectedVersion,
            patch,
            actor: input.actor,
          });
          results.push({ index, operation: item.operation, record });
          continue;
        }

        const record = this.records.softDelete({
          spaceId: item.payload.spaceId,
          entity: item.payload.entity,
          recordId: item.payload.recordId,
          expectedVersion: item.payload.expectedVersion,
          actor: input.actor,
          ...(item.payload.reason === undefined ? {} : { reason: item.payload.reason }),
        });
        results.push({ index, operation: item.operation, record });
      }

      return {
        operations: results,
        clientRefs: Object.fromEntries(clientRefs),
      };
    }, "immediate");
  }
}
