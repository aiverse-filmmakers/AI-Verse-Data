# AI-Verse Data Architecture

**Status:** Canonical architecture direction for v0.1  
**Date:** 2026-09-10  
**Implementation:** Not started

## 1. Architectural position

AI-Verse Data is a structured-data engine and protocol, not a second AI-Verse OS.

Its place in the ecosystem is:

```text
                         Operator / Clients
                                |
                                v
                        AI-Verse Dashboard
                         presentation only
                                |
                                v
                         AI-Verse OS host
                   scope / routing / permissions
                                |
              +-----------------+-----------------+
              |                 |                 |
              v                 v                 v
            Brain         Multiple Bots         Skills
         direction          coordination       capability
              |                 |                 |
              +-----------------+-----------------+
                                |
                                v
                         AI-Verse Data
                structured operational truth
                                |
                      +---------+---------+
                      |                   |
                      v                   v
                  SQLite v0.1        future driver

Memory       = historical recall
Connections  = external systems
Apps         = persistent software built on Data
```

The architecture law is:

> **Data owns structured operational records and their mutation history. It does not own operator identity, narrative context, historical memory, strategy, coordination, external credentials, scheduling, or UI.**

## 2. Host-neutral core, AI-Verse-native integration

The engine should be usable through a stable host-neutral API, while the first-class integration targets AI-Verse OS v2.

Separate these concerns:

```text
Core protocol
  - schemas
  - records
  - queries
  - mutations
  - transactions
  - events
  - receipts
  - storage-driver interface

AI-Verse adapter
  - OS v2 compatibility detection
  - workspace resolution
  - extension registration
  - host permission context
  - safe workspace database path

CLI
  - operator/developer interface

Future adapters
  - Apps
  - Dashboard
  - Multiple Bots
  - Brain host
  - Automations
  - Connections
```

No consumer should need to know SQLite file layout to use Data.

## 3. Canonical storage placement

### AI-Verse native mode

The first release is workspace-first.

Each workspace that actually uses structured Data gets one database:

```text
AI-Verse-OS/
└── workspaces/
    └── <workspace-id>/
        └── data/
            └── ai-verse-data.sqlite
```

The database is **canonical user-owned state**.

It is not runtime cache and must never be stored under `runtime/`.

It is not Memory and must never be stored under `memory/`.

It is not App-owned and must not be hidden under an App bundle merely because one App created the schema.

### Standalone mode

A standalone host may use:

```text
<project-root>/.ai-verse-data/data.sqlite
```

Standalone mode is a portability feature. If an AI-Verse manifest exists but is incompatible, the installer must fail closed rather than silently creating a standalone store beside an unsupported OS.

## 4. Why one physical database per workspace

For v0.1, one SQLite file per workspace is preferred because it gives:

- physical workspace separation;
- simple backup/export of one workspace's structured truth;
- simple path validation;
- a clear relationship with `WORKSPACE.yaml`;
- transactions across related Data Spaces in the same workspace;
- fewer database handles and migration targets;
- straightforward uninstall preservation.

A workspace database can contain multiple logical Data Spaces:

```text
workspace: commercial-ops

ai-verse-data.sqlite
  ├── space: crm
  ├── space: production
  ├── space: content
  └── space: finance-ops
```

The API should not assume this physical layout forever. A future server driver may partition differently while preserving workspace and Data Space semantics.

## 5. No Dashboard `systemId` in canonical Data identity

Dashboard assigns a local `systemId` to distinguish multiple OS installations in its own Gateway.

That `systemId` must **not** become a canonical Data identifier because Data must work when Dashboard is absent.

The canonical native scope is resolved from the trusted OS root and workspace identity:

```text
OS root
  + WORKSPACE.yaml id
  + Data Space id
  + Entity id
  + Record id
```

Dashboard may wrap requests with its own `systemId` before the OS/Data adapter resolves the corresponding root.

This prevents a presentation-layer identifier from leaking into the durable data model.

## 6. Internal SQLite model

The first implementation should use a fixed internal storage schema instead of creating arbitrary physical SQL tables from agent-generated entity definitions.

Conceptual internal tables:

```text
_meta
_data_spaces
_entity_schemas
_records
_record_relations
_events
_idempotency
_schema_migrations
```

Illustrative responsibilities:

### `_meta`

- database format version;
- engine compatibility range;
- owning workspace ID;
- creation metadata;
- migration state.

### `_data_spaces`

- stable Data Space ID;
- display name/description;
- lifecycle status;
- authority class;
- created/updated provenance.

### `_entity_schemas`

- Data Space ID;
- entity ID;
- schema version;
- schema JSON;
- content digest;
- status;
- timestamps.

### `_records`

- Data Space ID;
- entity ID;
- record ID;
- schema version;
- record version;
- canonical JSON payload;
- created/updated timestamps;
- created/updated actor references;
- soft-delete metadata.

### `_record_relations`

A normalized relation index for declared reference fields where useful. The canonical relation declaration still originates in validated record/schema semantics.

### `_events`

Append-oriented committed mutation events.

### `_idempotency`

Request fingerprint and result binding for retry-safe mutations.

