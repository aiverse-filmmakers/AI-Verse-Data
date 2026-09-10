import {
  DATA_PROTOCOL_LIMITS,
  DataProtocolValidationError,
  type DataSpaceDefinition,
  type EntitySchemaDefinition,
  type FieldDefinition,
  type SchemaChange,
  type SchemaUpdatePayload,
  validateDataSpaceDefinition,
  validateEntitySchemaDefinition,
  validateSchemaUpdatePayload,
} from "../protocol/index.js";
import type {
  DataCatalogStorage,
  DataStorageDatabase,
  StoredCurrentEntitySchema,
  StoredDataSpace,
  StoredEntitySchemaVersion,
} from "../storage/index.js";
import { canonicalSchemaJson, cloneSchemaDefinition, schemaDigest } from "./canonical.js";
import { DataCatalogError } from "./errors.js";
import type {
  DataCatalogApi,
  DataSpaceSnapshot,
  EntitySchemaSnapshot,
  EntitySchemaSummary,
} from "./types.js";

function own(object: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function normalizeSpace(input: DataSpaceDefinition): DataSpaceDefinition {
  const normalized: DataSpaceDefinition = {
    spaceId: input.spaceId,
    name: input.name,
    authority: input.authority,
    ...(input.description === undefined
      ? {}
      : { description: input.description }),
  };
  return normalized;
}

function parseStoredDefinition(
  stored: StoredEntitySchemaVersion,
): EntitySchemaDefinition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored.definitionJson);
  } catch (error) {
    throw new DataCatalogError(
      "DATABASE_CORRUPT",
      "Stored entity schema JSON is not valid.",
      {
        spaceId: stored.spaceId,
        entity: stored.entity,
        schemaVersion: stored.schemaVersion,
      },
      error,
    );
  }

  try {
    const definition = validateEntitySchemaDefinition(parsed, "$storedSchema");
    const normalized = cloneSchemaDefinition(definition);
    const digest = schemaDigest(normalized);
    if (digest !== stored.schemaDigest) {
      throw new DataCatalogError(
        "DATABASE_CORRUPT",
        "Stored entity schema digest does not match its definition.",
        {
          spaceId: stored.spaceId,
          entity: stored.entity,
          schemaVersion: stored.schemaVersion,
        },
      );
    }
    return normalized;
  } catch (error) {
    if (error instanceof DataCatalogError) throw error;
    throw new DataCatalogError(
      "DATABASE_CORRUPT",
      "Stored entity schema definition is invalid.",
      {
        spaceId: stored.spaceId,
        entity: stored.entity,
        schemaVersion: stored.schemaVersion,
      },
      error,
    );
  }
}

function snapshotFromStored(
  stored: StoredEntitySchemaVersion,
): EntitySchemaSnapshot {
  const definition = parseStoredDefinition(stored);
  return {
    ...definition,
    schemaVersion: stored.schemaVersion,
    schemaDigest: stored.schemaDigest,
    versionCreatedAt: stored.createdAt,
  };
}

function summaryFromStored(
  stored: StoredCurrentEntitySchema,
): EntitySchemaSummary {
  const definition = parseStoredDefinition(stored);
  return {
    spaceId: stored.spaceId,
    entity: stored.entity,
    name: definition.name,
    schemaVersion: stored.schemaVersion,
    schemaDigest: stored.schemaDigest,
    fieldCount: Object.keys(definition.fields).length,
    entityUpdatedAt: stored.entityUpdatedAt,
  };
}

function safeAddField(
  fields: Readonly<Record<string, FieldDefinition>>,
  change: Extract<SchemaChange, { readonly op: "add_field" }>,
): Readonly<Record<string, FieldDefinition>> {
  if (own(fields, change.field)) {
    throw new DataCatalogError(
      "SCHEMA_INVALID",
      `Field '${change.field}' already exists.`,
      { field: change.field },
    );
  }

  if (change.definition.required === true && !own(change.definition, "default")) {
    throw new DataCatalogError(
      "SCHEMA_MIGRATION_REQUIRED",
      `Adding required field '${change.field}' without a default requires a migration.`,
      { field: change.field },
    );
  }

  if (Object.keys(fields).length + 1 > DATA_PROTOCOL_LIMITS.maxSchemaFields) {
    throw new DataCatalogError(
      "SCHEMA_INVALID",
      `Entity schema cannot exceed ${DATA_PROTOCOL_LIMITS.maxSchemaFields} fields.`,
    );
  }

  return {
    ...fields,
    [change.field]: change.definition,
  };
}

