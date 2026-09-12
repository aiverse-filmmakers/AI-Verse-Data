# AI-Verse Data Architecture

**Status:** Canonical architecture direction for v0.1  
**Date:** 2026-09-10  
**Implementation:** Phase 1 and Phase 2 complete; Phase 3 native integration complete (8/8): compatibility detection, hardened installation, workspace resolver plus init, instruction discovery, CLI lifecycle, doctor plus status, coexistence proof, and acceptance gate

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

Phase 3.1 implements the first AI-Verse adapter boundary: a read-only compatibility detector verifies the OS v2 `unified-workspace` manifest, required native host structure, trusted path safety, and the local extension registry contract before native mutation is allowed. It returns explicit `compatible`, `no-os`, or `incompatible` state.

Phase 3.2 builds on that result with hardened local extension materialization and registration. It owns only `.aiverse/extensions/ai-verse-data/` and the `ai-verse-data` registry entry, preserves unrelated/unknown registry state, serializes shared writes with the OS registry lock, detects lost updates, and never initializes workspace databases.

Phase 3.3 adds ID-only native workspace resolution plus active-only explicit Data initialization with seven-state existing-database discovery.

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
_aiverse_meta
_data_spaces
_entities
_entity_schema_versions
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

### `_entities`

- stable Data Space/entity identity;
- current schema version pointer;
- current schema digest;
- created/updated timestamps.

### `_entity_schema_versions`

- Data Space ID;
- entity ID;
- immutable schema version;
- validated canonical schema JSON;
- deterministic SHA-256 digest;
- version creation timestamp.

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

A normalized relation index for declared reference fields. The canonical relation declaration originates in validated schema/record semantics; the index supports target existence, inbound-reference checks, and atomic relation maintenance.

### `_events`

Append-oriented committed mutation events.

### `_idempotency`

Request fingerprint and result binding for retry-safe mutations.

### `_schema_migrations`

Engine-owned migration ledger for internal database format and future schema evolution machinery.

The catalog, `_records`, `_record_relations`, `_idempotency`, `_events`, `_mutation_receipts`, and the engine-owned `_schema_migrations` ledger are implemented. Phase 2.6 advances the internal SQLite format to version 2 with explicit migration inspection/execution and verified pre-migration backups. Phase 2.7 implements governed user entity-schema migration/backfill behavior, and Phase 2.8 adds corruption quarantine/recovery staging.

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

Phase 1.7 implements the query path through `DataQueryStorage` and the SQLite `SqliteQueryStorage` driver. Query values and JSON field paths are bound parameters, cursors are opaque and bounded, and returned rows reuse canonical historical-schema hydration.

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

Phase 1.8 implements this boundary for up to 50 record create/update/delete operations. Nested mutations reuse the normal record engine, so schema and reference rules are not bypassed. A later declared reference field may resolve an earlier transaction-local `clientRef` to its generated canonical record ID.

Cross-workspace transactions are not supported in v0.1.

Future storage drivers must preserve equivalent atomicity within their supported transaction boundary.

## 13.1 Implemented optimistic concurrency

Phase 2.1 makes record versions a true canonical compare-and-swap boundary.

Update and soft-delete SQL statements match the caller's validated `expectedVersion` directly. Record mutations and outer bounded write transactions request short immediate write intent from the storage driver, preventing WAL read-snapshot upgrade races while still requiring optimistic version agreement.

The engine does not create record locks, silently merge stale patches, or automatically retry semantic conflicts.

Detailed contract: `docs/OPTIMISTIC-CONCURRENCY-V0.1.md`.

## 13.2 Implemented durable idempotency

Phase 2.2 adds one workspace-database-global idempotency namespace for record mutations and bounded transactions.

A committed key is bound to operation, trusted actor, canonical request fingerprint version 1, and the original committed result. Equivalent JSON object key order produces the same SHA-256 fingerprint; semantic differences produce a conflict.

The idempotency lookup, fresh canonical mutation, relation changes, and saved replay result share one short write transaction. Failed mutations leave no durable reservation. Matching retries return the original committed result before current record/version checks.

Committed v0.1 entries do not automatically expire.

Detailed contract: `docs/IDEMPOTENCY-V0.1.md`.

## 13.3 Implemented events, receipts, and provenance

Phase 2.3 adds an immutable audit layer inside the same canonical workspace database.

Every fresh successful record mutation appends one event and one durable receipt. Every fresh successful bounded transaction retains its nested mutation provenance and appends one final `transaction.committed` event/receipt.

