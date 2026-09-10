# AI-Verse Data Protocol v0.1

**Status:** Protocol foundation implemented; core execution, optimistic concurrency, durable idempotency, mutation provenance, and bounded bulk preview/execute implemented through Phase 2.4  
**Date:** 2026-09-10

## 1. Purpose

This document defines the initial public operation model for AI-Verse Data. Protocol envelopes and validators are implemented, while operation execution is landing phase by phase.

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
Record id: rec_<engine-generated-id>
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

Phase 1.6 direct record execution:

- loads the current entity schema;
- validates all fields;
- applies defaults;
- rejects unknown fields unless the schema explicitly allows them;
- persists the canonical record with schema version, timestamps, and actor attribution.

The public transport and direct record mutation surfaces require `idempotencyKey`. Phase 2.2 persistently binds each successful key to a canonical request fingerprint and original committed result. A matching retry replays that result without mutating again; different reuse returns `IDEMPOTENCY_CONFLICT`. Phase 2.3 now commits an immutable event and durable receipt with each successful mutation and emits no duplicate audit fact on replay.

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

A convenience record-list operation. The protocol reserves bounded cursor pagination. The Phase 1.6 direct `DataRecords.list` surface implements bounded listing only; general cursor/query execution lands in Task 7 / 41.

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

### `data.bulk.preview`

Review a bounded set of record mutations without committing them:

```json
{
  "operations": [
    {
      "operation": "data.record.update",
      "payload": {
        "spaceId": "crm",
        "entity": "deals",
        "recordId": "rec_...",
        "expectedVersion": 3,
        "idempotencyKey": "bulk-item-1",
        "patch": {
          "stage": "won"
        }
      }
    }
  ]
}
```

Rules:

- 1..50 operations;
- maximum 256 KiB bulk payload;
- only record create/update/delete operations;
- real transaction semantics execute inside an intentional rollback;
- no canonical/supporting mutation state persists;
- preview returns an actor/operation/state-bound SHA-256 digest;
- generated IDs from preview-created records are not exposed as canonical identity.

### `data.bulk.execute`

Commit exactly the reviewed operation set:

```json
{
  "idempotencyKey": "bulk-commit-01",
  "expectedPreviewDigest": "<64 lowercase hex chars>",
  "operations": []
}
```

The operation list must still contain 1..50 valid record mutations; the empty array above is only schematic.

Execution:

1. validates hard count/byte limits;
2. validates key separation;
3. re-runs current-state preview;
4. requires its digest to equal `expectedPreviewDigest`;
5. commits through the existing bounded transaction engine;
6. returns the underlying transaction result and final transaction receipt;
7. records durable bulk idempotency so matching retries replay exactly.

