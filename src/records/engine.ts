import { randomUUID } from "node:crypto";

import { DataCatalog } from "../catalog/index.js";
import { DataIdempotency } from "../idempotency/index.js";
import type { EntitySchemaDefinition } from "../protocol/index.js";
import { DataProvenance } from "../provenance/index.js";
import {
  createRequestId,
  validateRequestId,
  validateTransactionId,
} from "../provenance/identifiers.js";
import { DataProvenanceWriter } from "../provenance/writer.js";
import type {
  DataRecordStorage,
  DataRelationStorage,
  DataStorageDatabase,
  StoredRecord,
} from "../storage/index.js";
import { DataRecordError } from "./errors.js";
import { hydrateStoredRecord } from "./hydration.js";
import {
  assertRecordMayBeDeleted,
  collectRecordRelations,
} from "./relations.js";
import type {
  DataRecordMutationWithReceipt,
  DataRecordSnapshot,
  DataRecordsApi,
  RecordCreateInput,
  RecordDeleteInput,
  RecordGetInput,
  RecordListInput,
  RecordUpdateInput,
} from "./types.js";
import {
  mergeRecordPatch,
  normalizeRecordData,
  validateExpectedRecordVersion,
  validateRecordActor,
  validateRecordIdempotencyKey,
  validateRecordLimit,
} from "./validation.js";

function recordId(): string {
  return `rec_${randomUUID().replaceAll("-", "")}`;
}

export class DataRecords implements DataRecordsApi {
  private readonly catalog: DataCatalog;
  private readonly store: DataRecordStorage;
  private readonly relations: DataRelationStorage;
  private readonly idempotency: DataIdempotency;
  private readonly provenance: DataProvenance;
  private readonly provenanceWriter: DataProvenanceWriter;

  constructor(private readonly database: DataStorageDatabase) {
    this.catalog = new DataCatalog(database);
    this.store = database.recordStorage();
    this.relations = database.relationStorage();
    this.idempotency = new DataIdempotency(database);
    this.provenance = new DataProvenance(database);
    this.provenanceWriter = new DataProvenanceWriter(database);
    this.store.initialize();
    this.relations.initialize();
  }

