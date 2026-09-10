import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DataCatalog } from "../src/catalog/index.js";
import {
  DataQuery,
  DataQueryError,
  MAX_QUERY_OFFSET,
} from "../src/query/index.js";
import { queryFingerprint, encodeQueryCursor } from "../src/query/cursor.js";
import { DataRecords } from "../src/records/index.js";
import { DATA_PROTOCOL_LIMITS, type QueryPayload } from "../src/protocol/index.js";
import { SqliteStorageDriver } from "../src/storage/index.js";

const human = { kind: "human", id: "operator" } as const;

function withQuery(
  run: (
    catalog: DataCatalog,
    records: DataRecords,
    query: DataQuery,
  ) => void,
): void {
  const directory = mkdtempSync(join(tmpdir(), "ai-verse-data-query-"));
  const databasePath = join(directory, "data.sqlite");
  const database = new SqliteStorageDriver().open({ location: databasePath });
  const catalog = new DataCatalog(database);
  const records = new DataRecords(database);
  const query = new DataQuery(database);

  try {
    run(catalog, records, query);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertQueryError(
  error: unknown,
  expectedCode: DataQueryError["code"],
): boolean {
  assert.ok(error instanceof DataQueryError);
  assert.equal(error.code, expectedCode);
  return true;
}

function bootstrap(catalog: DataCatalog, records: DataRecords) {
  catalog.createSpace({
    spaceId: "crm",
    name: "CRM",
    authority: "local_canonical",
  });
  catalog.createSchema({
    spaceId: "crm",
    entity: "companies",
    name: "Companies",
    fields: {
      name: { type: "string", required: true },
    },
  });
  catalog.createSchema({
    spaceId: "crm",
    entity: "deals",
    name: "Deals",
    fields: {
      title: { type: "string", required: true },
      value: { type: "number", required: true },
      seats: { type: "integer", required: true },
      active: { type: "boolean", default: true },
      due: { type: "date", nullable: true },
      contactedAt: { type: "datetime", nullable: true },
      stage: {
        type: "enum",
        values: ["lead", "proposal", "won", "lost"],
        default: "lead",
      },
      company: { type: "reference", entity: "companies", nullable: true },
      metadata: { type: "json", nullable: true },
    },
  });

  const companies = ["Acme", "Beta", "Real", "Other"].map((name) =>
    records.create({
      spaceId: "crm",
      entity: "companies",
      data: { name },
      actor: human,
    }),
  );

  const inputs = [
    {
      title: "Alpha Campaign",
      value: 100,
      seats: 1,
      stage: "lead",
      due: "2026-09-10",
      company: companies[0]!.recordId,
    },
    {
      title: "Beta Proposal",
      value: 250,
      seats: 2,
      stage: "proposal",
      due: "2026-09-11",
      company: companies[1]!.recordId,
    },
    {
      title: "Gamma Renewal",
      value: 500,
      seats: 4,
      stage: "won",
      due: null,
      company: null,
    },
    {
      title: "100% Real",
      value: 750,
      seats: 8,
      stage: "proposal",
      due: "2026-09-12",
      company: companies[2]!.recordId,
    },
    {
      title: "1000 Real",
      value: 900,
      seats: 16,
      stage: "lost",
      due: "2026-09-13",
      company: companies[3]!.recordId,
    },
  ] as const;

  return inputs.map((data) =>
    records.create({
      spaceId: "crm",
      entity: "deals",
      data,
      actor: human,
    }),
  );
}

test("query filters equality and numeric comparison with nested boolean groups", () => {
  withQuery((catalog, records, query) => {
    bootstrap(catalog, records);

    const result = query.query({
      spaceId: "crm",
      entity: "deals",
      where: {
        and: [
          { field: "stage", op: "eq", value: "proposal" },
          {
            or: [
              { field: "value", op: "gte", value: 700 },
              { field: "title", op: "starts_with", value: "Beta" },
            ],
          },
        ],
      },
      orderBy: [{ field: "value", direction: "asc" }],
    });

    assert.deepEqual(
      result.items.map((item) => item.data.title),
      ["Beta Proposal", "100% Real"],
    );
  });
});

test("query supports not, in, not_in, and boolean equality", () => {
  withQuery((catalog, records, query) => {
    bootstrap(catalog, records);

    const result = query.query({
      spaceId: "crm",
      entity: "deals",
      where: {
        and: [
          { field: "stage", op: "in", value: ["lead", "proposal", "won"] },
          { field: "stage", op: "not_in", value: ["lost"] },
          { not: { field: "active", op: "eq", value: false } },
        ],
      },
    });

    assert.equal(result.items.length, 4);
  });
});

test("contains and starts_with escape SQL LIKE wildcard characters", () => {
  withQuery((catalog, records, query) => {
    bootstrap(catalog, records);

    const contains = query.query({
      spaceId: "crm",
      entity: "deals",
      where: { field: "title", op: "contains", value: "100%" },
    });
    assert.deepEqual(
      contains.items.map((item) => item.data.title),
      ["100% Real"],
    );

    const starts = query.query({
      spaceId: "crm",
      entity: "deals",
      where: { field: "title", op: "starts_with", value: "1000" },
    });
    assert.deepEqual(
      starts.items.map((item) => item.data.title),
      ["1000 Real"],
    );
  });
});

test("is_null and is_not_null operate on nullable declared fields", () => {
  withQuery((catalog, records, query) => {
    bootstrap(catalog, records);

    const nulls = query.query({
      spaceId: "crm",
      entity: "deals",
      where: { field: "due", op: "is_null" },
    });
    assert.deepEqual(nulls.items.map((item) => item.data.title), ["Gamma Renewal"]);

    const nonNulls = query.query({
      spaceId: "crm",
      entity: "deals",
      where: { field: "due", op: "is_not_null" },
    });
    assert.equal(nonNulls.items.length, 4);
  });
});

test("query sorting supports multiple schema fields plus stable record-id tie break", () => {
  withQuery((catalog, records, query) => {
    bootstrap(catalog, records);

    const result = query.query({
      spaceId: "crm",
      entity: "deals",
      orderBy: [
        { field: "stage", direction: "asc" },
        { field: "value", direction: "desc" },
      ],
    });

    assert.deepEqual(
      result.items.map((item) => [item.data.stage, item.data.value]),
      [
        ["lead", 100],
        ["lost", 900],
        ["proposal", 750],
        ["proposal", 250],
        ["won", 500],
      ],
    );
  });
});

test("field selection projects record data without dropping canonical metadata", () => {
  withQuery((catalog, records, query) => {
    bootstrap(catalog, records);

    const result = query.query({
      spaceId: "crm",
      entity: "deals",
      select: ["title", "value"],
      orderBy: [{ field: "value", direction: "asc" }],
      limit: 1,
    });

    const item = result.items[0]!;
    assert.deepEqual(Object.keys(item.data).sort(), ["title", "value"]);
    assert.match(item.recordId, /^rec_/);
    assert.equal(item.schemaVersion, 1);
    assert.deepEqual(item.createdBy, human);
  });
});

test("cursor pagination traverses a sorted query without duplicate rows", () => {
  withQuery((catalog, records, query) => {
    bootstrap(catalog, records);

    const base: QueryPayload = {
      spaceId: "crm",
      entity: "deals",
      orderBy: [{ field: "value", direction: "asc" }],
      limit: 2,
    };

    const first = query.query(base);
    assert.equal(first.items.length, 2);
    assert.equal(first.hasMore, true);
    assert.ok(first.nextCursor !== null);

    const second = query.query({ ...base, cursor: first.nextCursor });
    assert.equal(second.items.length, 2);
    assert.equal(second.hasMore, true);
    assert.ok(second.nextCursor !== null);

    const third = query.query({ ...base, cursor: second.nextCursor });
    assert.equal(third.items.length, 1);
    assert.equal(third.hasMore, false);
    assert.equal(third.nextCursor, null);

    const ids = [...first.items, ...second.items, ...third.items].map(
      (item) => item.recordId,
    );
    assert.equal(new Set(ids).size, 5);
    assert.deepEqual(
      [...first.items, ...second.items, ...third.items].map(
        (item) => item.data.value,
      ),
      [100, 250, 500, 750, 900],
    );
  });
});

test("cursor cannot be reused with a different query shape", () => {
  withQuery((catalog, records, query) => {
    bootstrap(catalog, records);

    const first = query.query({
      spaceId: "crm",
      entity: "deals",
      where: { field: "stage", op: "neq", value: "lost" },
      limit: 2,
    });
    assert.ok(first.nextCursor !== null);

    assert.throws(
      () =>
        query.query({
          spaceId: "crm",
          entity: "deals",
          where: { field: "stage", op: "eq", value: "proposal" },
          limit: 2,
          cursor: first.nextCursor,
        }),
      (error) => assertQueryError(error, "QUERY_INVALID"),
    );
  });
});

test("malformed and over-ceiling cursors fail visibly", () => {
  withQuery((catalog, records, query) => {
    bootstrap(catalog, records);

    assert.throws(
      () =>
        query.query({
          spaceId: "crm",
          entity: "deals",
          cursor: "not-a-valid-cursor",
        }),
      (error) => assertQueryError(error, "QUERY_INVALID"),
    );

    const base: QueryPayload = {
      spaceId: "crm",
      entity: "deals",
      limit: 50,
    };
    const fingerprint = queryFingerprint(base, 50);
    assert.throws(
      () => encodeQueryCursor(MAX_QUERY_OFFSET + 1, fingerprint),
      (error) => assertQueryError(error, "QUERY_LIMIT_EXCEEDED"),
    );
  });
});

test("server query page ceiling overrides caller request", () => {
  withQuery((catalog, records, query) => {
    bootstrap(catalog, records);

    assert.throws(
      () =>
        query.query({
          spaceId: "crm",
          entity: "deals",
          limit: DATA_PROTOCOL_LIMITS.maxQueryPageSize + 1,
        }),
      (error) => assertQueryError(error, "QUERY_LIMIT_EXCEEDED"),
    );
  });
});

test("deleted records are excluded unless includeDeleted is explicit", () => {
  withQuery((catalog, records, query) => {
    const created = bootstrap(catalog, records);
    records.softDelete({
      spaceId: "crm",
      entity: "deals",
      recordId: created[1]!.recordId,
      expectedVersion: 1,
      actor: human,
      reason: "test",
    });

    const normal = query.query({
      spaceId: "crm",
      entity: "deals",
    });
    assert.equal(normal.items.length, 4);

    const withDeleted = query.query({
      spaceId: "crm",
      entity: "deals",
      includeDeleted: true,
    });
    assert.equal(withDeleted.items.length, 5);
    assert.equal(
      withDeleted.items.filter((item) => item.deletedAt !== null).length,
      1,
    );
  });
});

test("queries reject undeclared fields even when records allow unknown fields", () => {
  withQuery((catalog, records, query) => {
    catalog.createSpace({
      spaceId: "flex",
      name: "Flex",
      authority: "local_canonical",
    });
    catalog.createSchema({
      spaceId: "flex",
      entity: "items",
      name: "Items",
      allowUnknownFields: true,
      fields: {
        title: { type: "string", required: true },
      },
    });
    records.create({
      spaceId: "flex",
      entity: "items",
      data: { title: "A", arbitrary: 123 },
      actor: human,
    });

    assert.throws(
      () =>
        query.query({
          spaceId: "flex",
          entity: "items",
          where: { field: "arbitrary", op: "eq", value: 123 },
        }),
      (error) => assertQueryError(error, "QUERY_INVALID"),
    );
  });
});

test("queries reject invalid field/operator and value-type combinations", () => {
  withQuery((catalog, records, query) => {
    bootstrap(catalog, records);

    const cases: QueryPayload[] = [
      {
        spaceId: "crm",
        entity: "deals",
        where: { field: "value", op: "contains", value: "10" },
      },
      {
        spaceId: "crm",
        entity: "deals",
        where: { field: "stage", op: "gt", value: "lead" },
      },
      {
        spaceId: "crm",
        entity: "deals",
        where: { field: "metadata", op: "eq", value: { a: 1 } },
      },
      {
        spaceId: "crm",
        entity: "deals",
        where: { field: "value", op: "eq", value: "100" },
      },
      {
        spaceId: "crm",
        entity: "deals",
        where: { field: "stage", op: "eq", value: "unknown" },
      },
      {
        spaceId: "crm",
        entity: "deals",
        where: { field: "due", op: "eq", value: "2026-02-31" },
      },
    ];

    for (const input of cases) {
      assert.throws(
        () => query.query(input),
        (error) => assertQueryError(error, "QUERY_INVALID"),
      );
    }
  });
});

test("selection and sort fields must be unique and declared", () => {
  withQuery((catalog, records, query) => {
    bootstrap(catalog, records);

    assert.throws(
      () =>
        query.query({
          spaceId: "crm",
          entity: "deals",
          select: ["title", "title"],
        }),
      (error) => assertQueryError(error, "QUERY_INVALID"),
    );

    assert.throws(
      () =>
        query.query({
          spaceId: "crm",
          entity: "deals",
          orderBy: [
            { field: "value", direction: "asc" },
            { field: "value", direction: "desc" },
          ],
        }),
      (error) => assertQueryError(error, "QUERY_INVALID"),
    );

    assert.throws(
      () =>
        query.query({
          spaceId: "crm",
          entity: "deals",
          select: ["missing"],
        }),
      (error) => assertQueryError(error, "QUERY_INVALID"),
    );
  });
});

test("SQL-looking values remain bound parameters rather than executable text", () => {
  withQuery((catalog, records, query) => {
    bootstrap(catalog, records);
    const injection = "' OR 1=1 --";
    records.create({
      spaceId: "crm",
      entity: "deals",
      data: {
        title: injection,
        value: 1000,
        seats: 1,
      },
      actor: human,
    });

    const result = query.query({
      spaceId: "crm",
      entity: "deals",
      where: { field: "title", op: "eq", value: injection },
    });

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]!.data.title, injection);
  });
});

