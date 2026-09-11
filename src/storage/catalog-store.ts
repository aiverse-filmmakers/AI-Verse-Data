export interface StoredDataSpace {
  readonly spaceId: string;
  readonly name: string;
  readonly description: string | null;
  readonly authority: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StoredEntitySchemaVersion {
  readonly spaceId: string;
  readonly entity: string;
  readonly schemaVersion: number;
  readonly schemaDigest: string;
  readonly definitionJson: string;
  readonly createdAt: string;
}

export interface StoredCurrentEntitySchema extends StoredEntitySchemaVersion {
  readonly entityCreatedAt: string;
  readonly entityUpdatedAt: string;
}

export type CatalogCreateSchemaResult =
  | { readonly status: "created"; readonly schema: StoredCurrentEntitySchema }
  | { readonly status: "space_missing" }
  | { readonly status: "entity_exists" };

export type CatalogUpdateSchemaResult =
  | { readonly status: "updated"; readonly schema: StoredCurrentEntitySchema }
  | { readonly status: "entity_missing" }
  | { readonly status: "version_conflict"; readonly currentVersion: number };

export interface DataCatalogStorage {
  initialize(): void;

  createSpace(space: StoredDataSpace): boolean;
  listSpaces(): readonly StoredDataSpace[];
  getSpace(spaceId: string): StoredDataSpace | null;
  countSchemas(spaceId: string): number;

  createSchema(schema: StoredEntitySchemaVersion): CatalogCreateSchemaResult;
  listCurrentSchemas(spaceId: string): readonly StoredCurrentEntitySchema[];
  getCurrentSchema(
    spaceId: string,
    entity: string,
  ): StoredCurrentEntitySchema | null;
  getSchemaVersion(
    spaceId: string,
    entity: string,
    version: number,
  ): StoredEntitySchemaVersion | null;
  listSchemaVersions(
    spaceId: string,
    entity: string,
  ): readonly StoredEntitySchemaVersion[];
  updateSchema(
    expectedVersion: number,
    schema: StoredEntitySchemaVersion,
  ): CatalogUpdateSchemaResult;
}
