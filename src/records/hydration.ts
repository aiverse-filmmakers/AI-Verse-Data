import {
  ACTOR_KINDS,
  type DataActor,
  type EntitySchemaDefinition,
  type JsonObject,
} from "../protocol/index.js";
import type { StoredRecord } from "../storage/index.js";
import { DataRecordError } from "./errors.js";
import type { DataRecordSnapshot } from "./types.js";
import { normalizeRecordData } from "./validation.js";

function actorFromStored(
  kind: string,
  id: string,
  label: string,
): DataActor {
  if (!(ACTOR_KINDS as readonly string[]).includes(kind) || id.length < 1) {
    throw new DataRecordError(
      "DATABASE_CORRUPT",
      `Stored ${label} actor attribution is invalid.`,
    );
  }
  return { kind: kind as DataActor["kind"], id };
}

function parseDataJson(stored: StoredRecord): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored.dataJson);
  } catch (error) {
    throw new DataRecordError(
      "DATABASE_CORRUPT",
      "Stored record JSON is invalid.",
      {
        spaceId: stored.spaceId,
        entity: stored.entity,
        recordId: stored.recordId,
      },
      error,
    );
  }

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new DataRecordError(
      "DATABASE_CORRUPT",
      "Stored record payload is not a JSON object.",
      {
        spaceId: stored.spaceId,
        entity: stored.entity,
        recordId: stored.recordId,
      },
    );
  }

  return parsed as JsonObject;
}

function validateStoredTimestamps(stored: StoredRecord): void {
  for (const [label, value] of [
    ["createdAt", stored.createdAt],
    ["updatedAt", stored.updatedAt],
  ] as const) {
    if (Number.isNaN(Date.parse(value))) {
      throw new DataRecordError(
        "DATABASE_CORRUPT",
        `Stored record ${label} is invalid.`,
        { recordId: stored.recordId },
      );
    }
  }

  if (stored.deletedAt !== null && Number.isNaN(Date.parse(stored.deletedAt))) {
    throw new DataRecordError(
      "DATABASE_CORRUPT",
      "Stored record deletedAt is invalid.",
      { recordId: stored.recordId },
    );
  }
}

export function hydrateStoredRecord(
  stored: StoredRecord,
  schema: EntitySchemaDefinition,
): DataRecordSnapshot {
  validateStoredTimestamps(stored);
  const raw = parseDataJson(stored);

  let data: JsonObject;
  try {
    data = normalizeRecordData(schema, raw, { applyDefaults: false });
  } catch (error) {
    throw new DataRecordError(
      "DATABASE_CORRUPT",
      "Stored record no longer validates against its persisted schema version.",
      {
        spaceId: stored.spaceId,
        entity: stored.entity,
        recordId: stored.recordId,
        schemaVersion: stored.schemaVersion,
      },
      error,
    );
  }

  const deletedBy =
    stored.deletedAt === null
      ? null
      : actorFromStored(
          stored.deletedActorKind ?? "",
          stored.deletedActorId ?? "",
          "deletedBy",
        );

  return {
    spaceId: stored.spaceId,
    entity: stored.entity,
    recordId: stored.recordId,
    schemaVersion: stored.schemaVersion,
    version: stored.version,
    data,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    createdBy: actorFromStored(
      stored.createdActorKind,
      stored.createdActorId,
      "createdBy",
    ),
    updatedBy: actorFromStored(
      stored.updatedActorKind,
      stored.updatedActorId,
      "updatedBy",
    ),
    deletedAt: stored.deletedAt,
    deletedReason: stored.deletedReason,
    deletedBy,
  };
}