test("aggregate computes count, sum, min, max, and avg over filtered active records", () => {
  withQuery((catalog, records, query) => {
    bootstrap(catalog, records);

    const result = query.aggregate({
      spaceId: "crm",
      entity: "deals",
      where: { field: "stage", op: "in", value: ["proposal", "won"] },
      metrics: [
        { op: "count", as: "dealCount" },
        { op: "sum", field: "value", as: "totalValue" },
        { op: "min", field: "value", as: "minValue" },
        { op: "max", field: "value", as: "maxValue" },
        { op: "avg", field: "value", as: "avgValue" },
      ],
    });

    assert.deepEqual(result.values, {
      dealCount: 3,
      totalValue: 1500,
      minValue: 250,
      maxValue: 750,
      avgValue: 500,
    });
  });
});

test("aggregate excludes soft-deleted records", () => {
  withQuery((catalog, records, query) => {
    const created = bootstrap(catalog, records);
    records.softDelete({
      spaceId: "crm",
      entity: "deals",
      recordId: created[2]!.recordId,
      expectedVersion: 1,
      actor: human,
    });

    const result = query.aggregate({
      spaceId: "crm",
      entity: "deals",
      metrics: [{ op: "count", as: "count" }],
    });
    assert.equal(result.values.count, 4);
  });
});

