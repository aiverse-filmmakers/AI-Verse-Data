import assert from "node:assert/strict";
import test from "node:test";

import {
  DATA_PROTOCOL_LIMITS,
  DATA_PROTOCOL_VERSION,
  DataProtocolValidationError,
  validateFieldDefinition,
  validateQueryFilter,
  validateRequestEnvelope,
  validateResponseEnvelope,
} from "../src/protocol/index.js";

function base(operation: string, payload: unknown): unknown {
  return {
    protocol: DATA_PROTOCOL_VERSION,
    requestId: "req_01JTEST123",
    operation,
    scope: { workspaceId: "sales" },
    actor: { kind: "bot", id: "sales-bot" },
    authorization: {
      mode: "host-bound",
      capabilityRefs: ["lease:123"],
    },
    payload,
  };
}

function rejects(fn: () => unknown, code?: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof DataProtocolValidationError);
    if (code !== undefined) assert.equal(error.code, code);
    return true;
  });
}

test("accepts documented record update envelope", () => {
  const request = validateRequestEnvelope(
    base("data.record.update", {
      spaceId: "crm",
      entity: "deals",
      recordId: "deal_01J",
      expectedVersion: 7,
      idempotencyKey: "task_123:update",
      patch: { stage: "won" },
    }),
  );
  assert.equal(request.operation, "data.record.update");
});

test("rejects unknown protocol and operation explicitly", () => {
  rejects(
    () => validateRequestEnvelope(base("data.magic", {})),
    "OPERATION_UNSUPPORTED",
  );

  const wrongProtocol = {
    ...(base("data.status", {}) as Record<string, unknown>),
    protocol: "ai-verse-data/9.9",
  };
  rejects(() => validateRequestEnvelope(wrongProtocol), "REQUEST_INVALID");
});

test("rejects unknown envelope and payload fields", () => {
  rejects(() =>
    validateRequestEnvelope({
      ...(base("data.status", {}) as object),
      extra: true,
    }),
  );
  rejects(() =>
    validateRequestEnvelope(
      base("data.space.get", { spaceId: "crm", rawSql: "select 1" }),
    ),
  );
});

test("workspace and logical identifiers cannot be filesystem paths", () => {
  rejects(() =>
    validateRequestEnvelope({
      ...(base("data.space.get", { spaceId: "crm" }) as object),
      scope: { workspaceId: "../other" },
    }),
  );
  rejects(() =>
    validateRequestEnvelope(base("data.space.get", { spaceId: "../../crm" })),
  );
});

test("schema field definitions validate types and enum uniqueness", () => {
  validateFieldDefinition({ type: "string", required: true, maxLength: 100 });
  validateFieldDefinition({ type: "enum", values: ["lead", "won"] });
  rejects(() =>
    validateFieldDefinition({ type: "enum", values: ["won", "won"] }),
  );
  rejects(() => validateFieldDefinition({ type: "integer", min: 1.5 }));
});

test("schema create enforces field count and field names", () => {
  rejects(() =>
    validateRequestEnvelope(
      base("data.schema.create", {
        spaceId: "crm",
        entity: "deals",
        name: "Deals",
        fields: { "bad-field": { type: "string" } },
      }),
    ),
  );

  const fields = Object.fromEntries(
    Array.from(
      { length: DATA_PROTOCOL_LIMITS.maxSchemaFields + 1 },
      (_, index) => [`f${index}`, { type: "string" }],
    ),
  );
  rejects(() =>
    validateRequestEnvelope(
      base("data.schema.create", {
        spaceId: "crm",
        entity: "deals",
        name: "Deals",
        fields,
      }),
    ),
  );
});

test("query AST supports boolean groups and bounded depth", () => {
  validateQueryFilter({
    and: [
      { field: "stage", op: "eq", value: "proposal" },
      { field: "value", op: "gte", value: 10000 },
    ],
  });

  let nested: unknown = { field: "x", op: "eq", value: 1 };
  for (let index = 0; index < DATA_PROTOCOL_LIMITS.maxFilterDepth + 1; index += 1) {
    nested = { not: nested };
  }
  rejects(() => validateQueryFilter(nested));
});

test("in operator enforces bounded non-empty arrays", () => {
  rejects(() => validateQueryFilter({ field: "stage", op: "in", value: [] }));
  rejects(() =>
    validateQueryFilter({
      field: "stage",
      op: "in",
      value: Array(DATA_PROTOCOL_LIMITS.maxInListLength + 1).fill("x"),
    }),
  );
});

