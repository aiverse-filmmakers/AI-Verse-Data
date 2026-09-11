import { createHash, randomUUID } from "node:crypto";

import {
  canonicalSchemaJson,
  cloneSchemaDefinition,
  schemaDigest,
} from "../catalog/canonical.js";
import { DataCatalog, DataCatalogError } from "../catalog/index.js";
import { DataIdempotency, canonicalResultJson } from "../idempotency/index.js";
import {
  DATA_PROTOCOL_LIMITS,
  DataProtocolValidationError,
  type DataActor,
  type EntitySchemaDefinition,
  type FieldDefinition,
  type JsonObject,
  type JsonValue,
  type SchemaChange,
  type SchemaMigrationBackfill,
  type SchemaMigrationExecutePayload,
  type SchemaMigrationPreviewPayload,
  validateEntitySchemaDefinition,
  validateSchemaMigrationExecutePayload,
  validateSchemaMigrationPreviewPayload,
} from "../protocol/index.js";
import { DataProvenance } from "../provenance/index.js";
import {
  createRequestId,
  createTransactionId,
  validateRequestId,
} from "../provenance/identifiers.js";
import { DataProvenanceWriter } from "../provenance/writer.js";
import { hydrateStoredRecord } from "../records/hydration.js";
import { collectRecordRelations } from "../records/relations.js";
import {
  normalizeRecordData,
  validateRecordActor,
} from "../records/validation.js";
import { DataRecordError } from "../records/errors.js";
import type {
  DataRelationStorage,
  DataStorageDatabase,
  StoredEntitySchemaVersion,
  StoredRecord,
  StoredRecordRelation,
} from "../storage/index.js";
import { DataSchemaMigrationError } from "./errors.js";
import type {
  DataSchemaMigrationsApi,
  SchemaMigrationExecuteInput,
  SchemaMigrationPreview,
  SchemaMigrationPreviewInput,
  SchemaMigrationResult,
  SchemaMigrationWithReceipt,
} from "./types.js";

const PAGE_SIZE = 200;
const PREVIEW_VERSION = 1 as const;

interface PlannedRecord {
  readonly before: StoredRecord;
  readonly afterData: JsonObject;
  readonly afterRelations: readonly StoredRecordRelation[];
  readonly beforeDataDigest: string;
  readonly afterDataDigest: string;
  readonly relationDigest: string;
}

interface SchemaMigrationPlan {
  readonly payload: SchemaMigrationPreviewPayload;
  readonly actor: DataActor;
  readonly currentDefinition: EntitySchemaDefinition;
  readonly proposedDefinition: EntitySchemaDefinition;
  readonly fromSchemaVersion: number;
  readonly toSchemaVersion: number;
  readonly fromSchemaDigest: string;
  readonly toSchemaDigest: string;
  readonly activeRecordCount: number;
  readonly scannedRecordBytes: number;
  readonly rewrittenRecordBytes: number;
  readonly destructive: boolean;
  readonly approvalRequired: boolean;
  readonly records: readonly PlannedRecord[];
  readonly previewDigest: string;
}

