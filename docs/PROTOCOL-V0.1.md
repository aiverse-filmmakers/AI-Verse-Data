# AI-Verse Data Protocol v0.1

**Status:** Pre-implementation protocol specification  
**Date:** 2026-09-10

## 1. Purpose

This document defines the initial public operation model for AI-Verse Data before implementation begins.

The protocol is intentionally higher-level than SQL. It describes structured operations that can be used by a CLI, Bots, Apps, Dashboard, Skills, Automations, and future remote/server drivers.

The protocol must remain storage-driver neutral.

## 2. Core principles

1. Every native operation is bound to one trusted workspace scope.
2. Callers use Data Space/entity/record IDs, not database paths.
3. Raw SQL is not part of the normal public agent/API contract.
4. Reads are bounded.
5. Writes are schema-validated.
6. Mutations are version-aware.
7. Agent/automation writes support idempotency.
8. Committed writes return durable receipts.
9. Errors are structured and fail visibly.
10. Registration/installation does not grant Data authority.

## 3. Protocol envelope

Illustrative request envelope:

```json
{
  "protocol": "ai-verse-data/0.1",
  "requestId": "req_01J...",
  "operation": "data.record.update",
  "scope": {
    "workspaceId": "sales"
  },
  "actor": {
    "kind": "bot",
    "id": "sales-lead"
  },
  "authorization": {
    "mode": "host-bound",
    "capabilityRefs": ["lease_..."]
  },
  "payload": {}
}
```

The exact transport can be CLI JSON, local subprocess, RPC, or in-process API. The semantic envelope remains stable.

### Trusted fields

In host-integrated mode, the Data adapter must bind trusted scope/authorization from host state rather than trusting model-generated JSON.

A model may propose a logical target and values. It cannot self-grant workspace membership or capability authority.

## 4. Response envelope

Success:

```json
{
  "protocol": "ai-verse-data/0.1",
  "requestId": "req_01J...",
  "ok": true,
  "result": {},
  "warnings": []
}
```

Failure:

```json
{
  "protocol": "ai-verse-data/0.1",
  "requestId": "req_01J...",
  "ok": false,
  "error": {
    "code": "RECORD_VERSION_CONFLICT",
    "message": "Record changed since expectedVersion 7.",
    "retryable": false,
    "details": {
      "expectedVersion": 7,
      "currentVersion": 8
    }
  }
}
```

## 5. Identifiers

IDs must be stable opaque identifiers or validated slugs depending on object type.

Recommended conventions:

```text
Data Space id: crm
Entity id: deals
Record id: deal_<ulid-or-similar>
Event id: evt_<ulid-or-similar>
Request id: req_<ulid-or-similar>
Transaction id: txn_<ulid-or-similar>
```

Do not derive authorization from prefixes.

Workspace ID is verified against the host workspace manifest.

## 6. Data Space operations

### `data.space.list`

Returns visible Data Spaces in the active workspace.

### `data.space.get`

Input:

```json
{ "spaceId": "crm" }
```

Returns metadata and current schema summary.

### `data.space.create`

Input:

```json
{
  "spaceId": "crm",
  "name": "CRM",
  "description": "Customer and deal records",
  "authority": "local_canonical"
}
```

First release accepts only `local_canonical` as canonical authority class.

Creating a space is a canonical mutation and returns a mutation receipt.

## 7. Schema operations

### `data.schema.list`

Input:

```json
{ "spaceId": "crm" }
```

### `data.schema.get`

Input:

```json
{
  "spaceId": "crm",
  "entity": "deals",
  "version": "current"
}
```

### `data.schema.create`

Input:

```json
{
  "spaceId": "crm",
  "entity": "deals",
  "name": "Deals",
  "fields": {
    "title": { "type": "string", "required": true },
    "value": { "type": "number" },
    "stage": {
      "type": "enum",
      "values": ["lead", "proposal", "won", "lost"]
    }
  }
}
```

### `data.schema.update`

First-release direct updates should be restricted to compatible/additive evolution.

Input includes:

```json
{
  "spaceId": "crm",
  "entity": "deals",
  "expectedSchemaVersion": 1,
  "changes": []
}
```

Unsupported destructive changes return a migration-required error rather than generating ad-hoc SQL.

## 8. Record operations

### `data.record.create`

