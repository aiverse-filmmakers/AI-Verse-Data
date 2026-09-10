import type {
  DataSpaceDefinition,
  EntitySchemaDefinition,
  SchemaUpdatePayload,
} from "../protocol/index.js";

export interface DataSpaceSnapshot extends DataSpaceDefinition {
  readonly description?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly schemaCount: number;
}

export interface EntitySchemaSnapshot extends EntitySchemaDefinition {
  readonly description?: string;
  readonly allowUnknownFields?: boolean;
  readonly schemaVersion: number;
  readonly schemaDigest: string;
  readonly versionCreatedAt: string;
}

export interface EntitySchemaSummary {
  readonly spaceId: string;
  readonly entity: string;
  readonly name: string;
  readonly schemaVersion: number;
  readonly schemaDigest: string;
  readonly fieldCount: number;
  readonly entityUpdatedAt: string;
}

export interface DataCatalogApi {
  createSpace(input: DataSpaceDefinition): DataSpaceSnapshot;
  listSpaces(): readonly DataSpaceSnapshot[];
  getSpace(spaceId: string): DataSpaceSnapshot;

  createSchema(input: EntitySchemaDefinition): EntitySchemaSnapshot;
  listSchemas(spaceId: string): readonly EntitySchemaSummary[];
  getSchema(
    spaceId: string,
    entity: string,
    version?: "current" | number,
  ): EntitySchemaSnapshot;
  updateSchema(input: SchemaUpdatePayload): EntitySchemaSnapshot;
}