function applySafeChanges(
  current: EntitySchemaDefinition,
  changes: readonly SchemaChange[],
): EntitySchemaDefinition {
  let name = current.name;
  let description = current.description;
  let fields: Readonly<Record<string, FieldDefinition>> = { ...current.fields };

  for (const change of changes) {
    switch (change.op) {
      case "add_field":
        fields = safeAddField(fields, change);
        break;

      case "set_name":
        name = change.name;
        break;

      case "set_description":
        description = change.description;
        break;

      case "remove_field":
      case "replace_field":
      case "rename_field":
        throw new DataCatalogError(
          "SCHEMA_MIGRATION_REQUIRED",
          `Schema change '${change.op}' requires the user-schema migration framework.`,
          { operation: change.op },
        );
    }
  }

  const updated: EntitySchemaDefinition = {
    spaceId: current.spaceId,
    entity: current.entity,
    name,
    fields,
    ...(description === undefined ? {} : { description }),
    ...(current.allowUnknownFields === undefined
      ? {}
      : { allowUnknownFields: current.allowUnknownFields }),
  };

  return cloneSchemaDefinition(
    validateEntitySchemaDefinition(updated, "$updatedSchema"),
  );
}

function storedSpaceToSnapshot(
  store: DataCatalogStorage,
  space: StoredDataSpace,
): DataSpaceSnapshot {
  return {
    spaceId: space.spaceId,
    name: space.name,
    authority: space.authority as DataSpaceDefinition["authority"],
    ...(space.description === null ? {} : { description: space.description }),
    createdAt: space.createdAt,
    updatedAt: space.updatedAt,
    schemaCount: store.countSchemas(space.spaceId),
  };
}

function asSchemaInvalid(error: unknown): never {
  if (error instanceof DataProtocolValidationError) {
    throw new DataCatalogError("SCHEMA_INVALID", error.message, undefined, error);
  }
  throw error;
}

export class DataCatalog implements DataCatalogApi {
  private readonly store: DataCatalogStorage;

  constructor(database: DataStorageDatabase) {
    this.store = database.catalogStorage();
    this.store.initialize();
  }

  createSpace(input: DataSpaceDefinition): DataSpaceSnapshot {
    const definition = normalizeSpace(
      validateDataSpaceDefinition(input, "$space"),
    );
    const now = new Date().toISOString();
    const stored: StoredDataSpace = {
      spaceId: definition.spaceId,
      name: definition.name,
      description: definition.description ?? null,
      authority: definition.authority,
      createdAt: now,
      updatedAt: now,
    };

    if (!this.store.createSpace(stored)) {
      throw new DataCatalogError(
        "DATA_SPACE_ALREADY_EXISTS",
        `Data Space '${definition.spaceId}' already exists.`,
        { spaceId: definition.spaceId },
      );
    }

    return storedSpaceToSnapshot(this.store, stored);
  }

  listSpaces(): readonly DataSpaceSnapshot[] {
    return this.store
      .listSpaces()
      .map((space) => storedSpaceToSnapshot(this.store, space));
  }

  getSpace(spaceId: string): DataSpaceSnapshot {
    try {
      validateDataSpaceDefinition(
        {
          spaceId,
          name: "_validation_only_",
          authority: "local_canonical",
        },
        "$spaceLookup",
      );
    } catch (error) {
      asSchemaInvalid(error);
    }

    const stored = this.store.getSpace(spaceId);
    if (stored === null) {
      throw new DataCatalogError(
        "DATA_SPACE_NOT_FOUND",
        `Data Space '${spaceId}' does not exist.`,
        { spaceId },
      );
    }
    return storedSpaceToSnapshot(this.store, stored);
  }

  createSchema(input: EntitySchemaDefinition): EntitySchemaSnapshot {
    let definition: EntitySchemaDefinition;
    try {
      definition = cloneSchemaDefinition(
        validateEntitySchemaDefinition(input, "$schema"),
      );
    } catch (error) {
      asSchemaInvalid(error);
    }

    const now = new Date().toISOString();
    const stored: StoredEntitySchemaVersion = {
      spaceId: definition.spaceId,
      entity: definition.entity,
      schemaVersion: 1,
      schemaDigest: schemaDigest(definition),
      definitionJson: canonicalSchemaJson(definition),
      createdAt: now,
    };

    const result = this.store.createSchema(stored);
    if (result.status === "space_missing") {
      throw new DataCatalogError(
        "DATA_SPACE_NOT_FOUND",
        `Data Space '${definition.spaceId}' does not exist.`,
        { spaceId: definition.spaceId },
      );
    }
    if (result.status === "entity_exists") {
      throw new DataCatalogError(
        "ENTITY_ALREADY_EXISTS",
        `Entity '${definition.entity}' already exists in Data Space '${definition.spaceId}'.`,
        { spaceId: definition.spaceId, entity: definition.entity },
      );
    }

    return snapshotFromStored(result.schema);
  }