```json
{
  "spaceId": "crm",
  "entity": "deals",
  "idempotencyKey": "task_123:create:deal:campaign-renewal",
  "data": {
    "title": "Campaign renewal",
    "value": 18000,
    "stage": "proposal"
  }
}
```

The engine:

- loads current entity schema;
- validates all fields;
- applies defaults;
- rejects unknown fields unless schema explicitly allows them;
- checks idempotency;
- inserts record and event transactionally;
- returns record and receipt.

### `data.record.get`

```json
{
  "spaceId": "crm",
  "entity": "deals",
  "recordId": "deal_01J...",
  "includeDeleted": false
}
```

### `data.record.list`

A convenience form of query with safe pagination.

```json
{
  "spaceId": "crm",
  "entity": "deals",
  "limit": 50,
  "cursor": null
}
```

### `data.record.update`

```json
{
  "spaceId": "crm",
  "entity": "deals",
  "recordId": "deal_01J...",
  "expectedVersion": 7,
  "idempotencyKey": "task_123:update:deal_01J:v7",
  "patch": {
    "stage": "won"
  }
}
```

An update must not default to last-write-wins.

### `data.record.delete`

Soft delete by default.

```json
{
  "spaceId": "crm",
  "entity": "deals",
  "recordId": "deal_01J...",
  "expectedVersion": 8,
  "idempotencyKey": "task_123:delete:deal_01J:v8",
  "reason": "duplicate record"
}
```

Hard purge is not part of the normal v0.1 record mutation API.

## 9. Query operations

### `data.query`

General bounded query:

```json
{
  "spaceId": "crm",
  "entity": "deals",
  "select": ["id", "title", "value", "stage"],
  "where": {
    "and": [
      { "field": "stage", "op": "eq", "value": "proposal" },
      { "field": "value", "op": "gte", "value": 10000 }
    ]
  },
  "orderBy": [
    { "field": "value", "direction": "desc" }
  ],
  "limit": 50,
  "cursor": null
}
```

Initial operators:

```text
eq
neq
lt
lte
gt
gte
in
not_in
contains
starts_with
is_null
is_not_null
```

Operators are accepted only when valid for the field type.

Queries should reject unbounded limits. The server/engine enforces a maximum regardless of caller input.

## 10. Aggregate operations

### `data.aggregate`

Initial aggregation can stay conservative:

```text
count
sum
min
max
avg
```

Example:

```json
{
  "spaceId": "crm",
  "entity": "deals",
  "where": {
    "field": "stage",
    "op": "eq",
    "value": "proposal"
  },
  "metrics": [
    { "op": "count", "as": "dealCount" },
    { "op": "sum", "field": "value", "as": "pipelineValue" }
  ]
}
```

Complex arbitrary expressions are deferred.

## 11. Transaction operation

### `data.transaction.execute`

A bounded transaction contains a sequence of supported mutations in the same workspace database.

```json
{
  "idempotencyKey": "task_123:onboard-company:acme",
  "operations": [
    {
      "operation": "data.record.create",
      "payload": {
        "spaceId": "crm",
        "entity": "companies",
        "clientRef": "company",
        "data": { "name": "Acme" }
      }
    },
    {
      "operation": "data.record.create",
      "payload": {
        "spaceId": "crm",
        "entity": "deals",
        "data": {
          "title": "Acme onboarding",
          "company": { "$ref": "company" }
        }
      }
    }
  ]
}
```

The exact intra-transaction reference syntax is implementation work, but the protocol must support safe creation of related records without exposing SQL.

Transaction size/count is bounded.

## 12. Event operations

### `data.events.list`

Read-only audit/change query:

```json
{
  "spaceId": "crm",
  "entity": "deals",
  "recordId": "deal_01J...",
  "after": null,
  "limit": 100
}
```

Normal callers receive redacted/structured event metadata rather than internal SQL details.

## 13. Health operations

### `data.doctor`

Deep read-only validation.

### `data.status`

Lightweight current status.

Both must distinguish no-data-in-workspace from broken-data-in-workspace.

## 14. Record mutation receipt

Canonical mutation receipt example:

```json
{
  "receiptId": "rcpt_01J...",
  "requestId": "req_01J...",
  "operation": "data.record.update",
  "workspaceId": "sales",
  "spaceId": "crm",
  "entity": "deals",
  "recordId": "deal_01J...",
  "beforeVersion": 7,
  "afterVersion": 8,
  "eventId": "evt_01J...",
  "actor": {
    "kind": "bot",
    "id": "sales-lead"
  },
  "committedAt": "2026-09-10T15:20:00Z"
}
```