### `_schema_migrations`

Engine-owned migration ledger for internal database format and future schema evolution machinery.

Exact SQL DDL is an implementation task and is not frozen by this architecture document.

## 7. Record representation

A logical record should resemble:

```json
{
  "id": "deal_01J...",
  "spaceId": "crm",
  "entity": "deals",
  "schemaVersion": 3,
  "version": 8,
  "data": {
    "title": "Campaign renewal",
    "value": 18000,
    "stage": "proposal",
    "company": "company_01J..."
  },
  "createdAt": "2026-09-10T12:00:00Z",
  "updatedAt": "2026-09-10T15:20:00Z",
  "createdBy": "human:local-operator",
  "updatedBy": "bot:sales-lead"
}
```

The transport object and SQLite row shape do not need to be identical.

## 8. Schema representation

Entity definitions are versioned structured documents validated by the Data engine.

Illustrative example:

```json
{
  "spaceId": "crm",
  "entity": "deals",
  "version": 1,
  "fields": {
    "title": { "type": "string", "required": true },
    "value": { "type": "number" },
    "stage": {
      "type": "enum",
      "values": ["lead", "proposal", "won", "lost"]
    },
    "company": {
      "type": "reference",
      "target": "crm.companies"
    }
  }
}
```

Agent-generated schema proposals are data, not SQL.

The engine validates and applies supported schema changes through its own migration rules.

## 9. Public field type system

Keep v0.1 intentionally small:

```text
string
integer
number
boolean
date
datetime
enum
reference
json
attachment_ref
```

The storage layer may use SQLite `TEXT`, `INTEGER`, `REAL`, `BLOB`, JSON functions, and indexes internally, but those SQL details do not become the public type contract.

## 10. Safe query architecture

Agents and Apps should submit a structured query AST, not SQL text.

Example:

```json
{
  "spaceId": "crm",
  "entity": "deals",
  "where": {
    "and": [
      { "field": "stage", "op": "eq", "value": "proposal" },
      { "field": "value", "op": "gte", "value": 10000 }
    ]
  },
  "orderBy": [
    { "field": "value", "direction": "desc" }
  ],
  "limit": 50
}
```

The engine:

1. validates the workspace and Data Space;
2. validates the entity and current schema;
3. validates every field/operator/value;
4. enforces caller limits and capability scope;
5. compiles to parameterized driver operations;
6. executes through the storage driver;
7. returns bounded structured results.

No user/model string concatenation should become SQL.

## 11. Safe mutation architecture

A mutation envelope should carry trusted execution context separately from model-supplied data.

Conceptually:

```json
{
  "requestId": "req_...",
  "idempotencyKey": "task_123:update:deal_42:v7",
  "scope": {
    "workspaceId": "sales"
  },
  "actor": {
    "kind": "bot",
    "id": "sales-lead"
  },
  "operation": "record.update",
  "target": {
    "spaceId": "crm",
    "entity": "deals",
    "recordId": "deal_42"
  },
  "expectedVersion": 7,
  "patch": {
    "next_action": "Send revised proposal"
  }
}
```

The model may propose target/data values, but trusted host integration must bind scope and effective authority outside the model text.

## 12. Optimistic concurrency

Every mutable record has a monotonically increasing version.

Update flow:

```text
read record version 7
      ↓
prepare patch against version 7
      ↓
commit only if current version still 7
      ↓
new version 8
```

If the current version is already 8, return a structured conflict rather than silently overwriting it.

This is especially important when several Bots, Apps, or Dashboard clients operate simultaneously.

## 13. Idempotency

Agent/automation writes can be retried after timeouts or process crashes.

For mutation-capable API calls, the engine should support an idempotency key bound to:

- workspace;
- operation;
- target;
- canonical request fingerprint.

Replaying the same key and same fingerprint returns the prior committed receipt.

Reusing the same key with a different fingerprint fails explicitly.

Idempotency does not replace optimistic concurrency. They solve different failure modes.

## 14. Transaction model

The public API should permit a bounded transaction consisting of validated Data mutations within one workspace database.

Example:

```text
create company
create contact linked to company
create deal linked to company
```

Either all commit or none commit.

Cross-workspace transactions are not supported in v0.1.

Future storage drivers must preserve equivalent atomicity within their supported transaction boundary.

## 15. Delete semantics

Default delete is soft delete:

```text
active -> deleted
```

The record remains available for audit/recovery/history operations but disappears from normal queries.

Hard purge is not a normal first-release agent operation. It should be a separate future administrative capability with stronger policy, explicit intent, and appropriate retention rules.

## 16. Event architecture

Every committed canonical mutation should append a structured event in the same transaction where practical.

Example:

```json
{
  "eventId": "evt_...",
  "type": "record.updated",
  "workspaceId": "sales",
  "spaceId": "crm",
  "entity": "deals",
  "recordId": "deal_42",
  "beforeVersion": 7,
  "afterVersion": 8,
  "changedFields": ["next_action"],
  "actor": "bot:sales-lead",
  "occurredAt": "2026-09-10T15:20:00Z"
}
```

