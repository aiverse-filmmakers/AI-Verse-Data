import type {
  DataActor,
  JsonObject,
} from "../protocol/index.js";

export interface RecordActorRef extends DataActor {}

export interface DataRecordSnapshot {
  readonly spaceId: string;
  readonly entity: string;
  readonly recordId: string;
  readonly schemaVersion: number;
  readonly version: number;
  readonly data: JsonObject;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: RecordActorRef;
  readonly updatedBy: RecordActorRef;
  readonly deletedAt: string | null;
  readonly deletedReason: string | null;
  readonly deletedBy: RecordActorRef | null;
}

export interface RecordCreateInput {
  readonly spaceId: string;
  readonly entity: string;
  readonly data: JsonObject;
  readonly actor: DataActor;
}

export interface RecordGetInput {
  readonly spaceId: string;
  readonly entity: string;
  readonly recordId: string;
  readonly includeDeleted?: boolean;
}

export interface RecordListInput {
  readonly spaceId: string;
  readonly entity: string;
  readonly limit?: number;
  readonly includeDeleted?: boolean;
}

export interface RecordUpdateInput {
  readonly spaceId: string;
  readonly entity: string;
  readonly recordId: string;
  readonly patch: JsonObject;
  readonly actor: DataActor;
}

export interface RecordDeleteInput {
  readonly spaceId: string;
  readonly entity: string;
  readonly recordId: string;
  readonly actor: DataActor;
  readonly reason?: string;
}

export interface DataRecordsApi {
  create(input: RecordCreateInput): DataRecordSnapshot;
  get(input: RecordGetInput): DataRecordSnapshot;
  list(input: RecordListInput): readonly DataRecordSnapshot[];
  update(input: RecordUpdateInput): DataRecordSnapshot;
  softDelete(input: RecordDeleteInput): DataRecordSnapshot;
}
