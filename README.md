# AI-Verse Data

**The canonical structured-data layer for AI-Verse OS.**

**Status:** Phase 2 Reliability + Agent Safety in progress  
**Completed implementation tasks:** 16 / 41  
**Latest completed:** Task 16 / 41, Phase 2.7 - User-schema migration framework  
**Next task:** Task 17 / 41, Phase 2.8 - Corruption/recovery behavior  
**Architecture baseline:** 2026-09-10

AI-Verse Data gives AI-Verse a first-class way to store, query, relate, update, and react to structured operational records such as customers, deals, invoices, productions, content items, assets, inventory, metrics, and application data.

> **Give humans, agents, Apps, and automations one safe structured-data layer without turning Memory, Dashboard, Apps, or AI-Verse OS into competing databases.**

## Current implementation

```text
Task 1 / 41 - COMPLETE
Repository/package foundation
  -> TypeScript + Node 22+
  -> CLI shell
  -> strict build/test setup
  -> Node 22 + Node 24 CI

Task 2 / 41 - COMPLETE
Protocol types and validators
  -> ai-verse-data/0.1
  -> typed request/response contracts
  -> actor/scope/authorization types
  -> Data Space/schema/record/query types
  -> hard validation limits
  -> raw SQL/path rejection

Task 3 / 41 - COMPLETE
Storage-driver contract + SQLite bootstrap
  -> storage abstraction
  -> real SQLite database create/open/close
  -> durable format metadata
  -> WAL + foreign keys
  -> STRICT internal metadata
  -> integrity checking
  -> fail-closed format validation

Task 4 / 41 - COMPLETE
Scope and database identity
  -> trusted-root abstraction
  -> standalone + native-ready workspace scopes
  -> safe derived database paths
  -> persistent scope binding
  -> conflicting workspace/kind rejection
  -> child-symlink escape rejection
  -> no Dashboard systemId in canonical identity

Task 5 / 41 - COMPLETE
Data Spaces and entity schemas
  -> persistent Data Space catalog
  -> fixed engine-owned SQLite schema catalog
  -> immutable entity schema versions
  -> deterministic SHA-256 schema digests
  -> field/default validation
  -> safe additive schema updates
  -> migration-required destructive changes

Task 6 / 41 - COMPLETE
Record CRUD
  -> fixed canonical _records table
  -> create/get/list/update/soft-delete
  -> schema-aware field validation
  -> defaults and schema-version provenance
  -> stable record IDs and timestamps
  -> actor attribution
  -> basic expectedVersion checks
  -> deleted-record visibility controls

Task 7 / 41 - COMPLETE
Safe query + aggregate engine
  -> structured filter AST
  -> schema-aware operator/type checks
  -> parameterized SQLite compilation
  -> bounded sorting + field selection
  -> opaque query-bound cursors
  -> count/sum/min/max/avg
  -> SQL-looking values remain parameters

Task 8 / 41 - COMPLETE
Relations + bounded transactions
  -> declared reference existence checks
  -> normalized _record_relations index
  -> inbound delete protection
  -> atomic record/relation writes
  -> cross-space references inside one workspace DB
  -> max 50 operations per transaction
  -> transaction-wide rollback
  -> safe earlier clientRef resolution

Task 9 / 41 - COMPLETE
Phase 1 integration gate
  -> standalone end-to-end acceptance
  -> native-ready workspace database acceptance
  -> full catalog/schema/CRUD/query/aggregate/reference/transaction composition
  -> exact committed-state recovery after reopen
  -> two-workspace isolation proof
  -> unsupported newer format fail-closed proof
  -> 106-test full Phase 1 gate

Task 10 / 41 - COMPLETE
Optimistic concurrency
  -> atomic expectedVersion SQL predicate
  -> one stale-version winner only
  -> RECORD_VERSION_CONFLICT with current version
  -> short immediate write transactions
  -> separate-process race tests
  -> transaction race tests
  -> stale delete protection

Task 11 / 41 - COMPLETE
Idempotent mutations
  -> durable _idempotency store
  -> canonical SHA-256 request fingerprints
  -> operation + trusted actor binding
  -> exact original-result replay
  -> IDEMPOTENCY_CONFLICT on changed reuse
  -> record + transaction retry safety
  -> failed-write rollback/no ghost key
  -> close/reopen replay persistence
  -> duplicate-delivery process races

Task 12 / 41 - COMPLETE
Events, receipts, provenance
  -> immutable _events + _mutation_receipts
  -> public @ai-verse/data/provenance reader
  -> internal-only provenance writer
  -> create/update/delete event + receipt atomicity
  -> transaction child + final transaction provenance
  -> actor/request/workspace/transaction attribution
  -> SHA-256 event + receipt integrity
  -> receipt-to-event consistency verification
  -> bounded opaque event cursors
  -> idempotent replay creates no duplicate audit facts
  -> transaction provenance-laundering protection

Task 13 / 41 - COMPLETE
Bulk-operation safety and limits
  -> public @ai-verse/data/bulk surface
  -> data.bulk.preview + data.bulk.execute protocol operations
  -> exact rollback-only preview using the real transaction engine
  -> zero committed preview state, including event sequence
  -> 50-operation + 256 KiB hard ceilings
  -> actor/operation/state-bound SHA-256 preview digest
  -> mandatory preview-digest match before commit
  -> all-or-nothing commit only, no best-effort partial success
  -> existing schema/reference/OCC/idempotency/provenance guarantees reused
  -> idempotent bulk replay verified against transaction + provenance state
  -> preview-created IDs never exposed as canonical identity

Task 14 / 41 - COMPLETE
Backup/export/import foundation
  -> public @ai-verse/data/backup
@ai-verse/data/schema-migrations surface
  -> consistent SQLite online backup
  -> manifest, payload SHA-256, and artifact receipt
  -> portable export from a consistent SQLite snapshot
  -> schema history, tombstones, relations, idempotency, events, and receipts preserved
  -> exact logical-state digest verification before and after import
  -> workspace-binding and valid pre-binding provenance preservation
  -> no-overwrite artifact and canonical destination rules
  -> staged restore/import with post-install verification

Task 15 / 41 - COMPLETE
Internal migration framework
  -> database format v2
  -> engine-owned _schema_migrations ledger
  -> explicit inspectMigration + migrate + verifyMigrationBackup
  -> normal open never auto-migrates
  -> deterministic migration-definition digests
  -> verified consistent pre-migration backup
  -> transactional v1 -> v2 migration
  -> durable in-progress / failed / completed states
  -> fail-closed interruption and current-format inconsistency handling
  -> safe explicit retry/resume with attempt tracking
  -> workspace binding and canonical reliability state preserved
  -> unsupported newer formats remain fail-closed

Task 16 / 41 - COMPLETE
User-schema migration framework
  -> public @ai-verse/data/schema-migrations surface
  -> data.schema.migration.preview + execute protocol operations
  -> consistent read-transaction preview
  -> actor/owner/schema/record-bound SHA-256 preview digest
  -> required-field backfills
  -> remove/replace/rename field migrations
  -> destructive approval metadata
  -> 500-active-record + 8 MiB source/rewrite ceilings
  -> atomic schema + record + relation + idempotency + provenance commit
  -> active records advance schema and record version exactly once
  -> deleted records remain historical
  -> reference indexes rebuilt against proposed schema
  -> idempotent replay returns one migration effect
  -> migration owner/executor/approval provenance
  -> no arbitrary SQL or model-generated backfill code
```

