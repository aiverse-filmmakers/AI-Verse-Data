# AI-Verse Data

**The canonical structured-data layer for AI-Verse OS.**

**Status:** Phase 1 implementation in progress  
**Completed implementation tasks:** 2 / 41  
**Latest completed:** Task 2 / 41, Phase 1.2 - Protocol types and validators  
**Next task:** Task 3 / 41, Phase 1.3 - Storage-driver contract + SQLite bootstrap  
**Architecture baseline:** 2026-09-10

AI-Verse Data gives AI-Verse a first-class way to store, query, relate, update, and react to structured operational records such as customers, deals, invoices, productions, content items, assets, inventory, metrics, and application data.

> **Give humans, agents, Apps, and automations one safe structured-data layer without turning Memory, Dashboard, Apps, or AI-Verse OS into competing databases.**

## Current implementation

The repository now has a runnable TypeScript/Node package plus the first public storage-neutral protocol contract.

Implemented so far:

```text
Task 1 / 41
Repository/package foundation
  -> TypeScript + Node 22+
  -> CLI shell
  -> strict build/test setup
  -> Node 22 + Node 24 CI

Task 2 / 41
Protocol types and validators
  -> operation request envelopes
  -> success/failure response envelopes
  -> workspace scope
  -> actor model
  -> authorization metadata
  -> Data Space/schema/record types
  -> query AST
  -> aggregate types
  -> bounded transaction types
  -> first-release field types
  -> stable error codes
  -> runtime validation
  -> hard request/query/schema/transaction limits
```

No SQLite driver, persistent database, Data Spaces, schemas, records, CRUD execution, query execution, or OS installation behavior exists yet. Those begin in later tasks.

### Public package surfaces

```text
@ai-verse/data
@ai-verse/data/protocol
```

The protocol is currently:

```text
ai-verse-data/0.1
```

It is deliberately storage-driver neutral. Consumers address logical workspace/Data Space/entity/record identities rather than SQLite files.

### Agent-safe protocol boundary

Normal requests cannot include arbitrary SQL or database filesystem paths. Runtime validation rejects unknown envelope/payload fields and enforces bounded request shapes before a future storage engine receives them.

Initial field types:

```text
string
number
integer
boolean
date
datetime
enum
reference
json
attachment_ref
```

Initial query operators:

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

The implementation also bounds request bytes, schema fields, record bytes, filter depth/node count, `in` list size, sort keys, selected fields, aggregate metrics, transaction operations, event page size, authorization references, enum sizes, JSON depth, and array size.

### Task 2 verification

Latest verified GitHub Actions run: `34508602201`

```text
Node 22  PASS
Node 24  PASS

18 tests
18 passed
0 failed
0 skipped
0 cancelled
```

The test suite proves, among other things:

- documented record-update envelopes validate;
- wrong protocol versions fail explicitly;
- unknown operations return `OPERATION_UNSUPPORTED`;
- unknown request/payload fields are rejected;
- path-like workspace/Data Space identifiers are rejected;
- malformed field definitions and duplicate enum values fail;
- schema field ceilings are enforced;
- query recursion and `in` list sizes are bounded;
- aggregate and transaction limits are enforced;
- unsupported nested transaction operations fail;
- non-finite and oversized record JSON fails;
- response envelopes and error codes are validated;
- raw SQL and database-path extras are rejected.

## Why Data is separate from Memory

This is a deliberate architecture boundary, not duplication.

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

A Memory index must be safe to delete and rebuild. A CRM or invoice database cannot have that rule. Data and Memory can integrate, but they cannot share canonical ownership.

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

## First native storage model

AI-Verse Data v0.1 is workspace-first. When a workspace actually needs structured Data, its canonical database is planned to live at:

```text
workspaces/<workspace-id>/data/ai-verse-data.sqlite
```

There will be one physical SQLite database per workspace, with multiple logical Data Spaces inside it. This keeps workspace isolation strong and avoids adding another top-level AI-Verse OS truth tree.

## Technology direction

```text
TypeScript
Node 22+
SQLite
storage-driver abstraction
```

TypeScript/Node implement the engine and APIs. SQLite is the first local canonical storage driver. The public Data protocol remains storage-driver neutral so future hosted/team deployments can use another backend without rewriting Apps, Bots, or Dashboard clients.

## Native installation direction

Data will use AI-Verse OS's optional extension contract:

```text
.aiverse/extensions/registry.json
```

Normal install/update/uninstall must not modify tracked AI-Verse OS files or sibling repo state. Installing the engine will not create databases in every workspace. Canonical workspace Data is created only when explicitly initialized or used, and uninstall must preserve it by default.

## Canonical documents

- [`docs/PRD.md`](docs/PRD.md) - product requirements and first-release scope
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) - technical architecture
- [`docs/DATA-MEMORY-BOUNDARY.md`](docs/DATA-MEMORY-BOUNDARY.md) - Data vs Memory ownership law
- [`docs/ECOSYSTEM-INTEGRATION.md`](docs/ECOSYSTEM-INTEGRATION.md) - wider AI-Verse integration
- [`docs/INSTALLATION-AND-LIFECYCLE.md`](docs/INSTALLATION-AND-LIFECYCLE.md) - install/update/uninstall rules
- [`docs/PROTOCOL-V0.1.md`](docs/PROTOCOL-V0.1.md) - public protocol design
- [`docs/SECURITY-AND-AUTHORITY.md`](docs/SECURITY-AND-AUTHORITY.md) - security and permission model
- [`docs/TESTING-AND-ACCEPTANCE.md`](docs/TESTING-AND-ACCEPTANCE.md) - test and release gates
- [`docs/RESEARCH-AND-DECISIONS.md`](docs/RESEARCH-AND-DECISIONS.md) - research and locked decisions
- [`docs/BUILD-MAP.md`](docs/BUILD-MAP.md) - canonical 41-task implementation ledger
- [`docs/PHASE-1-STATUS.md`](docs/PHASE-1-STATUS.md) - Phase 1 implementation evidence

## Build rule

Implementation follows `docs/BUILD-MAP.md` one task at a time. A task is not marked complete until its acceptance checks pass and the repository records the result.

**Next: Task 3 / 41, Phase 1.3 - Storage-driver contract + SQLite bootstrap.**