test("record list rejects cursor fields; cursor pagination belongs to data.query", () => {
  rejects(() =>
    validateRequestEnvelope(
      base("data.record.list", {
        spaceId: "crm",
        entity: "deals",
        limit: 10,
        cursor: "opaque-cursor",
      }),
    ),
  );
});

test("query, aggregate and transaction limits are enforced", () => {
  rejects(() =>
    validateRequestEnvelope(
      base("data.query", {
        spaceId: "crm",
        entity: "deals",
        limit: DATA_PROTOCOL_LIMITS.maxQueryPageSize + 1,
      }),
    ),
  );
  rejects(() =>
    validateRequestEnvelope(
      base("data.aggregate", {
        spaceId: "crm",
        entity: "deals",
        metrics: [],
      }),
    ),
  );
  rejects(() =>
    validateRequestEnvelope(
      base("data.transaction.execute", {
        idempotencyKey: "txn-key",
        operations: [],
      }),
    ),
  );
});

test("transaction rejects unsupported nested operations", () => {
  rejects(() =>
    validateRequestEnvelope(
      base("data.transaction.execute", {
        idempotencyKey: "txn-key",
        operations: [{ operation: "data.schema.create", payload: {} }],
      }),
    ),
  );
});

test("record JSON rejects non-finite values and oversize payloads", () => {
  rejects(() =>
    validateRequestEnvelope(
      base("data.record.create", {
        spaceId: "crm",
        entity: "deals",
        idempotencyKey: "x",
        data: { value: Number.NaN },
      }),
    ),
  );

  const huge = "x".repeat(DATA_PROTOCOL_LIMITS.maxRecordBytes);
  rejects(() =>
    validateRequestEnvelope(
      base("data.record.create", {
        spaceId: "crm",
        entity: "deals",
        idempotencyKey: "x",
        data: { huge },
      }),
    ),
  );
});

test("response envelopes validate stable success and failure forms", () => {
  validateResponseEnvelope({
    protocol: DATA_PROTOCOL_VERSION,
    requestId: "req_01JTEST123",
    ok: true,
    result: { items: [] },
    warnings: [],
  });

  validateResponseEnvelope({
    protocol: DATA_PROTOCOL_VERSION,
    requestId: "req_01JTEST123",
    ok: false,
    error: {
      code: "RECORD_NOT_FOUND",
      message: "missing",
      retryable: false,
      details: { recordId: "deal_1" },
    },
  });

  rejects(() =>
    validateResponseEnvelope({
      protocol: DATA_PROTOCOL_VERSION,
      requestId: "req_01JTEST123",
      ok: false,
      error: { code: "MADE_UP", message: "x", retryable: false },
    }),
  );
});

test("raw SQL and database-path extras are rejected", () => {
  rejects(() =>
    validateRequestEnvelope(
      base("data.query", {
        spaceId: "crm",
        entity: "deals",
        sql: "DROP TABLE records",
      }),
    ),
  );
  rejects(() =>
    validateRequestEnvelope(
      base("data.record.get", {
        spaceId: "crm",
        entity: "deals",
        recordId: "deal_1",
        databasePath: "/tmp/x.sqlite",
      }),
    ),
  );
});


test("field defaults must satisfy their declared field type and constraints", () => {
  validateFieldDefinition({
    type: "string",
    minLength: 1,
    maxLength: 10,
    default: "ready",
  });
  validateFieldDefinition({
    type: "date",
    default: "2026-09-10",
  });
  validateFieldDefinition({
    type: "datetime",
    default: "2026-09-10T12:00:00Z",
  });
  validateFieldDefinition({
    type: "string",
    nullable: true,
    default: null,
  });

  rejects(() =>
    validateFieldDefinition({
      type: "integer",
      default: 1.5,
    }),
  );
  rejects(() =>
    validateFieldDefinition({
      type: "enum",
      values: ["lead", "won"],
      default: "lost",
    }),
  );
  rejects(() =>
    validateFieldDefinition({
      type: "string",
      default: null,
    }),
  );
});

test("protocol recognizes destructive schema changes so the catalog can return migration-required", () => {
  for (const change of [
    { op: "remove_field", field: "value" },
    {
      op: "replace_field",
      field: "value",
      definition: { type: "string" },
    },
    { op: "rename_field", field: "value", newField: "amount" },
  ]) {
    const request = validateRequestEnvelope(
      base("data.schema.update", {
        spaceId: "crm",
        entity: "deals",
        expectedSchemaVersion: 1,
        changes: [change],
      }),
    );
    assert.equal(request.operation, "data.schema.update");
  }
});