Phase 1 is complete. Phase 2.1 through 2.7 now add race-safe optimistic concurrency, durable idempotent mutation replay, immutable mutation events/receipts, provenance queries, bounded review-before-commit bulk operations, consistent backup, verified portable export/import, explicit internal database-format migrations, and governed user-schema migrations. Corruption/recovery remains the final implementation task before the Phase 2 gate.

## Public package surfaces

```text
@ai-verse/data
@ai-verse/data/protocol
@ai-verse/data/storage
@ai-verse/data/scope
@ai-verse/data/catalog
@ai-verse/data/records
@ai-verse/data/query
@ai-verse/data/transactions
@ai-verse/data/idempotency
@ai-verse/data/provenance
@ai-verse/data/bulk
@ai-verse/data/backup
```

The public Data protocol remains storage-neutral. SQLite is an implementation driver, not the API that Apps, Bots, Dashboard, Brain, Memory, or Connections are expected to depend upon.

## SQLite v0.1 storage

The first driver uses `better-sqlite3` 13.0.3 behind `DataStorageDriver`.

A new Data database receives durable identity:

```text
format:          ai-verse-data/sqlite
format version:  2
application_id:  0x41495644 (AIVD)
user_version:    2
```

The first internal table is deliberately tiny:

```sql
CREATE TABLE _aiverse_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT, WITHOUT ROWID;
```