Commit is always all-or-nothing. There is no v0.1 best-effort partial-success option.

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
        "idempotencyKey": "task_123:onboard-company:company",
        "clientRef": "company",
        "data": { "name": "Acme" }
      }
    },
    {
      "operation": "data.record.create",
      "payload": {
        "spaceId": "crm",
        "entity": "deals",
        "idempotencyKey": "task_123:onboard-company:deal",
        "data": {
          "title": "Acme onboarding",
          "company": { "$ref": "company" }
        }
      }
    }
  ]
}
```

Phase 1.8 locks this intra-transaction reference syntax. A create may declare a unique `clientRef`; only a later schema-declared reference field may use the exact one-key marker `{ "$ref": "clientRef" }`. It resolves to the earlier created canonical record ID. Forward references, duplicate aliases, and use outside declared reference fields are rejected.

Transaction size/count is bounded.

## 12. Event operations

### `data.events.list`

Read-only audit/change query. Phase 2.3 supports a workspace-wide stream with an empty payload or progressively narrower filters:

```json
{
  "spaceId": "crm",
  "entity": "deals",
  "recordId": "rec_01J...",
  "after": null,
  "limit": 100
}
```

`spaceId` is optional. If `entity` is present, `spaceId` is required. If `recordId` is present, both `spaceId` and `entity` are required.

Results are bounded and paginated with opaque filter-bound event cursors. Workspace-wide listing includes transaction-level events that do not belong to a single Data Space/entity.

Normal callers receive structured provenance metadata rather than internal SQL details or full record payload copies.

## 13. Health operations

### `data.doctor`

Deep read-only validation.

### `data.status`

Lightweight current status.

Both must distinguish no-data-in-workspace from broken-data-in-workspace.

## 14. Record mutation receipt

Phase 2.3 now persists one durable receipt for each successful record mutation and one final receipt for each successful bounded transaction.

Receipt-returning in-process APIs are available through `createWithReceipt`, `updateWithReceipt`, `softDeleteWithReceipt`, and `executeWithReceipt`.

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

Receipts prove a committed AI-Verse Data mutation, not external side effects elsewhere. Receipt and linked-event digests and shared fields are verified before public use.

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
ENTITY_ALREADY_EXISTS
SCHEMA_INVALID
SCHEMA_VERSION_NOT_FOUND
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


## 24. Phase 1.5 implementation note

Data Space and entity-schema execution is now implemented through `DataCatalog`. Schema definitions are persisted as validated structured JSON in a fixed internal catalog, with immutable versions and deterministic SHA-256 digests.

Direct safe updates currently execute `add_field`, `set_name`, and `set_description`. The protocol also recognizes `remove_field`, `replace_field`, and `rename_field`, but these return `SCHEMA_MIGRATION_REQUIRED` until the user-schema migration framework exists.

Field defaults are validated against their declared type and constraints before schema persistence. Direct schema-aware record CRUD, relation enforcement, race-safe optimistic concurrency, persistent idempotency, mutation events, durable receipts, and provenance queries are now implemented. Full transport dispatch and later bulk/backup/migration capabilities remain future tasks.


## 25. Phase 1.6 implementation note

Direct record CRUD is now implemented through `DataRecords` and exported from:

```text
@ai-verse/data/records
```

Canonical records now carry:

```text
spaceId
entity
recordId
schemaVersion
version
data
createdAt
updatedAt
createdBy
updatedBy
deletedAt
deletedReason
deletedBy
```

Create validates against the current schema and applies valid defaults. Get/list hide soft-deleted rows unless `includeDeleted` is explicitly requested. Update validates the stored historical payload, merges the patch, validates against the current schema, applies newly introduced defaults where appropriate, advances the record version, and records the updating actor. Soft delete preserves the row and stores deletion attribution.

Update/delete require a matching `expectedVersion`. Phase 2.1 now enforces that version atomically at the canonical storage write and includes dedicated separate-process concurrency tests.

Reference/attachment fields validate identifier shape in Phase 1.6. Reference existence and relation indexing remain Task 8 / 41.

The direct CRUD API now executes persistent idempotency semantics from Phase 2.2 and appends immutable mutation events plus durable receipts from Phase 2.3. Receipt-returning variants expose the committed receipt without breaking the existing record-returning mutation methods.


## 26. Phase 1.7 implementation note

`data.query` and `data.aggregate` now execute through `DataQuery`, exported from `@ai-verse/data/query`.

The query engine validates the structural protocol payload and then validates field/operator/value semantics against the current entity schema. Undeclared fields are not filter, sort, selection, or aggregate targets, even when an entity allows flexible unknown record fields.

SQLite compilation is parameterized. User values and JSON field paths are bound parameters; only fixed engine-controlled operator, sort-direction, and aggregate tokens become SQL syntax. `contains` and `starts_with` escape SQL LIKE wildcard characters.

Query pages use opaque base64url cursors containing a bounded offset and SHA-256 fingerprint of the query shape. The current page-size ceiling is 200 and the first cursor implementation caps offset at 100000. A cursor cannot be reused with a different query shape.

Supported aggregates are count, sum, min, max, and avg with schema-aware type rules. Normal queries and aggregates exclude soft-deleted rows unless the query operation explicitly sets `includeDeleted`; aggregate v0.1 has no deleted-row override and therefore excludes them.

Query rows pass through the same historical-schema hydration and corruption checks as ordinary record reads. Relations, cross-entity joins, and bounded multi-record transactions remain Phase 1.8.


## 27. Phase 1.8 implementation note

Declared `reference` fields now enforce target existence and active state on ordinary create/update operations. The target Data Space defaults to the source schema's Data Space unless the field definition explicitly declares another Data Space. Cross-space references remain inside the same physical workspace database.

SQLite maintains the normalized `_record_relations` index. Record and relation-index changes commit atomically. A target with active inbound references cannot be soft-deleted; deleting a source removes its outgoing relation-index rows.

`data.transaction.execute` now executes through `DataTransactions`, exported from `@ai-verse/data/transactions`. Transactions contain 1..50 record create/update/delete operations and execute atomically on one workspace database. Any nested failure rolls back the whole sequence.

The transaction-local `clientRef` mechanism is deliberately narrow. A record created earlier in the same transaction may expose a unique alias. Later create/update data may use `{ "$ref": "alias" }` only in a schema-declared reference field. The alias is replaced with the canonical generated record ID before normal record validation.

Persistent idempotency replay is implemented in Task 11 / Phase 2.2. Race-safe optimistic concurrency is implemented in Task 10 / Phase 2.1. Mutation events, durable receipts, and transaction provenance are implemented in Task 12 / Phase 2.3.


## 28. Phase 2.2 idempotency implementation note

Record create/update/delete and `data.transaction.execute` now have durable idempotent execution semantics.

A successful key is unique within one workspace database and is bound to:

- fingerprint version 1;
- operation;
- trusted actor;
- canonical semantic request fingerprint;
- original committed result;
- SHA-256 result digest;
- commit timestamp.

The idempotency key itself is excluded from request fingerprint material. Canonical JSON object-key ordering is deterministic, so equivalent objects with different property insertion order produce the same fingerprint.

Matching retries replay the original result before current record/version checks. This means a successfully committed update with `expectedVersion = 1` can later be retried safely even after the current record has advanced beyond version 2.

Different reuse of the same key returns `IDEMPOTENCY_CONFLICT`. Failed mutations do not reserve the key.

For bounded transactions, the outer key protects the entire transaction result while nested mutation keys are also persisted. All canonical data effects plus nested/outer idempotency entries share the same SQLite transaction and roll back together.

Committed v0.1 idempotency entries do not automatically expire. Phase 2.3 composes those entries atomically with immutable events and durable receipts.

Detailed contract: `docs/IDEMPOTENCY-V0.1.md`.


## 29. Phase 2.3 events, receipts, and provenance implementation note

Phase 2.3 implements immutable structured Data provenance for successful record and bounded-transaction mutations.

SQLite persists fixed engine-owned `_events` and `_mutation_receipts` tables. Normal UPDATE/DELETE operations against those tables are rejected by triggers. Events and receipts carry SHA-256 digests that are recomputed before public use, and a returned receipt is verified against its linked event.

Record events preserve operation, request ID, optional transaction ID, trusted database scope/workspace identity, idempotency key, Data Space/entity/record identity, before/after versions, trusted actor, commit time, and bounded details. Full record payloads are not copied into normal event details.

A bounded transaction assigns one transaction ID across all nested mutation provenance and emits one final `transaction.committed` event/receipt containing ordered child event and receipt IDs.

Matching idempotent replay emits no additional event or receipt and receipt-returning APIs return the original committed receipt. Fresh transactions reject nested idempotency keys already committed outside that transaction, preventing provenance laundering.

`data.events.list` supports workspace-wide or progressively scoped event queries with bounded filter-bound opaque cursors.

Detailed contract: `docs/EVENTS-RECEIPTS-PROVENANCE-V0.1.md`.


## 30. Phase 2.4 bulk implementation note

Phase 2.4 adds `data.bulk.preview` and `data.bulk.execute` plus the public `@ai-verse/data/bulk` package surface.

Preview uses the real `DataTransactions` engine inside an outer rollback-only transaction. This makes preview semantics exact while leaving no committed record, relation, idempotency, event, receipt, or event-sequence state.

Bulk execute requires a SHA-256 preview digest bound to the trusted actor, exact ordered operations, deterministic preview state summary, and all-or-nothing policy. Fresh execution re-previews current state and fails with `BULK_PREVIEW_STALE` when that digest no longer matches.

The hard limits are 50 operations and 256 KiB. Existing record/schema/reference/optimistic-concurrency/idempotency/provenance failures remain authoritative when more specific.

Bulk commit reuses the normal bounded transaction provenance. It does not add a duplicate synthetic bulk event.

Detailed contract: `docs/BULK-OPERATIONS-V0.1.md`.