test("aggregate validates metric field types and unique aliases", () => {
  withQuery((catalog, records, query) => {
    bootstrap(catalog, records);

    assert.throws(
      () =>
        query.aggregate({
          spaceId: "crm",
          entity: "deals",
          metrics: [{ op: "sum", field: "title", as: "bad" }],
        }),
      (error) => assertQueryError(error, "QUERY_INVALID"),
    );

    assert.throws(
      () =>
        query.aggregate({
          spaceId: "crm",
          entity: "deals",
          metrics: [{ op: "count", field: "value", as: "bad" }],
        }),
      (error) => assertQueryError(error, "QUERY_INVALID"),
    );

    assert.throws(
      () =>
        query.aggregate({
          spaceId: "crm",
          entity: "deals",
          metrics: [
            { op: "count", as: "same" },
            { op: "sum", field: "value", as: "same" },
          ],
        }),
      (error) => assertQueryError(error, "QUERY_INVALID"),
    );
  });
});

test("aggregate returns null for min/max/avg over no matching rows while count/sum follow SQLite numeric semantics", () => {
  withQuery((catalog, records, query) => {
    bootstrap(catalog, records);

    const result = query.aggregate({
      spaceId: "crm",
      entity: "deals",
      where: { field: "value", op: "gt", value: 999999 },
      metrics: [
        { op: "count", as: "count" },
        { op: "sum", field: "value", as: "sum" },
        { op: "min", field: "value", as: "min" },
        { op: "max", field: "value", as: "max" },
        { op: "avg", field: "value", as: "avg" },
      ],
    });

    assert.deepEqual(result.values, {
      count: 0,
      sum: null,
      min: null,
      max: null,
      avg: null,
    });
  });
});