The connection enforces foreign keys and WAL mode. Integrity checks report database health without attempting repair.

Format v2 also contains `migration_framework_version = 1` and the engine-owned `_schema_migrations` ledger. Supported format v1 databases require an explicit migration operation before normal open; they are never silently upgraded. Unsupported newer formats remain fail-closed.

Most importantly, an unrelated SQLite file is never silently converted into AI-Verse Data.

See [`docs/STORAGE-V0.1.md`](docs/STORAGE-V0.1.md).

## Scope and database identity

Phase 1.4 adds a host-side trusted-root boundary. Normal scoped opens derive the database path from the trusted root plus workspace identity rather than accepting a client-supplied SQLite path.

Native-ready workspace scope resolves to:

```text
<trusted-root>/workspaces/<workspaceId>/data/ai-verse-data.sqlite
```

Standalone scope resolves to:

```text
<trusted-root>/.ai-verse-data/data.sqlite
```

The database persists only `bindingVersion`, `scope kind`, and `workspaceId`. It does **not** store Dashboard `systemId` or arbitrary absolute root paths. A conflicting reopen fails with `DATABASE_SCOPE_CONFLICT`, and an older unbound AI-Verse Data database may be bound only once.

See [`docs/SCOPE-AND-IDENTITY-V0.1.md`](docs/SCOPE-AND-IDENTITY-V0.1.md).

## Data Spaces and entity schemas

Phase 1.5 adds the first semantic structured-data catalog above storage. One workspace database can now hold multiple logical Data Spaces such as `crm`, `production`, or `content`.

Entity definitions are stored as validated structured JSON inside fixed engine-owned SQLite tables, never as arbitrary SQL generated from a model. Every entity schema starts at version 1, accepted updates create immutable new versions, and each version receives a deterministic SHA-256 digest verified when read.

Safe direct updates currently include adding compatible fields and changing entity name/description. Removing, replacing, or renaming fields returns `SCHEMA_MIGRATION_REQUIRED` until the dedicated migration framework exists.

See [`docs/CATALOG-AND-SCHEMAS-V0.1.md`](docs/CATALOG-AND-SCHEMAS-V0.1.md).

## Record CRUD

Phase 1.6 adds canonical schema-aware record storage behind `@ai-verse/data/records`.

Records live in one fixed engine-owned `_records` STRICT table rather than arbitrary per-entity SQL tables. Each record persists its exact schema version, stable ID, record version, timestamps, actor attribution, JSON payload, and soft-delete state.

Create applies validated schema defaults. Get/list hide deleted records unless explicitly requested. Update validates the existing payload against its historical schema, then validates the merged result against the current schema. Soft delete preserves the canonical row and deletion attribution.

Phase 2.1 enforces `expectedVersion` atomically at the canonical SQLite write. Phase 2.2 adds durable idempotency. Phase 2.3 now appends one immutable event and durable receipt for every successful record mutation, with explicit receipt-returning variants and no duplicate provenance on idempotent replay.