  create(input: RecordCreateInput): DataRecordSnapshot {
    const actor = validateRecordActor(input.actor);
    const idempotencyKey = validateRecordIdempotencyKey(input.idempotencyKey);
    const requestId =
      input.requestId === undefined
        ? createRequestId()
        : validateRequestId(input.requestId);
    const transactionId =
      input.transactionId === undefined
        ? undefined
        : validateTransactionId(input.transactionId);
    const request = {
      spaceId: input.spaceId,
      entity: input.entity,
      data: input.data,
      ...(input.clientRef === undefined ? {} : { clientRef: input.clientRef }),
    };

    return this.database.transaction(() => {
      const prepared = this.idempotency.prepare<DataRecordSnapshot>(
        idempotencyKey,
        "data.record.create",
        actor,
        request,
      );
      if (prepared.kind === "replay") return prepared.value;

      const schema = this.catalog.getSchema(input.spaceId, input.entity);
      const data = normalizeRecordData(schema, input.data, {
        applyDefaults: true,
      });
      const now = new Date().toISOString();

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const stored: StoredRecord = {
          spaceId: input.spaceId,
          entity: input.entity,
          recordId: recordId(),
          schemaVersion: schema.schemaVersion,
          version: 1,
          dataJson: JSON.stringify(data),
          createdAt: now,
          updatedAt: now,
          createdActorKind: actor.kind,
          createdActorId: actor.id,
          updatedActorKind: actor.kind,
          updatedActorId: actor.id,
          deletedAt: null,
          deletedReason: null,
          deletedActorKind: null,
          deletedActorId: null,
        };

        const relations = collectRecordRelations(
          this.relations,
          schema,
          stored.recordId,
          data,
        );
        if (!this.store.createRecord(stored)) continue;

        this.relations.replaceSourceRelations(
          stored.spaceId,
          stored.entity,
          stored.recordId,
          relations,
        );

        const snapshot = hydrateStoredRecord(stored, schema);
        this.provenanceWriter.recordMutation({
          operation: "data.record.create",
          requestId,
          ...(transactionId === undefined ? {} : { transactionId }),
          idempotencyKey,
          spaceId: stored.spaceId,
          entity: stored.entity,
          recordId: stored.recordId,
          beforeVersion: null,
          afterVersion: stored.version,
          actor,
          committedAt: now,
          details: {
            schemaVersion: stored.schemaVersion,
          },
        });
        return this.idempotency.complete(
          idempotencyKey,
          "data.record.create",
          prepared.requestFingerprint,
          snapshot,
        );
      }

      throw new DataRecordError(
        "INTERNAL_ERROR",
        "Unable to allocate a unique record identifier after repeated attempts.",
      );
    }, "immediate");
  }

  createWithReceipt(
    input: RecordCreateInput,
  ): DataRecordMutationWithReceipt {
    const record = this.create(input);
    const receipt = this.provenance.getReceiptByIdempotencyKey({
      idempotencyKey: input.idempotencyKey,
    });
    return { record, receipt };
  }

  get(input: RecordGetInput): DataRecordSnapshot {
    this.catalog.getSchema(input.spaceId, input.entity);
    const stored = this.store.getRecord(
      input.spaceId,
      input.entity,
      input.recordId,
      input.includeDeleted ?? false,
    );

    if (stored === null) {
      throw new DataRecordError(
        "RECORD_NOT_FOUND",
        `Record '${input.recordId}' does not exist or is not visible.`,
        {
          spaceId: input.spaceId,
          entity: input.entity,
          recordId: input.recordId,
        },
      );
    }

    const historicalSchema = this.catalog.getSchema(
      stored.spaceId,
      stored.entity,
      stored.schemaVersion,
    );
    return hydrateStoredRecord(stored, historicalSchema);
  }

  list(input: RecordListInput): readonly DataRecordSnapshot[] {
    this.catalog.getSchema(input.spaceId, input.entity);
    const limit = validateRecordLimit(input.limit);
    const rows = this.store.listRecords(
      input.spaceId,
      input.entity,
      limit,
      input.includeDeleted ?? false,
    );
    const schemaCache = new Map<number, EntitySchemaDefinition>();

    return rows.map((stored) => {
      let schema = schemaCache.get(stored.schemaVersion);
      if (schema === undefined) {
        schema = this.catalog.getSchema(
          stored.spaceId,
          stored.entity,
          stored.schemaVersion,
        );
        schemaCache.set(stored.schemaVersion, schema);
      }
      return hydrateStoredRecord(stored, schema);
    });
  }

  update(input: RecordUpdateInput): DataRecordSnapshot {
    const actor = validateRecordActor(input.actor);
    const idempotencyKey = validateRecordIdempotencyKey(input.idempotencyKey);
    const requestId =
      input.requestId === undefined
        ? createRequestId()
        : validateRequestId(input.requestId);
    const transactionId =
      input.transactionId === undefined
        ? undefined
        : validateTransactionId(input.transactionId);
    const expectedVersion = validateExpectedRecordVersion(input.expectedVersion);
    const request = {
      spaceId: input.spaceId,
      entity: input.entity,
      recordId: input.recordId,
      expectedVersion,
      patch: input.patch,
    };

    return this.database.transaction(() => {
      const prepared = this.idempotency.prepare<DataRecordSnapshot>(
        idempotencyKey,
        "data.record.update",
        actor,
        request,
      );
      if (prepared.kind === "replay") return prepared.value;

      const currentSchema = this.catalog.getSchema(input.spaceId, input.entity);
      const stored = this.store.getRecord(
        input.spaceId,
        input.entity,
        input.recordId,
        false,
      );

      if (stored === null) {
        throw new DataRecordError(
          "RECORD_NOT_FOUND",
          `Record '${input.recordId}' does not exist or is deleted.`,
          {
            spaceId: input.spaceId,
            entity: input.entity,
            recordId: input.recordId,
          },
        );
      }

      if (stored.version !== expectedVersion) {
        throw new DataRecordError(
          "RECORD_VERSION_CONFLICT",
          `Expected record version ${expectedVersion}, current version is ${stored.version}.`,
          {
            spaceId: input.spaceId,
            entity: input.entity,
            recordId: input.recordId,
            expectedVersion,
            currentVersion: stored.version,
          },
        );
      }

      const historicalSchema = this.catalog.getSchema(
        stored.spaceId,
        stored.entity,
        stored.schemaVersion,
      );
      const currentSnapshot = hydrateStoredRecord(stored, historicalSchema);
      const merged = mergeRecordPatch(currentSnapshot.data, input.patch);
      const data = normalizeRecordData(currentSchema, merged, {
        applyDefaults: true,
      });
      const relations = collectRecordRelations(
        this.relations,
        currentSchema,
        stored.recordId,
        data,
      );
      const now = new Date().toISOString();

      const updated: StoredRecord = {
        ...stored,
        schemaVersion: currentSchema.schemaVersion,
        version: stored.version + 1,
        dataJson: JSON.stringify(data),
        updatedAt: now,
        updatedActorKind: actor.kind,
        updatedActorId: actor.id,
      };

      if (!this.store.updateRecord(updated, expectedVersion)) {
        const latest = this.store.getRecord(
          input.spaceId,
          input.entity,
          input.recordId,
          true,
        );
        if (latest === null || latest.deletedAt !== null) {
          throw new DataRecordError(
            "RECORD_NOT_FOUND",
            `Record '${input.recordId}' was not available for update.`,
            {
              spaceId: input.spaceId,
              entity: input.entity,
              recordId: input.recordId,
            },
          );
        }
        throw new DataRecordError(
          "RECORD_VERSION_CONFLICT",
          `Expected record version ${expectedVersion}, current version is ${latest.version}.`,
          {
            spaceId: input.spaceId,
            entity: input.entity,
            recordId: input.recordId,
            expectedVersion,
            currentVersion: latest.version,
          },
        );
      }

      this.relations.replaceSourceRelations(
        updated.spaceId,
        updated.entity,
        updated.recordId,
        relations,
      );
      const snapshot = hydrateStoredRecord(updated, currentSchema);
      this.provenanceWriter.recordMutation({
        operation: "data.record.update",
        requestId,
        ...(transactionId === undefined ? {} : { transactionId }),
        idempotencyKey,
        spaceId: updated.spaceId,
        entity: updated.entity,
        recordId: updated.recordId,
        beforeVersion: stored.version,
        afterVersion: updated.version,
        actor,
        committedAt: now,
        details: {
          schemaVersion: updated.schemaVersion,
        },
      });
      return this.idempotency.complete(
        idempotencyKey,
        "data.record.update",
        prepared.requestFingerprint,
        snapshot,
      );
    }, "immediate");
  }

  updateWithReceipt(
    input: RecordUpdateInput,
  ): DataRecordMutationWithReceipt {
    const record = this.update(input);
    const receipt = this.provenance.getReceiptByIdempotencyKey({
      idempotencyKey: input.idempotencyKey,
    });
    return { record, receipt };
  }

  softDelete(input: RecordDeleteInput): DataRecordSnapshot {
    const actor = validateRecordActor(input.actor);
    const idempotencyKey = validateRecordIdempotencyKey(input.idempotencyKey);
    const requestId =
      input.requestId === undefined
        ? createRequestId()
        : validateRequestId(input.requestId);
    const transactionId =
      input.transactionId === undefined
        ? undefined
        : validateTransactionId(input.transactionId);
    const expectedVersion = validateExpectedRecordVersion(input.expectedVersion);
    const request = {
      spaceId: input.spaceId,
      entity: input.entity,
      recordId: input.recordId,
      expectedVersion,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    };

    return this.database.transaction(() => {
      const prepared = this.idempotency.prepare<DataRecordSnapshot>(
        idempotencyKey,
        "data.record.delete",
        actor,
        request,
      );
      if (prepared.kind === "replay") return prepared.value;

      this.catalog.getSchema(input.spaceId, input.entity);
      const stored = this.store.getRecord(
        input.spaceId,
        input.entity,
        input.recordId,
        false,
      );

      if (stored === null) {
        throw new DataRecordError(
          "RECORD_NOT_FOUND",
          `Record '${input.recordId}' does not exist or is already deleted.`,
          {
            spaceId: input.spaceId,
            entity: input.entity,
            recordId: input.recordId,
          },
        );
      }

      if (stored.version !== expectedVersion) {
        throw new DataRecordError(
          "RECORD_VERSION_CONFLICT",
          `Expected record version ${expectedVersion}, current version is ${stored.version}.`,
          {
            spaceId: input.spaceId,
            entity: input.entity,
            recordId: input.recordId,
            expectedVersion,
            currentVersion: stored.version,
          },
        );
      }

      if (
        input.reason !== undefined &&
        (input.reason.length < 1 ||
          input.reason.length > 1024 ||
          input.reason.includes("\u0000"))
      ) {
        throw new DataRecordError(
          "FIELD_INVALID",
          "Delete reason must contain 1..1024 characters and no NUL.",
        );
      }

      assertRecordMayBeDeleted(
        this.relations,
        input.spaceId,
        input.entity,
        input.recordId,
      );

      const now = new Date().toISOString();
      const deleted: StoredRecord = {
        ...stored,
        version: stored.version + 1,
        updatedAt: now,
        updatedActorKind: actor.kind,
        updatedActorId: actor.id,
        deletedAt: now,
        deletedReason: input.reason ?? null,
        deletedActorKind: actor.kind,
        deletedActorId: actor.id,
      };

      if (!this.store.softDeleteRecord(deleted, expectedVersion)) {
        const latest = this.store.getRecord(
          input.spaceId,
          input.entity,
          input.recordId,
          true,
        );
        if (latest === null || latest.deletedAt !== null) {
          throw new DataRecordError(
            "RECORD_NOT_FOUND",
            `Record '${input.recordId}' was not available for deletion.`,
            {
              spaceId: input.spaceId,
              entity: input.entity,
              recordId: input.recordId,
            },
          );
        }
        throw new DataRecordError(
          "RECORD_VERSION_CONFLICT",
          `Expected record version ${expectedVersion}, current version is ${latest.version}.`,
          {
            spaceId: input.spaceId,
            entity: input.entity,
            recordId: input.recordId,
            expectedVersion,
            currentVersion: latest.version,
          },
        );
      }

      this.relations.deleteSourceRelations(
        deleted.spaceId,
        deleted.entity,
        deleted.recordId,
      );

      const historicalSchema = this.catalog.getSchema(
        stored.spaceId,
        stored.entity,
        stored.schemaVersion,
      );
      const snapshot = hydrateStoredRecord(deleted, historicalSchema);
      this.provenanceWriter.recordMutation({
        operation: "data.record.delete",
        requestId,
        ...(transactionId === undefined ? {} : { transactionId }),
        idempotencyKey,
        spaceId: deleted.spaceId,
        entity: deleted.entity,
        recordId: deleted.recordId,
        beforeVersion: stored.version,
        afterVersion: deleted.version,
        actor,
        committedAt: now,
        details: {
          schemaVersion: deleted.schemaVersion,
          reason: deleted.deletedReason,
        },
      });
      return this.idempotency.complete(
        idempotencyKey,
        "data.record.delete",
        prepared.requestFingerprint,
        snapshot,
      );
    }, "immediate");
  }

  softDeleteWithReceipt(
    input: RecordDeleteInput,
  ): DataRecordMutationWithReceipt {
    const record = this.softDelete(input);
    const receipt = this.provenance.getReceiptByIdempotencyKey({
      idempotencyKey: input.idempotencyKey,
    });
    return { record, receipt };
  }
}
