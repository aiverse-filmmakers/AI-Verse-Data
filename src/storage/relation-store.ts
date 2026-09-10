export interface StoredRecordRelation {
  readonly sourceSpaceId: string;
  readonly sourceEntity: string;
  readonly sourceRecordId: string;
  readonly field: string;
  readonly targetSpaceId: string;
  readonly targetEntity: string;
  readonly targetRecordId: string;
}

export interface DataRelationStorage {
  initialize(): void;
  targetExists(
    spaceId: string,
    entity: string,
    recordId: string,
  ): boolean;
  replaceSourceRelations(
    spaceId: string,
    entity: string,
    recordId: string,
    relations: readonly StoredRecordRelation[],
  ): void;
  deleteSourceRelations(
    spaceId: string,
    entity: string,
    recordId: string,
  ): void;
  listSourceRelations(
    spaceId: string,
    entity: string,
    recordId: string,
  ): readonly StoredRecordRelation[];
}