See [`docs/RECORD-CRUD-V0.1.md`](docs/RECORD-CRUD-V0.1.md).

## Safe queries and aggregates

Phase 1.7 adds `@ai-verse/data/query`. Callers submit structured filters, sort keys, selected fields, bounded limits/cursors, and aggregate metrics instead of SQL.

The engine validates every filter, sort, and aggregate field against the current entity schema before storage execution. SQLite receives parameterized queries, including bound JSON field paths and user values. String wildcard characters are escaped for `contains` and `starts_with`, and SQL-looking text remains inert data.

Query results pass through the same historical-schema hydration and corruption checks used by normal CRUD reads. Opaque cursors are bounded and fingerprinted to one query shape.

See [`docs/QUERY-AND-AGGREGATES-V0.1.md`](docs/QUERY-AND-AGGREGATES-V0.1.md).

## Relations and bounded transactions

Phase 1.8 enforces declared reference fields against real active target records and maintains a normalized `_record_relations` index atomically with canonical record mutations. Referenced targets cannot be soft-deleted while active inbound references remain.

`@ai-verse/data/transactions` executes up to 50 create/update/delete operations atomically inside one workspace database. A later operation may reference a record created earlier in the same transaction using an explicit `clientRef` marker on a declared reference field. Any failed operation rolls back the whole transaction.

Race-hardening, durable idempotency, mutation events, durable receipts, and transaction provenance are implemented through Phase 2.3.

See [`docs/RELATIONS-AND-TRANSACTIONS-V0.1.md`](docs/RELATIONS-AND-TRANSACTIONS-V0.1.md).

## Phase 1 acceptance

Task 9 / 41 adds an integrated acceptance story rather than another feature layer. It proves the Phase 1 components operate correctly together in standalone and workspace-scoped modes and recover exactly committed state after close/reopen.

During that Phase 1 audit, the testing plan was corrected so mutation events and durable receipts were kept in their canonical Phase 2.3 task instead of being implemented early. Phase 2.3 has since completed.

See [`docs/PHASE-1-ACCEPTANCE.md`](docs/PHASE-1-ACCEPTANCE.md).

## Optimistic concurrency

Phase 2.1 turns record versions into a true compare-and-swap boundary. Update and soft-delete statements require the caller's `expectedVersion` directly in SQLite, and record/bounded-transaction writes use short immediate write intent so WAL snapshot races cannot become lost updates.

The test suite includes independent SQLite connections and separate Node processes racing on the same canonical record. Exactly one writer advances version N to N+1; stale writers fail with `RECORD_VERSION_CONFLICT`.

See [`docs/OPTIMISTIC-CONCURRENCY-V0.1.md`](docs/OPTIMISTIC-CONCURRENCY-V0.1.md).

## Idempotent mutations

Phase 2.2 makes record create/update/delete and bounded transactions safe to retry after uncertain delivery. Each successful workspace-database-global key is bound to a deterministic SHA-256 fingerprint of operation, trusted actor, and semantic request, plus the original committed result.

A matching retry returns the original result without executing again. Reusing the same key for a different request returns `IDEMPOTENCY_CONFLICT`. Failed mutations leave no ghost key, replay survives close/reopen, and persisted replay results are digest-verified before use.

Separate-process tests prove concurrent duplicate delivery creates one canonical record and replays one shared result. A same-key/different-payload race produces one commit and one conflict.

See [`docs/IDEMPOTENCY-V0.1.md`](docs/IDEMPOTENCY-V0.1.md).

## Events, receipts, and provenance

Phase 2.3 adds immutable structured audit facts for record create/update/delete and bounded transactions. SQLite stores fixed engine-owned `_events` and `_mutation_receipts` tables, guarded by append-only triggers and SHA-256 integrity checks.

