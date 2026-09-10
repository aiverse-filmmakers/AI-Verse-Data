import { createHash, randomUUID } from "node:crypto";

import {
  canonicalResultJson,
  DataIdempotency,
} from "../idempotency/index.js";
import {
  DATA_PROTOCOL_LIMITS,
  DataProtocolValidationError,
  type BulkExecutePayload,
  type BulkMutationOperation,
  type BulkPreviewPayload,
  validateBulkExecutePayload,
  validateBulkPreviewPayload,
} from "../protocol/index.js";
import { DataProvenance } from "../provenance/index.js";
import {
  createRequestId,
  validateRequestId,
} from "../provenance/identifiers.js";
import { validateRecordActor } from "../records/validation.js";
import type { DataStorageDatabase } from "../storage/index.js";
import {
  DataTransactions,
  type DataTransactionResult,
  type DataTransactionWithReceipt,
} from "../transactions/index.js";
import { DataBulkError } from "./errors.js";
import type {
  DataBulkApi,
  DataBulkExecuteInput,
  DataBulkExecuteResult,
  DataBulkPreview,
  DataBulkPreviewInput,
  DataBulkPreviewItem,
} from "./types.js";

const BULK_PREVIEW_VERSION = 1 as const;

class PreviewRollback extends Error {
  constructor(readonly transaction: DataTransactionWithReceipt) {
    super("AI-Verse Data bulk preview rollback");
    this.name = "PreviewRollback";
  }
}

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(canonicalResultJson(value), "utf8")
    .digest("hex");
}

function derivedTransactionKey(idempotencyKey: string): string {
  return `bulk-txn:${sha256(idempotencyKey).slice(0, 48)}`;
}

function previewOuterKey(): string {
  return `bulk-preview:${randomUUID().replaceAll("-", "")}`;
}

function mapValidationError(error: DataProtocolValidationError): DataBulkError {
  const limited =
    /exceeds|must contain 1\.\./i.test(error.message);
  return new DataBulkError(
    limited ? "BULK_LIMIT_EXCEEDED" : "BULK_INVALID",
    error.message,
    undefined,
    error,
  );
}

function requestBytes(operations: readonly BulkMutationOperation[]): number {
  return Buffer.byteLength(
    JSON.stringify({ operations }),
    "utf8",
  );
}

function operationTarget(
  operation: BulkMutationOperation,
): { readonly spaceId: string; readonly entity: string; readonly recordId: string | null } {
  return {
    spaceId: operation.payload.spaceId,
    entity: operation.payload.entity,
    recordId:
      operation.operation === "data.record.create"
        ? null
        : operation.payload.recordId,
  };
}

function previewItems(
  operations: readonly BulkMutationOperation[],
  result: DataTransactionResult,
): readonly DataBulkPreviewItem[] {
  if (operations.length !== result.operations.length) {
    throw new DataBulkError(
      "DATABASE_CORRUPT",
      "Bulk preview transaction result count does not match the requested operation count.",
    );
  }

  return result.operations.map((entry, index) => {
    const source = operations[index];
    if (
      source === undefined ||
      source.operation !== entry.operation ||
      entry.index !== index
    ) {
      throw new DataBulkError(
        "DATABASE_CORRUPT",
        "Bulk preview transaction result ordering does not match the requested operations.",
      );
    }

    const target = operationTarget(source);
    const beforeVersion =
      source.operation === "data.record.create"
        ? null
        : source.payload.expectedVersion;

    return {
      index,
      operation: entry.operation,
      spaceId: target.spaceId,
      entity: target.entity,
      recordId: target.recordId,
      schemaVersion: entry.record.schemaVersion,
      beforeVersion,
      afterVersion: entry.record.version,
      wouldBeDeleted: entry.record.deletedAt !== null,
    };
  });
}

function previewDigest(
  actor: ReturnType<typeof validateRecordActor>,
  operations: readonly BulkMutationOperation[],
  items: readonly DataBulkPreviewItem[],
): string {
  return sha256({
    version: BULK_PREVIEW_VERSION,
    actor,
    operations,
    items,
    atomicity: "all-or-nothing",
  });
}

function assertBulkKeySeparation(
  bulkKey: string,
  transactionKey: string,
  operations: readonly BulkMutationOperation[],
): void {
  const nested = new Set<string>();
  for (let index = 0; index < operations.length; index += 1) {
    const key = operations[index]!.payload.idempotencyKey;
    if (key === bulkKey) {
      throw new DataBulkError(
        "BULK_INVALID",
        "Bulk idempotency key must differ from every nested mutation key.",
        { index },
      );
    }
    if (key === transactionKey) {
      throw new DataBulkError(
        "BULK_INVALID",
        "Nested mutation key collides with the internal bulk transaction key.",
        { index },
      );
    }
    if (nested.has(key)) {
      throw new DataBulkError(
        "BULK_INVALID",
        `Duplicate nested bulk idempotency key '${key}'.`,
        { index },
      );
    }
    nested.add(key);
  }
}

export class DataBulk implements DataBulkApi {
  private readonly transactions: DataTransactions;
  private readonly idempotency: DataIdempotency;
  private readonly provenance: DataProvenance;

  constructor(private readonly database: DataStorageDatabase) {
    this.transactions = new DataTransactions(database);
    this.idempotency = new DataIdempotency(database);
    this.provenance = new DataProvenance(database);
  }

