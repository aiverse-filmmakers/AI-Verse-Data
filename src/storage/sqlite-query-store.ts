import type Database from "better-sqlite3";

import type { JsonValue } from "../protocol/index.js";
import type {
  DataQueryStorage,
  StorageAggregatePlan,
  StorageQueryFilter,
  StorageQueryOrder,
  StorageQueryPage,
  StorageQueryPlan,
} from "./query-store.js";
import type { StoredRecord } from "./record-store.js";

interface RecordRow {
  readonly space_id: string;
  readonly entity_id: string;
  readonly record_id: string;
  readonly schema_version: number;
  readonly record_version: number;
  readonly data_json: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly created_actor_kind: string;
  readonly created_actor_id: string;
  readonly updated_actor_kind: string;
  readonly updated_actor_id: string;
  readonly deleted_at: string | null;
  readonly deleted_reason: string | null;
  readonly deleted_actor_kind: string | null;
  readonly deleted_actor_id: string | null;
}

function mapRecord(row: RecordRow): StoredRecord {
  return {
    spaceId: row.space_id,
    entity: row.entity_id,
    recordId: row.record_id,
    schemaVersion: row.schema_version,
    version: row.record_version,
    dataJson: row.data_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdActorKind: row.created_actor_kind,
    createdActorId: row.created_actor_id,
    updatedActorKind: row.updated_actor_kind,
    updatedActorId: row.updated_actor_id,
    deletedAt: row.deleted_at,
    deletedReason: row.deleted_reason,
    deletedActorKind: row.deleted_actor_kind,
    deletedActorId: row.deleted_actor_id,
  };
}

function jsonPath(field: string): string {
  return "$." + JSON.stringify(field);
}

function scalarParam(value: JsonValue): string | number | null {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return JSON.stringify(value);
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function compileFilter(
  filter: StorageQueryFilter,
  params: Array<string | number | null>,
): string {
  if ("and" in filter) return "(" + filter.and.map((item) => compileFilter(item, params)).join(" AND ") + ")";
  if ("or" in filter) return "(" + filter.or.map((item) => compileFilter(item, params)).join(" OR ") + ")";
  if ("not" in filter) return "(NOT " + compileFilter(filter.not, params) + ")";

  params.push(jsonPath(filter.field));
  const expression = "json_extract(data_json, ?)";

  switch (filter.op) {
    case "is_null": return expression + " IS NULL";
    case "is_not_null": return expression + " IS NOT NULL";
    case "eq":
      params.push(scalarParam(filter.value ?? null));
      return expression + " = ?";
    case "neq":
      params.push(scalarParam(filter.value ?? null));
      return expression + " != ?";
    case "lt":
      params.push(scalarParam(filter.value ?? null));
      return expression + " < ?";
    case "lte":
      params.push(scalarParam(filter.value ?? null));
      return expression + " <= ?";
    case "gt":
      params.push(scalarParam(filter.value ?? null));
      return expression + " > ?";
    case "gte":
      params.push(scalarParam(filter.value ?? null));
      return expression + " >= ?";
    case "contains":
      params.push("%" + escapeLike(String(filter.value ?? "")) + "%");
      return expression + " LIKE ? ESCAPE '\\'";
    case "starts_with":
      params.push(escapeLike(String(filter.value ?? "")) + "%");
      return expression + " LIKE ? ESCAPE '\\'";
    case "in":
    case "not_in": {
      const values = Array.isArray(filter.value) ? filter.value : [];
      const placeholders = values.map((value) => {
        params.push(scalarParam(value));
        return "?";
      });
      return expression + (filter.op === "in" ? " IN (" : " NOT IN (") + placeholders.join(", ") + ")";
    }
  }
}

function compileOrder(
  orderBy: readonly StorageQueryOrder[],
  params: Array<string | number | null>,
): string {
  const parts = orderBy.map((order) => {
    params.push(jsonPath(order.field));
    return "json_extract(data_json, ?) " + order.direction.toUpperCase();
  });
  parts.push("record_id ASC");
  return parts.join(", ");
}

const SELECT_RECORD = [
  "SELECT space_id, entity_id, record_id, schema_version, record_version, data_json,",
  "created_at, updated_at, created_actor_kind, created_actor_id, updated_actor_kind,",
  "updated_actor_id, deleted_at, deleted_reason, deleted_actor_kind, deleted_actor_id",
  "FROM _records",
].join(" ");

function quoteIdentifier(value: string): string {
  return "\"" + value.replaceAll("\"", "\"\"") + "\"";
}

export class SqliteQueryStorage implements DataQueryStorage {
  constructor(private readonly database: Database.Database) {}

  query(plan: StorageQueryPlan): StorageQueryPage {
    const params: Array<string | number | null> = [plan.spaceId, plan.entity];
    const predicates = ["space_id = ?", "entity_id = ?"];
    if (!plan.includeDeleted) predicates.push("deleted_at IS NULL");
    if (plan.where !== undefined) predicates.push(compileFilter(plan.where, params));

    const orderSql = plan.orderBy.length === 0 ? "record_id ASC" : compileOrder(plan.orderBy, params);
    params.push(plan.limit + 1, plan.offset);

    const sql = SELECT_RECORD + " WHERE " + predicates.join(" AND ") +
      " ORDER BY " + orderSql + " LIMIT ? OFFSET ?";
    const rows = this.database.prepare(sql).all(...params) as RecordRow[];

    return {
      records: rows.slice(0, plan.limit).map(mapRecord),
      hasMore: rows.length > plan.limit,
    };
  }

  aggregate(plan: StorageAggregatePlan): Readonly<Record<string, number | string | null>> {
    const metricParams: Array<string | number | null> = [];
    const expressions = plan.metrics.map((metric) => {
      if (metric.op === "count") return "COUNT(*) AS " + quoteIdentifier(metric.as);
      metricParams.push(jsonPath(metric.field ?? ""));
      return metric.op.toUpperCase() + "(json_extract(data_json, ?)) AS " + quoteIdentifier(metric.as);
    });

    const whereParams: Array<string | number | null> = [plan.spaceId, plan.entity];
    const predicates = ["space_id = ?", "entity_id = ?", "deleted_at IS NULL"];
    if (plan.where !== undefined) predicates.push(compileFilter(plan.where, whereParams));

    const sql = "SELECT " + expressions.join(", ") + " FROM _records WHERE " + predicates.join(" AND ");
    const row = this.database.prepare(sql).get(...metricParams, ...whereParams) as Record<string, unknown>;
    const output: Record<string, number | string | null> = {};
    for (const metric of plan.metrics) {
      const value = row[metric.as];
      if (value !== null && typeof value !== "number" && typeof value !== "string") {
        throw new TypeError("Unexpected aggregate result for '" + metric.as + "'.");
      }
      output[metric.as] = value ?? null;
    }
    return output;
  }
}