The public `@ai-verse/data/provenance` surface can list bounded event streams, fetch receipts by receipt ID or idempotency key, and list all receipts for a transaction. Provenance writing remains internal to canonical mutation execution.

Existing mutation methods remain compatible. Receipt-returning variants are available for records and transactions. Matching idempotent replay reuses the original receipt and creates no second event. Fresh bounded transactions reject nested idempotency keys already bound outside that transaction, preventing old mutations from being laundered into new transaction provenance.

Data events are audit facts, not automatic Memory.

See [`docs/EVENTS-RECEIPTS-PROVENANCE-V0.1.md`](docs/EVENTS-RECEIPTS-PROVENANCE-V0.1.md).

## Bounded bulk operations

Phase 2.4 adds `@ai-verse/data/bulk` with explicit preview and execute operations. Preview runs the real bounded transaction engine inside a rollback-only SQLite transaction, so schema, reference, concurrency, idempotency, and provenance rules are evaluated exactly while leaving no committed records, relations, idempotency entries, events, receipts, or event-sequence changes.

Bulk execution is capped at 50 operations and 256 KiB. Commit requires the SHA-256 digest returned by preview, revalidates current state, and is always all-or-nothing. v0.1 intentionally has no best-effort partial-success mode.

The bulk layer does not create a second synthetic audit event. Successful execution returns the underlying transaction receipt and preserves the existing nested mutation + transaction provenance model.

See [`docs/BULK-OPERATIONS-V0.1.md`](docs/BULK-OPERATIONS-V0.1.md).

## Backup, export, import, and restore

Phase 2.5 adds `@ai-verse/data/backup`. Physical backup uses SQLite's online backup API. Portable export first captures the same kind of consistent SQLite snapshot, then produces deterministic canonical JSON containing Data Spaces, every schema version, active and deleted records, relation indexes, idempotency state, events, receipts, and event sequence.

Each artifact contains a manifest, payload SHA-256, deterministic logical-state digest, and artifact receipt. Verification checks file integrity, database identity, trusted binding, SQLite integrity, historical schemas, relations, idempotency integrity, provenance digests, and receipt/event linkage.

Restore and import require the same trusted binding, refuse existing canonical destinations, use staged materialization, and verify the installed canonical state again. Phase 2.5 does not add database migrations or cross-workspace remapping.

See [`docs/BACKUP-EXPORT-IMPORT-V0.1.md`](docs/BACKUP-EXPORT-IMPORT-V0.1.md).

## Internal database migrations

Phase 2.6 advances the canonical SQLite format to version 2 and adds an engine-owned migration framework behind `@ai-verse/data/storage`.

Normal database open never auto-migrates. A supported format v1 database reports `DATABASE_MIGRATION_REQUIRED`; interrupted or failed ledger state reports `DATABASE_MIGRATION_INCOMPLETE`. Explicit migration first creates and verifies a consistent pre-migration SQLite backup, then executes the registered migration transactionally while preserving workspace binding and canonical Data.

The first migration is `sqlite-0001-v1-to-v2`. Migration rows bind a deterministic definition digest, from/to versions, lifecycle state, attempt number, backup evidence, timestamps, and bounded failure information. Explicit retry/resume is allowed only for the same installed known migration definition.

See [`docs/INTERNAL-MIGRATIONS-V0.1.md`](docs/INTERNAL-MIGRATIONS-V0.1.md).

## User-schema migrations

Phase 2.7 adds `@ai-verse/data/schema-migrations` plus `data.schema.migration.preview` and `data.schema.migration.execute`.

Preview evaluates the complete proposed schema against one consistent committed snapshot, transforms every active record in memory, validates references, and returns a SHA-256 digest bound to the schema, actor, owner, migration instructions, record versions/data, and resulting relation state. Execute recomputes that plan inside one immediate transaction and refuses a stale digest.