Receipts prove Data mutation, not external side effects elsewhere.

## 15. Actor model

Initial actor kinds should be extensible:

```text
human
bot
worker
app
automation
system
import
connection
```

The Data core stores attribution. It does not authenticate human accounts itself.

Trusted host integration is responsible for establishing the actor identity.

## 16. Authorization model

The protocol separates requested operation from effective authorization.

A model-supplied request such as:

```json
{ "capabilities": ["data:*:*:write"] }
```

must never grant itself that authority.

In native agent use, capability context is bound by the host/Bot/Task adapter.

Direct local CLI use can operate under an explicit local-operator mode with workspace selection and any additional confirmation policy defined by the CLI.

## 17. Capability naming direction

Illustrative capability identifiers:

```text
data:<space>:<entity>:read
data:<space>:<entity>:create
data:<space>:<entity>:update
data:<space>:<entity>:delete
data:<space>:schema:read
data:<space>:schema:manage
```

Wildcards may be supported internally for policy composition but should be used carefully.

Exact capability syntax is not considered final until implementation proves it against Multiple Bots and OS permission contracts.

## 18. Pagination

Use opaque cursors rather than trusting arbitrary SQL offsets as the long-term API.

The first engine may implement the cursor using stable sort keys internally.

Responses include:

```json
{
  "items": [],
  "nextCursor": "...",
  "hasMore": true
}
```

The engine enforces maximum page sizes.

## 19. Error codes

Initial stable categories should include:

```text
DATA_NOT_INSTALLED
DATA_DISABLED
WORKSPACE_NOT_FOUND
WORKSPACE_INACTIVE
WORKSPACE_ID_MISMATCH
DATA_SPACE_NOT_FOUND
DATA_SPACE_ALREADY_EXISTS
ENTITY_NOT_FOUND
SCHEMA_INVALID
SCHEMA_VERSION_CONFLICT
SCHEMA_MIGRATION_REQUIRED
RECORD_NOT_FOUND
RECORD_VERSION_CONFLICT
FIELD_UNKNOWN
FIELD_INVALID
REFERENCE_INVALID
QUERY_INVALID
QUERY_LIMIT_EXCEEDED
PERMISSION_DENIED
APPROVAL_REQUIRED
IDEMPOTENCY_CONFLICT
TRANSACTION_INVALID
DATABASE_UNAVAILABLE
DATABASE_CORRUPT
DATABASE_MIGRATION_REQUIRED
DATABASE_VERSION_UNSUPPORTED
PATH_UNSAFE
INTERNAL_ERROR
```

Callers should not parse human error messages to determine behavior.

## 20. Limits

The implementation must define bounded defaults for:

- maximum request bytes;
- maximum schema fields;
- maximum record JSON size;
- maximum query page size;
- maximum filter depth;
- maximum `in` list length;
- maximum sort keys;
- maximum aggregate metrics;
- maximum transaction operations;
- maximum event page size;
- maximum attachment-ref metadata size.

Limits should be configurable only within safe host policy.

## 21. Protocol versioning

Public requests declare a protocol major/minor.

Breaking semantic changes require a new major.

Additive response fields should be tolerated by consumers.

Unknown operation names fail explicitly.

Stored database format version is separate from public protocol version.

Entity schema version is separate from both.

Do not collapse these version numbers into one global `version`.

## 22. Transport independence

The same semantic operation should be able to travel over:

- CLI JSON stdin/stdout;
- in-process TypeScript client;
- local JSON subprocess;
- localhost RPC;
- Dashboard Gateway adapter;
- future server/API transport.

The first implementation should choose the smallest reliable transport while keeping protocol types transport-neutral.

## 23. Protocol invariants

1. No public agent operation accepts a database filesystem path.
2. No normal operation accepts arbitrary SQL text.
3. Workspace scope is trusted host state in native mode.
4. Queries are bounded even when caller asks for more.
5. Writes validate against current schema.
6. Updates/deletes use expected record versions.
7. Retry-safe mutation paths use idempotency.
8. Successful mutations return receipts and append events.
9. Error codes are machine-readable.
10. Protocol version, database format version, engine version, and entity schema version remain distinct.
