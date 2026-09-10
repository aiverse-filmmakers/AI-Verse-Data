import type {
  AggregatePayload,
  DataRecord,
  JsonObject,
  QueryPayload,
} from "../protocol/index.js";

export interface DataQueryPage {
  readonly items: readonly DataRecord[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export interface DataAggregateResult {
  readonly values: Readonly<Record<string, number | string | null>>;
}

export interface DataQueryApi {
  query(input: QueryPayload): DataQueryPage;
  aggregate(input: AggregatePayload): DataAggregateResult;
}

export type QuerySelection = readonly string[] | undefined;

export interface QueryCursorPayload {
  readonly version: 1;
  readonly offset: number;
  readonly fingerprint: string;
}

export type ProjectedRecordData = JsonObject;