Required-field backfills and destructive remove/replace/rename operations are now governed explicitly. Destructive migrations require approval metadata. Active records are rewritten atomically onto the new immutable schema version, record versions advance once, relation indexes are rebuilt, and deleted records remain historical. The migration reuses existing idempotency plus immutable record/transaction provenance rather than creating a second truth.

See [`docs/USER-SCHEMA-MIGRATIONS-V0.1.md`](docs/USER-SCHEMA-MIGRATIONS-V0.1.md).

### Latest verification

Task 16 behavioral CI run: `34593295702`  
Behavioral commit: `4f8e4977035bae02576e7390199625ff5b73a2ae`

```text
Node 22  PASS
Node 24  PASS

183 tests
183 passed
0 failed
0 skipped
0 cancelled
```

The suite additionally proves required-field backfills, destructive approval, rename/replace/narrowing behavior, reference-index rebuilding, stale-preview rejection, idempotent replay, deleted-record history preservation, atomic size/count ceilings, consistent preview state, and complete rollback after a forced mid-commit provenance failure.

## Why Data is separate from Memory

```text
AI-Verse Memory
"What happened before that may matter later?"

Canonical history: Markdown
SQLite: derived/rebuildable recall index

AI-Verse Data
"What structured operational state exists right now?"

Canonical records: structured database
SQLite v0.1: durable source of truth for local Data
```

A Memory index must be safe to delete and rebuild. A CRM or invoice database cannot have that rule. Data and Memory integrate later through explicit references/evidence contracts, but they do not share canonical ownership.

See [`docs/DATA-MEMORY-BOUNDARY.md`](docs/DATA-MEMORY-BOUNDARY.md).

## Role in the wider AI-Verse system

```text
AI-Verse OS
  -> scope, workspace boundaries, routing, policy, extension discovery

AI-Verse Brain
  -> goals, strategy, reasoning, evaluation

AI-Verse Memory
  -> selective historical recall

AI-Verse Skills
  -> reusable methods/capabilities

AI-Verse Multiple Bots
  -> coordination, Tasks, leases, approvals, Workers

AI-Verse Data
  -> canonical structured schemas, records, relations, queries,
     transactions, mutation events, and receipts

AI-Verse Apps
  -> persistent software experiences built on Data

AI-Verse Connections
  -> external systems and external canonical sources

AI-Verse Dashboard
  -> visual tables, forms, charts, record views, and controls
```

The ownership rule is:

> **Data owns structured operational records. It does not own the whole OS, Memory, strategy, coordination, external credentials, scheduling, or UI.**

## Planned native storage model

AI-Verse Data v0.1 is workspace-first. When a workspace actually needs structured Data, the planned canonical path is:

```text
workspaces/<workspace-id>/data/ai-verse-data.sqlite
```

There will be one physical SQLite database per workspace with multiple logical Data Spaces inside it. Trusted workspace/database binding and safe path identity are now implemented. Phase 3 later adds actual AI-Verse OS manifest/workspace validation and initialization lifecycle.

## Technology direction

```text
TypeScript
Node 22+
SQLite
stable storage-driver abstraction
```

A future team/hosted edition can add another sanctioned storage backend without forcing Apps/Bots/Dashboard consumers to rewrite against a new API.

## Native installation direction

Data will later use AI-Verse OS's optional extension contract under:

```text
.aiverse/extensions/registry.json
```

Normal install/update/uninstall must not modify tracked OS files or sibling repo state. Installing Data will not initialize every workspace automatically, and uninstall must preserve canonical workspace Data by default.

## Canonical documents