  listSchemas(spaceId: string): readonly EntitySchemaSummary[] {
    if (this.store.getSpace(spaceId) === null) {
      throw new DataCatalogError(
        "DATA_SPACE_NOT_FOUND",
        `Data Space '${spaceId}' does not exist.`,
        { spaceId },
      );
    }
    return this.store.listCurrentSchemas(spaceId).map(summaryFromStored);
  }

  getSchema(
    spaceId: string,
    entity: string,
    version: "current" | number = "current",
  ): EntitySchemaSnapshot {
    const current = this.store.getCurrentSchema(spaceId, entity);
    if (current === null) {
      if (this.store.getSpace(spaceId) === null) {
        throw new DataCatalogError(
          "DATA_SPACE_NOT_FOUND",
          `Data Space '${spaceId}' does not exist.`,
          { spaceId },
        );
      }
      throw new DataCatalogError(
        "ENTITY_NOT_FOUND",
        `Entity '${entity}' does not exist in Data Space '${spaceId}'.`,
        { spaceId, entity },
      );
    }

    if (version === "current") return snapshotFromStored(current);

    if (!Number.isSafeInteger(version) || version < 1) {
      throw new DataCatalogError(
        "SCHEMA_INVALID",
        "Schema version must be a positive integer.",
        { schemaVersion: version },
      );
    }

    const stored = this.store.getSchemaVersion(spaceId, entity, version);
    if (stored === null) {
      throw new DataCatalogError(
        "SCHEMA_VERSION_NOT_FOUND",
        `Schema version ${version} does not exist for '${spaceId}/${entity}'.`,
        { spaceId, entity, schemaVersion: version },
      );
    }
    return snapshotFromStored(stored);
  }

  updateSchema(input: SchemaUpdatePayload): EntitySchemaSnapshot {
    let update: SchemaUpdatePayload;
    try {
      update = validateSchemaUpdatePayload(input, "$schemaUpdate");
    } catch (error) {
      asSchemaInvalid(error);
    }

    const current = this.store.getCurrentSchema(update.spaceId, update.entity);
    if (current === null) {
      if (this.store.getSpace(update.spaceId) === null) {
        throw new DataCatalogError(
          "DATA_SPACE_NOT_FOUND",
          `Data Space '${update.spaceId}' does not exist.`,
          { spaceId: update.spaceId },
        );
      }
      throw new DataCatalogError(
        "ENTITY_NOT_FOUND",
        `Entity '${update.entity}' does not exist in Data Space '${update.spaceId}'.`,
        { spaceId: update.spaceId, entity: update.entity },
      );
    }

    if (current.schemaVersion !== update.expectedSchemaVersion) {
      throw new DataCatalogError(
        "SCHEMA_VERSION_CONFLICT",
        `Expected schema version ${update.expectedSchemaVersion}, current version is ${current.schemaVersion}.`,
        {
          expectedSchemaVersion: update.expectedSchemaVersion,
          currentSchemaVersion: current.schemaVersion,
        },
      );
    }

    const currentDefinition = parseStoredDefinition(current);
    let nextDefinition: EntitySchemaDefinition;
    try {
      nextDefinition = applySafeChanges(currentDefinition, update.changes);
    } catch (error) {
      if (error instanceof DataCatalogError) throw error;
      asSchemaInvalid(error);
    }

    const now = new Date().toISOString();
    const next: StoredEntitySchemaVersion = {
      spaceId: current.spaceId,
      entity: current.entity,
      schemaVersion: current.schemaVersion + 1,
      schemaDigest: schemaDigest(nextDefinition),
      definitionJson: canonicalSchemaJson(nextDefinition),
      createdAt: now,
    };

    const result = this.store.updateSchema(current.schemaVersion, next);
    if (result.status === "entity_missing") {
      throw new DataCatalogError(
        "ENTITY_NOT_FOUND",
        `Entity '${update.entity}' disappeared before the update committed.`,
        { spaceId: update.spaceId, entity: update.entity },
      );
    }
    if (result.status === "version_conflict") {
      throw new DataCatalogError(
        "SCHEMA_VERSION_CONFLICT",
        `Schema changed concurrently; current version is ${result.currentVersion}.`,
        {
          expectedSchemaVersion: update.expectedSchemaVersion,
          currentSchemaVersion: result.currentVersion,
        },
      );
    }

    return snapshotFromStored(result.schema);
  }
}
