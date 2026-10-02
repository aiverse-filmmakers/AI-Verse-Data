import { DataProvenance, DataProvenanceError } from "../provenance/index.js";
import type { DataActor, DataAuthorization, JsonObject, JsonValue } from "../protocol/index.js";
import { DataQuery } from "../query/index.js";
import { DataRecords } from "../records/index.js";
import {
  validateRecordActor,
  validateRecordIdempotencyKey,
} from "../records/validation.js";
import {
  TrustedDataRoot,
  createWorkspaceDataScope,
  openScopedDataDatabase,
} from "../scope/index.js";
import { SqliteStorageDriver } from "../storage/index.js";

const FIELD_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class DataNaturalKeyError extends Error {
  readonly code:
    | "NATURAL_KEY_INVALID"
    | "NATURAL_KEY_CONFLICT"
    | "NATURAL_KEY_AMBIGUOUS";
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: DataNaturalKeyError["code"],
    message: string,
    details?: Readonly<Record<string, string | number | boolean | null>>,
  ) {
    super(message);
    this.name = "DataNaturalKeyError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export interface NaturalKeyCreatePayload {
  readonly spaceId: string;
  readonly entity: string;
  readonly idempotencyKey: string;
  readonly data: JsonObject;
  readonly naturalKey: {
    readonly field: string;
    readonly value: string | number | boolean;
  };
}

export interface NaturalKeyCreateInput {
  readonly rootPath: string;
  readonly workspaceId: string;
  readonly actor: DataActor;
  readonly authorization: DataAuthorization;
  readonly payload: NaturalKeyCreatePayload;
}

export interface NaturalKeyCreateResult {
  readonly state: "created" | "existing";
  readonly idempotentReplay: boolean;
  readonly requestId: string;
  readonly record: ReturnType<DataRecords["get"]>;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validatePayload(value: unknown): NaturalKeyCreatePayload {
  if (!plainObject(value)) {
    throw new DataNaturalKeyError(
      "NATURAL_KEY_INVALID",
      "Natural-key record create payload must be an object.",
    );
  }
  const allowed = new Set(["spaceId", "entity", "idempotencyKey", "data", "naturalKey"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new DataNaturalKeyError(
        "NATURAL_KEY_INVALID",
        `Natural-key record create contains unsupported field '${key}'.`,
      );
    }
  }
  if (
    typeof value.spaceId !== "string" ||
    typeof value.entity !== "string" ||
    typeof value.idempotencyKey !== "string" ||
    !plainObject(value.data) ||
    !plainObject(value.naturalKey)
  ) {
    throw new DataNaturalKeyError(
      "NATURAL_KEY_INVALID",
      "Natural-key record create requires spaceId, entity, idempotencyKey, data, and naturalKey.",
    );
  }
  const naturalKeys = Object.keys(value.naturalKey);
  if (
    naturalKeys.length !== 2 ||
    !naturalKeys.includes("field") ||
    !naturalKeys.includes("value") ||
    typeof value.naturalKey.field !== "string" ||
    !FIELD_NAME_RE.test(value.naturalKey.field)
  ) {
    throw new DataNaturalKeyError(
      "NATURAL_KEY_INVALID",
      "naturalKey must contain exactly a safe field and one scalar value.",
    );
  }
  const naturalValue = value.naturalKey.value;
  if (
    !(
      typeof naturalValue === "string" ||
      typeof naturalValue === "boolean" ||
      (typeof naturalValue === "number" && Number.isFinite(naturalValue))
    )
  ) {
    throw new DataNaturalKeyError(
      "NATURAL_KEY_INVALID",
      "naturalKey.value must be a non-null scalar supported by Data equality semantics.",
      { field: value.naturalKey.field },
    );
  }
  const data = value.data as JsonObject;
  if (!Object.prototype.hasOwnProperty.call(data, value.naturalKey.field)) {
    throw new DataNaturalKeyError(
      "NATURAL_KEY_INVALID",
      "The natural-key field must be present in the record payload.",
      { field: value.naturalKey.field },
    );
  }
  const dataValue = data[value.naturalKey.field] as JsonValue | undefined;
  if (!Object.is(dataValue, naturalValue)) {
    throw new DataNaturalKeyError(
      "NATURAL_KEY_INVALID",
      "The natural-key value must exactly match the record payload field value.",
      { field: value.naturalKey.field },
    );
  }
  return {
    spaceId: value.spaceId,
    entity: value.entity,
    idempotencyKey: value.idempotencyKey,
    data,
    naturalKey: {
      field: value.naturalKey.field,
      value: naturalValue,
    },
  };
}

/**
 * Owner-authoritative create admission for automatic structured current truth.
 *
 * The natural-key lookup and possible record create execute inside one immediate
 * Data transaction. Competing writers therefore cannot both observe absence and
 * commit separate canonical rows for the same semantic identity.
 */
export function createRecordByNaturalKey(input: NaturalKeyCreateInput): NaturalKeyCreateResult {
  const payload = validatePayload(input.payload);
  const actor = validateRecordActor(input.actor);
  const idempotencyKey = validateRecordIdempotencyKey(payload.idempotencyKey);
  const root = TrustedDataRoot.fromExistingDirectory(input.rootPath);
  const scope = createWorkspaceDataScope(root, input.workspaceId);
  const handle = openScopedDataDatabase(new SqliteStorageDriver(), scope, {
    mode: "open-existing",
  });
  const database = handle.database;

  try {
    const query = new DataQuery(database);
    const records = new DataRecords(database);
    const provenance = new DataProvenance(database);

    return database.transaction(() => {
      const page = query.query({
        spaceId: payload.spaceId,
        entity: payload.entity,
        where: {
          field: payload.naturalKey.field,
          op: "eq",
          value: payload.naturalKey.value,
        },
        limit: 2,
      });

      if (page.items.length > 1) {
        throw new DataNaturalKeyError(
          "NATURAL_KEY_AMBIGUOUS",
          "Canonical Data already contains multiple active records for this natural key; automatic mutation is blocked until repaired.",
          {
            field: payload.naturalKey.field,
            matches: page.items.length,
          },
        );
      }

      const existing = page.items[0];
      if (existing !== undefined) {
        try {
          const receipt = provenance.getReceiptByIdempotencyKey({ idempotencyKey });
          if (
            receipt.operation === "data.record.create" &&
            receipt.spaceId === payload.spaceId &&
            receipt.entity === payload.entity &&
            receipt.recordId === existing.recordId
          ) {
            return {
              state: "existing" as const,
              idempotentReplay: true,
              requestId: receipt.requestId,
              record: existing,
            };
          }
        } catch (error) {
          if (!(error instanceof DataProvenanceError) || error.code !== "RECEIPT_NOT_FOUND") {
            throw error;
          }
        }

        throw new DataNaturalKeyError(
          "NATURAL_KEY_CONFLICT",
          "Natural key is already bound to a different committed record create.",
          {
            field: payload.naturalKey.field,
            recordId: existing.recordId,
            version: existing.version,
          },
        );
      }

      const record = records.create({
        spaceId: payload.spaceId,
        entity: payload.entity,
        idempotencyKey,
        data: payload.data,
        actor,
      });
      const receipt = provenance.getReceiptByIdempotencyKey({ idempotencyKey });
      return {
        state: "created" as const,
        idempotentReplay: false,
        requestId: receipt.requestId,
        record,
      };
    }, "immediate");
  } finally {
    database.close();
  }
}