- [`docs/PRD.md`](docs/PRD.md) - product requirements and first-release scope
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) - technical architecture
- [`docs/DATA-MEMORY-BOUNDARY.md`](docs/DATA-MEMORY-BOUNDARY.md) - Data vs Memory ownership law
- [`docs/ECOSYSTEM-INTEGRATION.md`](docs/ECOSYSTEM-INTEGRATION.md) - wider AI-Verse integration
- [`docs/INSTALLATION-AND-LIFECYCLE.md`](docs/INSTALLATION-AND-LIFECYCLE.md) - install/update/uninstall rules
- [`docs/PROTOCOL-V0.1.md`](docs/PROTOCOL-V0.1.md) - public protocol design
- [`docs/STORAGE-V0.1.md`](docs/STORAGE-V0.1.md) - implemented SQLite driver/storage format
- [`docs/SCOPE-AND-IDENTITY-V0.1.md`](docs/SCOPE-AND-IDENTITY-V0.1.md) - trusted-root and persistent scope-binding contract
- [`docs/CATALOG-AND-SCHEMAS-V0.1.md`](docs/CATALOG-AND-SCHEMAS-V0.1.md) - implemented Data Space and entity-schema catalog
- [`docs/RECORD-CRUD-V0.1.md`](docs/RECORD-CRUD-V0.1.md) - implemented schema-aware record CRUD contract
- [`docs/QUERY-AND-AGGREGATES-V0.1.md`](docs/QUERY-AND-AGGREGATES-V0.1.md) - implemented safe query and aggregate contract
- [`docs/RELATIONS-AND-TRANSACTIONS-V0.1.md`](docs/RELATIONS-AND-TRANSACTIONS-V0.1.md) - implemented relation integrity and bounded transaction contract
- [`docs/SECURITY-AND-AUTHORITY.md`](docs/SECURITY-AND-AUTHORITY.md) - security and permission model
- [`docs/TESTING-AND-ACCEPTANCE.md`](docs/TESTING-AND-ACCEPTANCE.md) - test and release gates
- [`docs/RESEARCH-AND-DECISIONS.md`](docs/RESEARCH-AND-DECISIONS.md) - research and locked decisions
- [`docs/BUILD-MAP.md`](docs/BUILD-MAP.md) - canonical 41-task implementation ledger
- [`docs/CONTINUATION-HANDOFF.md`](docs/CONTINUATION-HANDOFF.md) - exact resume point for a new chat/session
- [`docs/PHASE-1-STATUS.md`](docs/PHASE-1-STATUS.md) - Phase 1 implementation evidence
- [`docs/PHASE-1-ACCEPTANCE.md`](docs/PHASE-1-ACCEPTANCE.md) - final Phase 1 integration gate and evidence
- [`docs/OPTIMISTIC-CONCURRENCY-V0.1.md`](docs/OPTIMISTIC-CONCURRENCY-V0.1.md) - implemented race-safe record concurrency contract
- [`docs/IDEMPOTENCY-V0.1.md`](docs/IDEMPOTENCY-V0.1.md) - implemented durable mutation retry/replay contract
- [`docs/EVENTS-RECEIPTS-PROVENANCE-V0.1.md`](docs/EVENTS-RECEIPTS-PROVENANCE-V0.1.md) - implemented immutable events, durable receipts, and provenance contract
- [`docs/BULK-OPERATIONS-V0.1.md`](docs/BULK-OPERATIONS-V0.1.md) - implemented bounded preview/execute bulk safety contract
- [`docs/BACKUP-EXPORT-IMPORT-V0.1.md`](docs/BACKUP-EXPORT-IMPORT-V0.1.md) - implemented backup, verification, restore, and portable export/import contract
- [`docs/INTERNAL-MIGRATIONS-V0.1.md`](docs/INTERNAL-MIGRATIONS-V0.1.md) - implemented internal database-format migration contract
- [`docs/USER-SCHEMA-MIGRATIONS-V0.1.md`](docs/USER-SCHEMA-MIGRATIONS-V0.1.md) - implemented governed user-schema migration contract
- [`docs/PHASE-2-STATUS.md`](docs/PHASE-2-STATUS.md) - Phase 2 implementation evidence

## Build rule

Implementation follows `docs/BUILD-MAP.md` one task at a time. A task is not marked complete until its acceptance checks pass and the repository records the result.

**Next: Task 17 / 41, Phase 2.8 - Corruption/recovery behavior.**
