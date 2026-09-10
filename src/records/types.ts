import type {
  DataActor,
  DataRecord,
  JsonObject,
} from "../protocol/index.js";

export type DataRecordSnapshot = DataRecord;

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
  readonly expectedVersion: number;
  readonly patch: JsonObject;
  readonly actor: DataActor;
}

export interface RecordDeleteInput {
  readonly spaceId: string;
  readonly entity: string;
  readonly recordId: string;
  readonly expectedVersion: number;
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
