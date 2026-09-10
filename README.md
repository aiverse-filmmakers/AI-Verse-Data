# AI-Verse Data

**The canonical structured-data layer for AI-Verse OS.**

**Status:** Phase 1 implementation in progress  
**Completed implementation tasks:** 3 / 41  
**Latest completed:** Task 3 / 41, Phase 1.3 - Storage-driver contract + SQLite bootstrap  
**Next task:** Task 4 / 41, Phase 1.4 - Scope and database identity  
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
```

No Data Spaces, entity-schema persistence, records, CRUD, query execution, relations, OS installation, or sibling-layer adapters are implemented yet. They remain later tasks in the canonical Build Map.

## Public package surfaces

```text
@ai-verse/data
@ai-verse/data/protocol
@ai-verse/data/storage
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

### Task 3 verification

Final implementation CI run: `34509888259`

```text
Node 22  PASS
Node 24  PASS

25 tests
25 passed
0 failed
```

The storage tests prove real database creation/reopen, metadata persistence, WAL, foreign keys, STRICT metadata, integrity checking, missing-database handling, unrelated-database rejection, unsupported-format rejection, identity mismatch rejection, and closed-handle safety.

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

There will be one physical SQLite database per workspace with multiple logical Data Spaces inside it. **Task 4 / 41** is where trusted workspace/database binding and safe path identity are implemented. The SQLite driver deliberately does not improvise that responsibility early.

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
- [`docs/SECURITY-AND-AUTHORITY.md`](docs/SECURITY-AND-AUTHORITY.md) - security and permission model
- [`docs/TESTING-AND-ACCEPTANCE.md`](docs/TESTING-AND-ACCEPTANCE.md) - test and release gates
- [`docs/RESEARCH-AND-DECISIONS.md`](docs/RESEARCH-AND-DECISIONS.md) - research and locked decisions
- [`docs/BUILD-MAP.md`](docs/BUILD-MAP.md) - canonical 41-task implementation ledger
- [`docs/PHASE-1-STATUS.md`](docs/PHASE-1-STATUS.md) - Phase 1 implementation evidence

## Build rule

Implementation follows `docs/BUILD-MAP.md` one task at a time. A task is not marked complete until its acceptance checks pass and the repository records the result.

**Next: Task 4 / 41, Phase 1.4 - Scope and database identity.**
