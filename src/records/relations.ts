import type {
  EntitySchemaDefinition,
  JsonObject,
} from "../protocol/index.js";
import type {
  DataRelationStorage,
  StoredRecordRelation,
} from "../storage/index.js";
import { DataRecordError } from "./errors.js";

export function collectRecordRelations(
  relationStore: DataRelationStorage,
  schema: EntitySchemaDefinition,
  recordId: string,
  data: JsonObject,
): readonly StoredRecordRelation[] {
  const relations: StoredRecordRelation[] = [];

  for (const [field, definition] of Object.entries(schema.fields)) {
    if (definition.type !== "reference") continue;
    const value = data[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") {
      throw new DataRecordError(
        "REFERENCE_INVALID",
        `Reference field '${field}' is not a valid record identifier.`,
        { field },
      );
    }

    const targetSpaceId = definition.spaceId ?? schema.spaceId;
    const targetEntity = definition.entity;
    if (!relationStore.targetExists(targetSpaceId, targetEntity, value)) {
      throw new DataRecordError(
        "REFERENCE_INVALID",
        `Reference field '${field}' points to a missing or deleted record.`,
        {
          field,
          targetSpaceId,
          targetEntity,
          targetRecordId: value,
        },
      );
    }

    relations.push({
      sourceSpaceId: schema.spaceId,
      sourceEntity: schema.entity,
      sourceRecordId: recordId,
      field,
      targetSpaceId,
      targetEntity,
      targetRecordId: value,
    });
  }

  return relations;
}

export function assertRecordMayBeDeleted(
  relationStore: DataRelationStorage,
  spaceId: string,
  entity: string,
  recordId: string,
): void {
  const inbound = relationStore.listInboundRelations(spaceId, entity, recordId);
  if (inbound.length === 0) return;

  const first = inbound[0]!;
  throw new DataRecordError(
    "REFERENCE_INVALID",
    "Record cannot be deleted while active records still reference it.",
    {
      sourceSpaceId: first.sourceSpaceId,
      sourceEntity: first.sourceEntity,
      sourceRecordId: first.sourceRecordId,
      field: first.field,
    },
  );
}