  preview(input: DataBulkPreviewInput): DataBulkPreview {
    const actor = validateRecordActor(input.actor);
    const payload: BulkPreviewPayload = {
      operations: input.operations,
    };

    try {
      validateBulkPreviewPayload(payload);
    } catch (error) {
      if (error instanceof DataProtocolValidationError) {
        throw mapValidationError(error);
      }
      throw error;
    }

    const bytes = requestBytes(input.operations);
    if (bytes > DATA_PROTOCOL_LIMITS.maxBulkBytes) {
      throw new DataBulkError(
        "BULK_LIMIT_EXCEEDED",
        `Bulk request exceeds ${DATA_PROTOCOL_LIMITS.maxBulkBytes} bytes.`,
        { bytes, maxBytes: DATA_PROTOCOL_LIMITS.maxBulkBytes },
      );
    }

    let transaction: DataTransactionWithReceipt | null = null;

    try {
      this.database.transaction(() => {
        const simulated = this.transactions.executeWithReceipt({
          actor,
          requestId: createRequestId(),
          payload: {
            idempotencyKey: previewOuterKey(),
            operations: input.operations,
          },
        });
        throw new PreviewRollback(simulated);
      }, "immediate");
    } catch (error) {
      if (error instanceof PreviewRollback) {
        transaction = error.transaction;
      } else {
        throw error;
      }
    }

    if (transaction === null) {
      throw new DataBulkError(
        "DATABASE_CORRUPT",
        "Bulk preview did not produce a rollback result.",
      );
    }

    const items = previewItems(input.operations, transaction.result);

    return {
      previewDigest: previewDigest(actor, input.operations, items),
      operationCount: items.length,
      requestBytes: bytes,
      atomicity: "all-or-nothing",
      items,
    };
  }

  execute(input: DataBulkExecuteInput): DataBulkExecuteResult {
    const actor = validateRecordActor(input.actor);
    const payload: BulkExecutePayload = {
      idempotencyKey: input.idempotencyKey,
      expectedPreviewDigest: input.expectedPreviewDigest,
      operations: input.operations,
    };

    try {
      validateBulkExecutePayload(payload);
    } catch (error) {
      if (error instanceof DataProtocolValidationError) {
        throw mapValidationError(error);
      }
      throw error;
    }

    const transactionKey = derivedTransactionKey(input.idempotencyKey);
    assertBulkKeySeparation(
      input.idempotencyKey,
      transactionKey,
      input.operations,
    );

    const semanticRequest = {
      expectedPreviewDigest: input.expectedPreviewDigest,
      operations: input.operations,
    };

    const first = this.idempotency.prepare<DataBulkExecuteResult>(
      input.idempotencyKey,
      "data.bulk.execute",
      actor,
      semanticRequest,
    );
    if (first.kind === "replay") {
      return this.verifyReplay(first.value, actor, transactionKey, input.operations);
    }

    const preview = this.preview({
      actor,
      operations: input.operations,
    });
    if (preview.previewDigest !== input.expectedPreviewDigest) {
      throw new DataBulkError(
        "BULK_PREVIEW_STALE",
        "Bulk preview digest does not match the current validated operation set/state.",
        {
          expectedPreviewDigest: input.expectedPreviewDigest,
          currentPreviewDigest: preview.previewDigest,
        },
      );
    }

    const requestId =
      input.requestId === undefined
        ? createRequestId()
        : validateRequestId(input.requestId);

    return this.database.transaction(() => {
      const prepared = this.idempotency.prepare<DataBulkExecuteResult>(
        input.idempotencyKey,
        "data.bulk.execute",
        actor,
        semanticRequest,
      );
      if (prepared.kind === "replay") {
        return this.verifyReplay(
          prepared.value,
          actor,
          transactionKey,
          input.operations,
        );
      }

      const committed = this.transactions.executeWithReceipt({
        actor,
        requestId,
        payload: {
          idempotencyKey: transactionKey,
          operations: input.operations,
        },
      });

      const result: DataBulkExecuteResult = {
        previewDigest: input.expectedPreviewDigest,
        atomicity: "all-or-nothing",
        transaction: committed.result,
        transactionReceipt: committed.receipt,
      };

      return this.idempotency.complete(
        input.idempotencyKey,
        "data.bulk.execute",
        prepared.requestFingerprint,
        result,
      );
    }, "immediate");
  }

  private verifyReplay(
    stored: DataBulkExecuteResult,
    actor: ReturnType<typeof validateRecordActor>,
    transactionKey: string,
    operations: readonly BulkMutationOperation[],
  ): DataBulkExecuteResult {
    const transactionReplay = this.idempotency.prepare<DataTransactionResult>(
      transactionKey,
      "data.transaction.execute",
      actor,
      { operations },
    );
    if (transactionReplay.kind !== "replay") {
      throw new DataBulkError(
        "DATABASE_CORRUPT",
        "Bulk replay is missing its underlying committed transaction idempotency result.",
      );
    }

    if (
      canonicalResultJson(transactionReplay.value) !==
      canonicalResultJson(stored.transaction)
    ) {
      throw new DataBulkError(
        "DATABASE_CORRUPT",
        "Bulk replay result does not match its underlying transaction result.",
      );
    }

    const receipt = this.provenance.getReceipt({
      receiptId: stored.transactionReceipt.receiptId,
    });
    if (
      canonicalResultJson(receipt) !==
      canonicalResultJson(stored.transactionReceipt)
    ) {
      throw new DataBulkError(
        "DATABASE_CORRUPT",
        "Bulk replay transaction receipt does not match durable provenance.",
      );
    }

    return stored;
  }
}
