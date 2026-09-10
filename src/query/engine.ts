import { DataCatalog } from "../catalog/index.js";
import {
  DATA_PROTOCOL_LIMITS,
  DataProtocolValidationError,
  type AggregatePayload,
  type DataRecord,
  type JsonObject,
  type QueryPayload,
  validateAggregatePayload,
  validateQueryPayload,
} from "../protocol/index.js";
import { hydrateStoredRecord } from "../records/hydration.js";
import type {
  DataQueryStorage,
  DataStorageDatabase,
  StoredRecord,
} from "../storage/index.js";
import {
  decodeQueryCursor,
  encodeQueryCursor,
  queryFingerprint,
} from "./cursor.js";
import { DataQueryError } from "./errors.js";
import {
  validateAggregateSemantics,
  validateQuerySemantics,
} from "./semantics.js";
import type {
  DataAggregateResult,
  DataQueryApi,
  DataQueryPage,
} from "./types.js";

function validationFailure(error: unknown): never {
  if (error instanceof DataProtocolValidationError) {
    const code =
      error.path.endsWith(".limit") &&
      /at most|maximum|must be <=|1\.\./i.test(error.message)
        ? "QUERY_LIMIT_EXCEEDED"
        : "QUERY_INVALID";
    throw new DataQueryError(code, error.message, undefined, error);
  }
  throw error;
}

function projectData(
  record: DataRecord,
  select: readonly string[] | undefined,
): DataRecord {
  if (select === undefined) return record;

  const data: Record<string, DataRecord["data"][string]> = {};
  for (const field of select) {
    const value = record.data[field];
    if (value !== undefined) data[field] = value;
  }

  return {
    ...record,
    data: data as JsonObject,
  };
}

export class DataQuery implements DataQueryApi {
  private readonly catalog: DataCatalog;
  private readonly store: DataQueryStorage;

  constructor(database: DataStorageDatabase) {
    this.catalog = new DataCatalog(database);
    this.store = database.queryStorage();
  }

  query(input: QueryPayload): DataQueryPage {
    let query: QueryPayload;
    try {
      query = validateQueryPayload(input, "$query");
    } catch (error) {
      validationFailure(error);
    }

    const schema = this.catalog.getSchema(query.spaceId, query.entity);
    validateQuerySemantics(query, schema);

    const limit = query.limit ?? DATA_PROTOCOL_LIMITS.defaultQueryPageSize;
    const fingerprint = queryFingerprint(query, limit);
    const offset = decodeQueryCursor(query.cursor, fingerprint);

    const page = this.store.query({
      spaceId: query.spaceId,
      entity: query.entity,
      ...(query.where === undefined ? {} : { where: query.where }),
      orderBy: query.orderBy ?? [],
      limit,
      offset,
      includeDeleted: query.includeDeleted ?? false,
    });

    const schemaCache = new Map<number, ReturnType<DataCatalog["getSchema"]>>();
    const hydrate = (stored: StoredRecord): DataRecord => {
      let historical = schemaCache.get(stored.schemaVersion);
      if (historical === undefined) {
        historical = this.catalog.getSchema(
          stored.spaceId,
          stored.entity,
          stored.schemaVersion,
        );
        schemaCache.set(stored.schemaVersion, historical);
      }
      return projectData(
        hydrateStoredRecord(stored, historical),
        query.select,
      );
    };

    const items = page.records.map(hydrate);
    const nextCursor = page.hasMore
      ? encodeQueryCursor(offset + limit, fingerprint)
      : null;

    return {
      items,
      nextCursor,
      hasMore: page.hasMore,
    };
  }

  aggregate(input: AggregatePayload): DataAggregateResult {
    let aggregate: AggregatePayload;
    try {
      aggregate = validateAggregatePayload(input, "$aggregate");
    } catch (error) {
      validationFailure(error);
    }

    const schema = this.catalog.getSchema(
      aggregate.spaceId,
      aggregate.entity,
    );
    validateAggregateSemantics(aggregate, schema);

    return {
      values: this.store.aggregate({
        spaceId: aggregate.spaceId,
        entity: aggregate.entity,
        ...(aggregate.where === undefined ? {} : { where: aggregate.where }),
        metrics: aggregate.metrics,
      }),
    };
  }
}
