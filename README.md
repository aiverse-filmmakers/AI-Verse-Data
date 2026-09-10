# AI-Verse Data

**The canonical structured-data layer for AI-Verse OS.**

**Status:** Phase 1 implementation in progress  
**Completed implementation tasks:** 6 / 41  
**Latest completed:** Task 6 / 41, Phase 1.6 - Record CRUD  
**Next task:** Task 7 / 41, Phase 1.7 - Safe query + aggregate engine  
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
```

Data Spaces, entity schemas, and record CRUD are now implemented. General query/aggregate execution, relations, OS installation, and sibling-layer adapters remain later tasks.

## Public package surfaces

```text
@ai-verse/data
@ai-verse/data/protocol
@ai-verse/data/storage
@ai-verse/data/scope
@ai-verse/data/catalog
@ai-verse/data/records
```

The public Data protocol remains storage-neutral. SQLite is an implementation driver, not the API that Apps, Bots, Dashboard, Brain, Memory, or Connections are expected to depend upon.

## SQLite v0.1 storage

The first driver uses `better-sqlite3` 13.0.3 behind `DataStorageDriver`.

A new Data database receives durable identity:

```text
format:          ai-verse-data/sqlite
format version:  1
application_id:  0x41495644 (AIVD)
user_version:    1
```

The first internal table is deliberately tiny:

```sql
CREATE TABLE _aiverse_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT, WITHOUT ROWID;
```

The connection enforces foreign keys and WAL mode. Integrity checks report database health without attempting repair.

Most importantly, an unrelated SQLite file is never silently converted into AI-Verse Data, and unsupported/newer Data formats fail closed.

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

Basic `expectedVersion` checks are implemented now. Race-safe atomic optimistic concurrency under competing writers remains Task 10 / 41. Persistent idempotency, events, and receipts remain Tasks 11 and 12.

See [`docs/RECORD-CRUD-V0.1.md`](docs/RECORD-CRUD-V0.1.md).

### Latest verification

Task 6 implementation CI run: `34514486550`

```text
Node 22  PASS
Node 24  PASS

71 tests
71 passed
0 failed
```

The suite now also proves schema-aware create/get/list/update/soft-delete, defaults, field constraints, unknown-field policy, actor provenance, schema evolution behavior, basic stale-version rejection, deleted-record visibility, reopen persistence, record-size ceilings, and fail-closed stored-record validation.

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
- [`docs/SECURITY-AND-AUTHORITY.md`](docs/SECURITY-AND-AUTHORITY.md) - security and permission model
- [`docs/TESTING-AND-ACCEPTANCE.md`](docs/TESTING-AND-ACCEPTANCE.md) - test and release gates
- [`docs/RESEARCH-AND-DECISIONS.md`](docs/RESEARCH-AND-DECISIONS.md) - research and locked decisions
- [`docs/BUILD-MAP.md`](docs/BUILD-MAP.md) - canonical 41-task implementation ledger
- [`docs/PHASE-1-STATUS.md`](docs/PHASE-1-STATUS.md) - Phase 1 implementation evidence

## Build rule

Implementation follows `docs/BUILD-MAP.md` one task at a time. A task is not marked complete until its acceptance checks pass and the repository records the result.

**Next: Task 7 / 41, Phase 1.7 - Safe query + aggregate engine.**
