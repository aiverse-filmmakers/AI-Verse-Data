export interface StoredRecord {
  readonly spaceId: string;
  readonly entity: string;
  readonly recordId: string;
  readonly schemaVersion: number;
  readonly version: number;
  readonly dataJson: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdActorKind: string;
  readonly createdActorId: string;
  readonly updatedActorKind: string;
  readonly updatedActorId: string;
  readonly deletedAt: string | null;
  readonly deletedReason: string | null;
  readonly deletedActorKind: string | null;
  readonly deletedActorId: string | null;
}

export interface DataRecordStorage {
  initialize(): void;
  createRecord(record: StoredRecord): boolean;
  getRecord(
    spaceId: string,
    entity: string,
    recordId: string,
    includeDeleted?: boolean,
  ): StoredRecord | null;
  listRecords(
    spaceId: string,
    entity: string,
    limit: number,
    includeDeleted?: boolean,
  ): readonly StoredRecord[];
  updateRecord(record: StoredRecord, expectedVersion: number): boolean;
  softDeleteRecord(record: StoredRecord, expectedVersion: number): boolean;
}