Events are facts about Data state changes. They are not automation schedules and they are not automatically AI-Verse Memory entries.

External consumers may subscribe through future adapters.

## 17. Receipt architecture

Every committed mutation returns a receipt sufficient to prove what the engine committed:

- request ID;
- idempotency binding when present;
- workspace ID;
- Data Space/entity/record ID;
- previous/new version;
- event ID;
- actor attribution;
- commit timestamp;
- effect class;
- storage/engine version metadata where useful.

A trace ID is correlation only. The mutation receipt is the stronger proof of a Data effect.

## 18. Storage-driver boundary

The public protocol must target a driver interface rather than `better-sqlite3` or another package directly.

Conceptually:

```ts
interface DataStorageDriver {
  open(scope: StorageScope): Promise<StorageSession>
  health(scope: StorageScope): Promise<StorageHealth>
  migrate(scope: StorageScope): Promise<MigrationResult>
  executeQuery(request: CompiledQuery): Promise<QueryResult>
  executeMutation(request: CompiledMutation): Promise<MutationResult>
  executeTransaction(request: CompiledTransaction): Promise<TransactionResult>
  backup(request: BackupRequest): Promise<BackupReceipt>
}
```

The first implementation may use a synchronous SQLite library behind an async-compatible service boundary.

The initial preferred implementation candidate is `better-sqlite3` because it is mature, local, actively maintained, and ships current prebuilds. The architecture does not expose its API publicly. Node's built-in `node:sqlite` remains a future option when its release-candidate API reaches the stability level we want for a long-lived extension.

## 19. SQLite configuration direction

The implementation should validate its actual SQLite capabilities at startup rather than assuming them.

Expected local defaults include:

- foreign keys enabled;
- WAL mode for local workspace databases where supported;
- bounded busy timeout;
- STRICT internal tables where practical;
- transactional DDL/migrations where supported;
- integrity/quick checks through `doctor`;
- parameterized statements only;
- explicit checkpoint/backup behavior.

SQLite WAL supports concurrent readers with a writer but only one writer proceeds at a time. The engine should therefore keep write transactions short and rely on optimistic record versions rather than long-lived write locks.

WAL databases must remain on a local filesystem. A future team/server deployment should use a server driver instead of sharing one WAL file over a network filesystem.

## 20. JSON storage direction

User-defined record payloads may be stored canonically as normalized JSON text inside fixed STRICT internal tables.

The engine validates payloads against AI-Verse Data schemas before persistence.

SQLite JSON functions can support filtering/indexing where useful, but the public query language must remain engine-neutral.

Avoid relying on SQLite JSONB as a portable external file format. SQLite documents JSONB as its internal representation and applications should treat it as opaque.

## 21. Schema evolution

Two schema layers must stay distinct:

### Internal storage schema

Owned by AI-Verse Data itself. Versioned migrations update `_records`, `_events`, etc.

### User entity schemas

Owned as Data definitions inside a Data Space.

For first release, prefer additive entity-schema evolution:

- add optional field;
- add required field only with a valid default/backfill plan;
- add enum values;
- add compatible constraints;
- deprecate fields without immediately destroying stored values.

Destructive changes such as removing fields, narrowing types, or deleting entities require explicit migration machinery and should not be improvised by a model.

## 22. Attachments

Large files should stay outside SQLite.

A record stores a trusted reference such as:

```json
{
  "type": "attachment_ref",
  "ref": "workspace://production/assets/video-001.mov",
  "digest": "sha256:..."
}
```

The host resolves the reference under workspace policy.

Data does not become a media object store.

## 23. Backup and portability

Canonical databases require explicit backup/export semantics.

The engine should eventually support:

```text
data backup
  -> consistent SQLite backup
  -> manifest with workspace/database format/schema metadata
  -> digest
  -> receipt
```

Export/import should be a separate portable format from low-level SQLite file copying where possible.

Uninstall must never count as backup.

## 24. Failure philosophy

The engine should fail closed on:

- workspace identity mismatch;
- database metadata claiming another workspace;
- symlink/path escape;
- unsupported database format version;
- incomplete migration;
- corrupt canonical storage;
- malformed schema;
- invalid query field/operator;
- idempotency collision;
- optimistic-concurrency conflict;
- unauthorized operation;
- requested cross-workspace access without an explicit future contract.

It should not turn serious failures into an empty list or a fake successful response.

## 25. Architectural invariants

1. One workspace cannot access another workspace's database through user/model-supplied paths.
2. Canonical Data never lives in `runtime/`.
3. Data never writes atomic Memory entries as a side effect of ordinary CRUD.
4. Memory indexes never become Data authority.
5. Apps never become the sole owner of structured records that Data declares canonical.
6. Dashboard never opens or mutates canonical SQLite directly from the browser.
7. Models never receive arbitrary SQL authority by default.
8. Every committed mutation is versioned and attributable.
9. Installation/registration does not grant write permission.
10. Uninstall preserves canonical records by default.
11. Data remains usable without Brain, Memory, Bots, Skills, Apps, Connections, or Dashboard installed.
12. Future drivers may change physical storage without changing the conceptual public contract.