Canonical record/relation changes, event/receipt rows, and idempotency state share the existing short SQLite write transaction. A failure rolls all of them back. An idempotent replay exits before provenance creation, so no duplicate audit facts are minted.

Provenance writing is an engine-internal capability. The public `@ai-verse/data/provenance` surface is read-only and validates event/receipt digests plus receipt-event linkage.

Events preserve bounded mutation metadata instead of copying full record payloads. They remain Data audit facts and are not automatic Memory.

Fresh transactions additionally reject nested idempotency provenance committed outside the current transaction, preventing an old mutation from being represented as a new transaction child.

Detailed contract: `docs/EVENTS-RECEIPTS-PROVENANCE-V0.1.md`.

## 14.1 Implemented relation integrity

Phase 1.8 enforces declared reference targets on ordinary CRUD and transaction operations.

A reference target must exist, be active, and match the schema-declared Data Space/entity. Reference fields may target another Data Space only inside the same workspace database.

Canonical record mutations and normalized relation-index changes share the same storage transaction. Active inbound references block target soft deletion, preventing dangling canonical relationships.

Detailed contract: `docs/RELATIONS-AND-TRANSACTIONS-V0.1.md`.

## 14.2 Implemented bulk safety layer

Phase 2.4 adds a review-before-commit wrapper around the existing bounded transaction engine.

The bulk layer does not own a second record mutation implementation. Both preview and execute reuse the same schema, relation, optimistic-concurrency, idempotency, and provenance paths already used by direct transactions.

Preview is implemented as:

```text
outer BEGIN IMMEDIATE
  execute the real bounded transaction path
  derive deterministic review summary
  force rollback
```

The rollback includes temporary records, relations, nested/outer transaction idempotency entries, events, receipts, and SQLite event-sequence movement.

The public preview never exposes temporary generated create IDs. Its digest binds actor, exact ordered operations, deterministic state summary, and the all-or-nothing policy.

Fresh execute re-previews current state, requires the supplied digest to match, then commits through the normal transaction engine. Commit has one supported policy: all-or-nothing.

Bulk adds no canonical SQLite table. Its durable outer retry state uses the existing idempotency store, and committed mutation history remains the nested record provenance plus final transaction provenance.

Detailed contract: `docs/BULK-OPERATIONS-V0.1.md`.

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

Owned by AI-Verse Data itself. Phase 2.6 implements explicit versioned internal migrations, a durable engine-owned migration ledger, migration-definition digests, verified pre-migration backups, and fail-closed interrupted/failed migration state. Normal database open never auto-migrates an older format.

### User entity schemas

Owned as Data definitions inside a Data Space.

The normal catalog update path remains additive-first:

- add optional field;
- add required field directly only with a valid default;
- add enum values through compatible schema definitions;
- add compatible constraints;
- deprecate fields without immediately destroying stored values.

Phase 2.7 implements the separate governed migration path for changes that require active record transformation. It previews the proposed complete schema against every active record, binds the reviewed state to a deterministic digest, supports explicit constant backfills, requires approval metadata for destructive remove/replace/rename or force-set behavior, and commits the immutable next schema version plus all active record/relation/idempotency/provenance changes atomically.

User-schema versions remain separate from the internal SQLite database-format version. No model-generated SQL or arbitrary migration code is executed.

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

## 23. Backup, portability, and recovery

Phase 2.5 implements explicit backup/export semantics:

```text
physical backup
  -> consistent SQLite online backup
  -> manifest + source identity/binding
  -> payload/state digests
  -> receipt

portable export
  -> consistent snapshot
  -> canonical logical state
  -> manifest/digests/receipt
```

Restore/import never overwrites an existing canonical destination and re-verifies installed state.

Phase 2.8 builds recovery on those verified artifacts rather than raw WAL-mode file copying. Confirmed corruption creates durable quarantine evidence and blocks writes. Recovery diagnosis reads the original source without repairing it, performs deep semantic verification on a consistent temporary snapshot, and may stage a verified backup/export only to a different empty destination with the same trusted binding.

Phase 2.8 deliberately does not automatically promote a staged candidate over the corrupt canonical source.

Uninstall must never count as backup.

## 24. Failure philosophy

The engine should fail closed on:

- workspace identity mismatch;
- database metadata claiming another workspace;
- symlink/path escape;
- unsupported database format version;
- incomplete migration;
- corrupt canonical storage;
- quarantined canonical storage;
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