function own(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function schemaSnapshotDefinition(
  schema: ReturnType<DataCatalog["getSchema"]>,
): EntitySchemaDefinition {
  return cloneSchemaDefinition({
    spaceId: schema.spaceId,
    entity: schema.entity,
    name: schema.name,
    fields: schema.fields,
    ...(schema.description === undefined
      ? {}
      : { description: schema.description }),
    ...(schema.allowUnknownFields === undefined
      ? {}
      : { allowUnknownFields: schema.allowUnknownFields }),
  });
}

function migrationInvalid(message: string, cause?: unknown): never {
  throw new DataSchemaMigrationError(
    "SCHEMA_MIGRATION_INVALID",
    message,
    undefined,
    cause,
  );
}

function validatePreviewInput(
  input: SchemaMigrationPreviewInput,
): {
  readonly actor: DataActor;
  readonly payload: SchemaMigrationPreviewPayload;
} {
  try {
    return {
      actor: validateRecordActor(input.actor),
      payload: validateSchemaMigrationPreviewPayload(
        input.payload,
        "$schemaMigrationPreview",
      ),
    };
  } catch (error) {
    if (
      error instanceof DataProtocolValidationError ||
      error instanceof DataRecordError
    ) {
      migrationInvalid(error.message, error);
    }
    throw error;
  }
}

function validateExecuteInput(
  input: SchemaMigrationExecuteInput,
): {
  readonly actor: DataActor;
  readonly payload: SchemaMigrationExecutePayload;
  readonly requestId: string;
} {
  try {
    return {
      actor: validateRecordActor(input.actor),
      payload: validateSchemaMigrationExecutePayload(
        input.payload,
        "$schemaMigrationExecute",
      ),
      requestId:
        input.requestId === undefined
          ? createRequestId()
          : validateRequestId(input.requestId),
    };
  } catch (error) {
    if (
      error instanceof DataProtocolValidationError ||
      error instanceof DataRecordError
    ) {
      migrationInvalid(error.message, error);
    }
    throw error;
  }
}

function applySchemaChanges(
  current: EntitySchemaDefinition,
  changes: readonly SchemaChange[],
): EntitySchemaDefinition {
  let name = current.name;
  let description = current.description;
  const fields: Record<string, FieldDefinition> = {
    ...current.fields,
  };

  for (const change of changes) {
    switch (change.op) {
      case "add_field":
        if (own(fields, change.field)) {
          migrationInvalid(
            `Field '${change.field}' already exists and cannot be added by migration.`,
          );
        }
        fields[change.field] = change.definition;
        break;

      case "remove_field":
        if (!own(fields, change.field)) {
          migrationInvalid(
            `Field '${change.field}' does not exist and cannot be removed.`,
          );
        }
        delete fields[change.field];
        break;

      case "replace_field":
        if (!own(fields, change.field)) {
          migrationInvalid(
            `Field '${change.field}' does not exist and cannot be replaced.`,
          );
        }
        fields[change.field] = change.definition;
        break;

      case "rename_field": {
        const existing = fields[change.field];
        if (existing === undefined) {
          migrationInvalid(
            `Field '${change.field}' does not exist and cannot be renamed.`,
          );
        }
        if (own(fields, change.newField)) {
          migrationInvalid(
            `Field '${change.newField}' already exists and cannot receive a rename.`,
          );
        }
        fields[change.newField] = existing;
        delete fields[change.field];
        break;
      }

      case "set_name":
        name = change.name;
        break;

      case "set_description":
        description = change.description;
        break;
    }
  }

  const proposed: EntitySchemaDefinition = {
    spaceId: current.spaceId,
    entity: current.entity,
    name,
    fields,
    ...(description === undefined ? {} : { description }),
    ...(current.allowUnknownFields === undefined
      ? {}
      : { allowUnknownFields: current.allowUnknownFields }),
  };

  try {
    return cloneSchemaDefinition(
      validateEntitySchemaDefinition(proposed, "$proposedSchema"),
    );
  } catch (error) {
    if (error instanceof DataProtocolValidationError) {
      migrationInvalid(error.message, error);
    }
    throw error;
  }
}

function validateBackfillTargets(
  proposed: EntitySchemaDefinition,
  backfills: readonly SchemaMigrationBackfill[],
): void {
  for (const backfill of backfills) {
    if (!own(proposed.fields, backfill.field)) {
      migrationInvalid(
        `Backfill field '${backfill.field}' does not exist in the proposed schema.`,
      );
    }
  }
}

function isDestructive(
  changes: readonly SchemaChange[],
  backfills: readonly SchemaMigrationBackfill[],
): boolean {
  return (
    changes.some(
      (change) =>
        change.op === "remove_field" ||
        change.op === "replace_field" ||
        change.op === "rename_field",
    ) || backfills.some((backfill) => backfill.mode === "set")
  );
}

function hasFieldMigrationWork(
  changes: readonly SchemaChange[],
  backfills: readonly SchemaMigrationBackfill[],
): boolean {
  return (
    backfills.length > 0 ||
    changes.some(
      (change) =>
        change.op === "add_field" ||
        change.op === "remove_field" ||
        change.op === "replace_field" ||
        change.op === "rename_field",
    )
  );
}

function transformRecordData(
  source: JsonObject,
  changes: readonly SchemaChange[],
  backfills: readonly SchemaMigrationBackfill[],
): JsonObject {
  const output = cloneJsonObject(source) as Record<string, JsonValue>;

  for (const change of changes) {
    switch (change.op) {
      case "remove_field":
        delete output[change.field];
        break;

      case "rename_field":
        if (own(output, change.field)) {
          if (own(output, change.newField)) {
            migrationInvalid(
              `Record contains both '${change.field}' and '${change.newField}', so rename would be ambiguous.`,
            );
          }
          output[change.newField] = output[change.field]!;
          delete output[change.field];
        }
        break;

      case "add_field":
      case "replace_field":
      case "set_name":
      case "set_description":
        break;
    }
  }

  for (const backfill of backfills) {
    if (backfill.mode === "set" || !own(output, backfill.field)) {
      output[backfill.field] = JSON.parse(
        JSON.stringify(backfill.value),
      ) as JsonValue;
    }
  }

  return output;
}

function relationDigest(
  relations: readonly StoredRecordRelation[],
): string {
  const ordered = [...relations].sort((left, right) =>
    canonicalResultJson(left).localeCompare(canonicalResultJson(right)),
  );
  return sha256(canonicalResultJson(ordered));
}

function previewFromPlan(plan: SchemaMigrationPlan): SchemaMigrationPreview {
  return {
    spaceId: plan.payload.spaceId,
    entity: plan.payload.entity,
    fromSchemaVersion: plan.fromSchemaVersion,
    toSchemaVersion: plan.toSchemaVersion,
    fromSchemaDigest: plan.fromSchemaDigest,
    toSchemaDigest: plan.toSchemaDigest,
    activeRecordCount: plan.activeRecordCount,
    rewrittenRecordCount: plan.records.length,
    scannedRecordBytes: plan.scannedRecordBytes,
    rewrittenRecordBytes: plan.rewrittenRecordBytes,
    destructive: plan.destructive,
    approvalRequired: plan.approvalRequired,
    owner: { ...plan.payload.owner },
    changeCount: plan.payload.changes.length,
    backfillCount: plan.payload.backfills?.length ?? 0,
    previewDigest: plan.previewDigest,
  };
}

function migrationId(): string {
  return `smig_${randomUUID().replaceAll("-", "")}`;
}

function childIdempotencyKey(
  migrationIdValue: string,
  recordId: string,
): string {
  return `schema-migration-record:${sha256(
    `${migrationIdValue}\u0000${recordId}`,
  ).slice(0, 48)}`;
}

export class DataSchemaMigrations implements DataSchemaMigrationsApi {
  private readonly catalog: DataCatalog;
  private readonly idempotency: DataIdempotency;
  private readonly provenance: DataProvenance;
  private readonly provenanceWriter: DataProvenanceWriter;
  private readonly relationStore: DataRelationStorage;

  constructor(private readonly database: DataStorageDatabase) {
    this.catalog = new DataCatalog(database);
    this.idempotency = new DataIdempotency(database);
    this.provenance = new DataProvenance(database);
    this.provenanceWriter = new DataProvenanceWriter(database);
    this.relationStore = database.relationStorage();
    database.recordStorage().initialize();
    this.relationStore.initialize();
  }

  preview(input: SchemaMigrationPreviewInput): SchemaMigrationPreview {
    const validated = validatePreviewInput(input);
    return this.database.transaction(
      () => previewFromPlan(this.buildPlan(validated.actor, validated.payload)),
      "deferred",
    );
  }

  execute(input: SchemaMigrationExecuteInput): SchemaMigrationResult {
    const validated = validateExecuteInput(input);
    const actor = validated.actor;
    const payload = validated.payload;
    const requestId = validated.requestId;

    return this.database.transaction(() => {
      const prepared = this.idempotency.prepare<SchemaMigrationResult>(
        payload.idempotencyKey,
        "data.transaction.execute",
        actor,
        {
          kind: "schema_migration",
          requestedOperation: "data.schema.migration.execute",
          payload,
        },
      );
      if (prepared.kind === "replay") return prepared.value;

      const plan = this.buildPlan(actor, payload);
      if (plan.previewDigest !== payload.expectedPreviewDigest) {
        throw new DataSchemaMigrationError(
          "SCHEMA_MIGRATION_STALE",
          "Schema migration preview is stale; review the migration again against current canonical state.",
          {
            expectedPreviewDigest: payload.expectedPreviewDigest,
            currentPreviewDigest: plan.previewDigest,
          },
        );
      }

      if (plan.approvalRequired && payload.approval === undefined) {
        throw new DataSchemaMigrationError(
          "APPROVAL_REQUIRED",
          "Destructive schema migration requires explicit approval metadata.",
        );
      }

      const migrationIdValue = migrationId();
      const transactionId = createTransactionId();
      const committedAt = new Date().toISOString();
      const catalogStore = this.database.catalogStorage();
      const recordStore = this.database.recordStorage();

      const nextSchema: StoredEntitySchemaVersion = {
        spaceId: payload.spaceId,
        entity: payload.entity,
        schemaVersion: plan.toSchemaVersion,
        schemaDigest: plan.toSchemaDigest,
        definitionJson: canonicalSchemaJson(plan.proposedDefinition),
        createdAt: committedAt,
      };

      const schemaResult = catalogStore.updateSchema(
        plan.fromSchemaVersion,
        nextSchema,
      );
      if (schemaResult.status === "entity_missing") {
        throw new DataCatalogError(
          "ENTITY_NOT_FOUND",
          `Entity '${payload.entity}' disappeared before migration committed.`,
          { spaceId: payload.spaceId, entity: payload.entity },
        );
      }
      if (schemaResult.status === "version_conflict") {
        throw new DataCatalogError(
          "SCHEMA_VERSION_CONFLICT",
          `Schema changed concurrently; current version is ${schemaResult.currentVersion}.`,
          {
            expectedSchemaVersion: plan.fromSchemaVersion,
            currentSchemaVersion: schemaResult.currentVersion,
          },
        );
      }

      const childEventIds: string[] = [];
      const childReceiptIds: string[] = [];

      for (const planned of plan.records) {
        const childKey = childIdempotencyKey(
          migrationIdValue,
          planned.before.recordId,
        );
        const childRequest = {
          kind: "schema_migration_record_rewrite",
          migrationId: migrationIdValue,
          spaceId: payload.spaceId,
          entity: payload.entity,
          recordId: planned.before.recordId,
          expectedVersion: planned.before.version,
          fromSchemaVersion: planned.before.schemaVersion,
          toSchemaVersion: plan.toSchemaVersion,
          beforeDataDigest: planned.beforeDataDigest,
          afterDataDigest: planned.afterDataDigest,
        };
        const childPrepared = this.idempotency.prepare<unknown>(
          childKey,
          "data.record.update",
          actor,
          childRequest,
        );
        if (childPrepared.kind === "replay") {
          throw new DataSchemaMigrationError(
            "DATABASE_CORRUPT",
            "Internal schema-migration record idempotency key unexpectedly already exists.",
            { recordId: planned.before.recordId },
          );
        }

        const updated: StoredRecord = {
          ...planned.before,
          schemaVersion: plan.toSchemaVersion,
          version: planned.before.version + 1,
          dataJson: JSON.stringify(planned.afterData),
          updatedAt: committedAt,
          updatedActorKind: actor.kind,
          updatedActorId: actor.id,
        };

        if (!recordStore.updateRecord(updated, planned.before.version)) {
          throw new DataSchemaMigrationError(
            "SCHEMA_MIGRATION_STALE",
            "A record changed while the schema migration was being committed.",
            {
              recordId: planned.before.recordId,
              expectedVersion: planned.before.version,
            },
          );
        }

        this.relationStore.replaceSourceRelations(
          updated.spaceId,
          updated.entity,
          updated.recordId,
          planned.afterRelations,
        );

        const snapshot = hydrateStoredRecord(
          updated,
          plan.proposedDefinition,
        );
        this.provenanceWriter.recordMutation({
          operation: "data.record.update",
          requestId,
          transactionId,
          idempotencyKey: childKey,
          spaceId: updated.spaceId,
          entity: updated.entity,
          recordId: updated.recordId,
          beforeVersion: planned.before.version,
          afterVersion: updated.version,
          actor,
          committedAt,
          details: {
            schemaMigration: true,
            schemaMigrationId: migrationIdValue,
            schemaMigrationOwner: { ...payload.owner },
            fromSchemaVersion: planned.before.schemaVersion,
            toSchemaVersion: plan.toSchemaVersion,
            fromSchemaDigest: plan.fromSchemaDigest,
            toSchemaDigest: plan.toSchemaDigest,
            previewDigest: plan.previewDigest,
          },
        });
        this.idempotency.complete(
          childKey,
          "data.record.update",
          childPrepared.requestFingerprint,
          snapshot,
        );

        const childReceipt = this.provenance.getReceiptByIdempotencyKey({
          idempotencyKey: childKey,
        });
        childEventIds.push(childReceipt.eventId);
        childReceiptIds.push(childReceipt.receiptId);
      }

      const result: SchemaMigrationResult = {
        ...previewFromPlan(plan),
        migrationId: migrationIdValue,
        completedAt: committedAt,
        executor: { ...actor },
        approval:
          payload.approval === undefined
            ? null
            : {
                ...payload.approval,
                approvedBy: { ...payload.approval.approvedBy },
              },
      };

      this.provenanceWriter.transactionCommitted({
        requestId,
        transactionId,
        idempotencyKey: payload.idempotencyKey,
        actor,
        committedAt,
        childEventIds,
        childReceiptIds,
        operationCount: plan.records.length,
        details: {
          kind: "schema_migration",
          requestedOperation: "data.schema.migration.execute",
          schemaMigrationId: migrationIdValue,
          spaceId: payload.spaceId,
          entity: payload.entity,
          fromSchemaVersion: plan.fromSchemaVersion,
          toSchemaVersion: plan.toSchemaVersion,
          fromSchemaDigest: plan.fromSchemaDigest,
          toSchemaDigest: plan.toSchemaDigest,
          schemaMigrationOwner: { ...payload.owner },
          previewDigest: plan.previewDigest,
          destructive: plan.destructive,
          approvalRequired: plan.approvalRequired,
          ...(payload.reason === undefined
            ? {}
            : { reason: payload.reason }),
          ...(payload.approval === undefined
            ? {}
            : {
                approvalRef: payload.approval.approvalRef,
                approvedBy: { ...payload.approval.approvedBy },
                approvedAt: payload.approval.approvedAt,
                ...(payload.approval.reason === undefined
                  ? {}
                  : { approvalReason: payload.approval.reason }),
              }),
        },
      });

      return this.idempotency.complete(
        payload.idempotencyKey,
        "data.transaction.execute",
        prepared.requestFingerprint,
        result,
      );
    }, "immediate");
  }

  executeWithReceipt(
    input: SchemaMigrationExecuteInput,
  ): SchemaMigrationWithReceipt {
    const result = this.execute(input);
    const receipt = this.provenance.getReceiptByIdempotencyKey({
      idempotencyKey: input.payload.idempotencyKey,
    });
    return { result, receipt };
  }

  private buildPlan(
    actor: DataActor,
    payload: SchemaMigrationPreviewPayload,
  ): SchemaMigrationPlan {
    const current = this.catalog.getSchema(
      payload.spaceId,
      payload.entity,
      "current",
    );
    if (current.schemaVersion !== payload.expectedSchemaVersion) {
      throw new DataCatalogError(
        "SCHEMA_VERSION_CONFLICT",
        `Expected schema version ${payload.expectedSchemaVersion}, current version is ${current.schemaVersion}.`,
        {
          expectedSchemaVersion: payload.expectedSchemaVersion,
          currentSchemaVersion: current.schemaVersion,
        },
      );
    }

    const backfills = payload.backfills ?? [];
    if (!hasFieldMigrationWork(payload.changes, backfills)) {
      migrationInvalid(
        "Schema migration must include at least one field change or backfill; metadata-only changes belong to the normal schema update path.",
      );
    }

    const currentDefinition = schemaSnapshotDefinition(current);
    const proposedDefinition = applySchemaChanges(
      currentDefinition,
      payload.changes,
    );
    validateBackfillTargets(proposedDefinition, backfills);

    const proposedDigest = schemaDigest(proposedDefinition);
    if (proposedDigest === current.schemaDigest) {
      migrationInvalid("Schema migration would not change the canonical schema.");
    }

    const destructive = isDestructive(payload.changes, backfills);
    const recordStore = this.database.recordStorage();
    const records: PlannedRecord[] = [];
    let offset = 0;
    let scannedRecordBytes = 0;
    let rewrittenRecordBytes = 0;

    for (;;) {
      const page = recordStore.listRecords(
        payload.spaceId,
        payload.entity,
        PAGE_SIZE,
        false,
        offset,
      );
      if (page.length === 0) break;

      for (const stored of page) {
        if (records.length >= DATA_PROTOCOL_LIMITS.maxSchemaMigrationRecords) {
          throw new DataSchemaMigrationError(
            "SCHEMA_MIGRATION_LIMIT_EXCEEDED",
            `Schema migration exceeds the atomic limit of ${DATA_PROTOCOL_LIMITS.maxSchemaMigrationRecords} active records.`,
            {
              maxRecords: DATA_PROTOCOL_LIMITS.maxSchemaMigrationRecords,
            },
          );
        }

        scannedRecordBytes += Buffer.byteLength(stored.dataJson, "utf8");
        if (
          scannedRecordBytes >
          DATA_PROTOCOL_LIMITS.maxSchemaMigrationBytes
        ) {
          throw new DataSchemaMigrationError(
            "SCHEMA_MIGRATION_LIMIT_EXCEEDED",
            `Schema migration exceeds the atomic scan limit of ${DATA_PROTOCOL_LIMITS.maxSchemaMigrationBytes} bytes.`,
            {
              maxBytes: DATA_PROTOCOL_LIMITS.maxSchemaMigrationBytes,
              scannedBytes: scannedRecordBytes,
            },
          );
        }

        try {
          const historicalSchema = this.catalog.getSchema(
            stored.spaceId,
            stored.entity,
            stored.schemaVersion,
          );
          const currentRecord = hydrateStoredRecord(
            stored,
            historicalSchema,
          );
          const transformed = transformRecordData(
            currentRecord.data,
            payload.changes,
            backfills,
          );
          const normalized = normalizeRecordData(
            proposedDefinition,
            transformed,
            { applyDefaults: true },
          );
          const relations = collectRecordRelations(
            this.relationStore,
            proposedDefinition,
            stored.recordId,
            normalized,
          );

          rewrittenRecordBytes += Buffer.byteLength(
            canonicalResultJson(normalized),
            "utf8",
          );
          if (
            rewrittenRecordBytes >
            DATA_PROTOCOL_LIMITS.maxSchemaMigrationBytes
          ) {
            throw new DataSchemaMigrationError(
              "SCHEMA_MIGRATION_LIMIT_EXCEEDED",
              `Schema migration rewritten state exceeds the atomic limit of ${DATA_PROTOCOL_LIMITS.maxSchemaMigrationBytes} bytes.`,
              {
                maxBytes: DATA_PROTOCOL_LIMITS.maxSchemaMigrationBytes,
                rewrittenBytes: rewrittenRecordBytes,
              },
            );
          }

          records.push({
            before: stored,
            afterData: normalized,
            afterRelations: relations,
            beforeDataDigest: sha256(stored.dataJson),
            afterDataDigest: sha256(canonicalResultJson(normalized)),
            relationDigest: relationDigest(relations),
          });
        } catch (error) {
          if (error instanceof DataSchemaMigrationError) throw error;
          if (error instanceof DataRecordError) {
            throw new DataSchemaMigrationError(
              "SCHEMA_MIGRATION_INVALID",
              `Record '${stored.recordId}' cannot satisfy the proposed schema migration: ${error.message}`,
              { recordId: stored.recordId },
              error,
            );
          }
          throw error;
        }
      }

      offset += page.length;
      if (page.length < PAGE_SIZE) break;
    }

    const toSchemaVersion = current.schemaVersion + 1;
    const previewMaterial = {
      previewVersion: PREVIEW_VERSION,
      actor,
      owner: payload.owner,
      spaceId: payload.spaceId,
      entity: payload.entity,
      expectedSchemaVersion: payload.expectedSchemaVersion,
      changes: payload.changes,
      backfills,
      ...(payload.reason === undefined ? {} : { reason: payload.reason }),
      fromSchemaVersion: current.schemaVersion,
      fromSchemaDigest: current.schemaDigest,
      toSchemaVersion,
      toSchemaDigest: proposedDigest,
      destructive,
      records: records.map((record) => ({
        recordId: record.before.recordId,
        recordVersion: record.before.version,
        recordSchemaVersion: record.before.schemaVersion,
        beforeDataDigest: record.beforeDataDigest,
        afterDataDigest: record.afterDataDigest,
        relationDigest: record.relationDigest,
      })),
    };

    return {
      payload,
      actor,
      currentDefinition,
      proposedDefinition,
      fromSchemaVersion: current.schemaVersion,
      toSchemaVersion,
      fromSchemaDigest: current.schemaDigest,
      toSchemaDigest: proposedDigest,
      activeRecordCount: records.length,
      scannedRecordBytes,
      rewrittenRecordBytes,
      destructive,
      approvalRequired: destructive,
      records,
      previewDigest: sha256(canonicalResultJson(previewMaterial)),
    };
  }
}
