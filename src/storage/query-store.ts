import type { AggregateOperator, JsonValue, SortDirection } from "../protocol/index.js";
import type { StoredRecord } from "./record-store.js";

export type StorageQueryOperator =
  | "eq" | "neq" | "lt" | "lte" | "gt" | "gte"
  | "in" | "not_in" | "contains" | "starts_with"
  | "is_null" | "is_not_null";

export interface StorageQueryCondition {
  readonly field: string;
  readonly op: StorageQueryOperator;
  readonly value?: JsonValue;
}

export interface StorageQueryAnd { readonly and: readonly StorageQueryFilter[]; }
export interface StorageQueryOr { readonly or: readonly StorageQueryFilter[]; }
export interface StorageQueryNot { readonly not: StorageQueryFilter; }

export type StorageQueryFilter =
  | StorageQueryCondition
  | StorageQueryAnd
  | StorageQueryOr
  | StorageQueryNot;

export interface StorageQueryOrder {
  readonly field: string;
  readonly direction: SortDirection;
}

export interface StorageQueryPlan {
  readonly spaceId: string;
  readonly entity: string;
  readonly where?: StorageQueryFilter;
  readonly orderBy: readonly StorageQueryOrder[];
  readonly limit: number;
  readonly offset: number;
  readonly includeDeleted: boolean;
}

export interface StorageQueryPage {
  readonly records: readonly StoredRecord[];
  readonly hasMore: boolean;
}

export interface StorageAggregateMetric {
  readonly op: AggregateOperator;
  readonly field?: string;
  readonly as: string;
}

export interface StorageAggregatePlan {
  readonly spaceId: string;
  readonly entity: string;
  readonly where?: StorageQueryFilter;
  readonly metrics: readonly StorageAggregateMetric[];
}

export interface DataQueryStorage {
  query(plan: StorageQueryPlan): StorageQueryPage;
  aggregate(plan: StorageAggregatePlan): Readonly<Record<string, number | string | null>>;
}
