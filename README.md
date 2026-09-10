# AI-Verse Data

**The canonical structured-data layer for AI-Verse OS.**

**Status:** Phase 0 product + architecture complete  
**Implementation status:** Not started  
**Next task:** Phase 1, Task 1.1 - Repository/package foundation  
**Architecture baseline:** 2026-09-10

AI-Verse Data gives AI-Verse a first-class way to store, query, relate, update, and react to structured operational records such as customers, deals, invoices, productions, content items, assets, inventory, metrics, and application data.

The north star is:

> **Give humans, agents, Apps, and automations one safe structured-data layer without turning Memory, Dashboard, Apps, or AI-Verse OS into competing databases.**

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

A Memory index must be safe to delete and rebuild. A CRM or invoice database cannot have that rule. Therefore Data and Memory can integrate, but they cannot share canonical ownership.

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

The core ownership rule is:

> **Data owns structured operational records. It does not own the whole OS, Memory, strategy, coordination, external credentials, scheduling, or UI.**

## First native storage model

AI-Verse Data v0.1 is designed to be workspace-first.

When a workspace actually needs structured Data, its canonical database will live at:

```text
workspaces/<workspace-id>/data/ai-verse-data.sqlite
```

There is one physical SQLite database per workspace and multiple logical Data Spaces can live inside it, for example:

```text
workspace: commercial-ops

ai-verse-data.sqlite
  ├── crm
  ├── production
  ├── content
  └── finance-ops
```

This adds structured truth without creating a new AI-Verse OS root folder and gives each workspace a strong physical isolation boundary.

## Agent-safe model

Agents will not receive arbitrary SQL access by default.

Instead they operate through validated capabilities such as:

```text
data.space.create
data.schema.create
data.record.create
data.record.get
data.record.list
data.record.update
data.record.delete
data.query
data.aggregate
data.transaction.execute
```

The engine validates scope, schema, fields, limits, permissions, expected record version, and idempotency before committing.

The architecture requires:

- optimistic concurrency instead of silent last-write-wins;
- idempotency for retry-safe agent/automation mutations;
- soft delete by default;
- append-oriented Data mutation events;
- mutation receipts with provenance;
- no public raw database paths;
- no normal raw SQL endpoint for models;
- bounded queries and transactions;
- fail-closed workspace/path handling.

## Technology direction

The first implementation is planned around:

```text
TypeScript
Node 22+
SQLite
storage-driver abstraction
```

SQLite is the first local driver because it is transactional, portable, local-first, mature, and appropriate for one-machine AI-Verse use.

The public Data protocol will not expose SQLite-specific APIs. A future team/hosted edition can add a server driver without rewriting Apps, Bots, or Dashboard clients.

The first preferred Node binding is `better-sqlite3`, subject to dependency verification during implementation. The driver boundary means the binding can change later without changing Data semantics.

## Native installation direction

Data will use the existing AI-Verse optional-extension contract:

```text
.aiverse/extensions/registry.json
```

Its local software will live under an owned extension path such as:

```text
.aiverse/extensions/ai-verse-data/
```

Normal install/update/uninstall must not edit tracked AI-Verse OS files such as `AGENTS.md`, `AI-VERSE.yaml`, `CLAUDE.md`, or `skills/registry.yaml`, and must not modify Memory, Brain, Bots, Skills, Apps, Connections, or Dashboard state.

Installing the engine does not create databases in every workspace. Structured storage appears only when a workspace explicitly initializes/uses Data.

Default uninstall preserves canonical workspace databases. Purging records is a separate destructive operation.

## Installation-order goal

Data must work whether installed before or after the other optional AI-Verse layers.

Required examples include:

```text
OS -> Data
OS -> Memory -> Data
OS -> Data -> Memory
OS -> Brain -> Data
OS -> Data -> Brain
OS -> Multiple Bots -> Data
OS -> Data -> Multiple Bots
```

No sibling extension is a mandatory dependency for the Data core.

## Documentation map

The repository documentation is intentionally complete before implementation begins:

- [`docs/PRD.md`](docs/PRD.md) - product requirements, goals, non-goals, user stories, and first-release success criteria.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) - canonical technical architecture, storage model, record/schema/query design, concurrency, events, receipts, and driver boundary.
- [`docs/DATA-MEMORY-BOUNDARY.md`](docs/DATA-MEMORY-BOUNDARY.md) - exact Data vs Memory ownership and integration rules.
- [`docs/ECOSYSTEM-INTEGRATION.md`](docs/ECOSYSTEM-INTEGRATION.md) - integration with OS, Brain, Memory, Skills, Multiple Bots, Dashboard, Apps, Connections, and Automations.
- [`docs/INSTALLATION-AND-LIFECYCLE.md`](docs/INSTALLATION-AND-LIFECYCLE.md) - native/standalone installation, extension registration, update, disable, uninstall, preservation, and future purge rules.
- [`docs/PROTOCOL-V0.1.md`](docs/PROTOCOL-V0.1.md) - operation envelopes, Data Space/schema/record/query/mutation semantics, errors, receipts, and protocol versioning.
- [`docs/SECURITY-AND-AUTHORITY.md`](docs/SECURITY-AND-AUTHORITY.md) - workspace isolation, path safety, permissions, concurrency, idempotency, schema safety, and destructive-action boundaries.
- [`docs/TESTING-AND-ACCEPTANCE.md`](docs/TESTING-AND-ACCEPTANCE.md) - unit, integration, adversarial, cross-platform, installation-order, and full release acceptance gates.
- [`docs/RESEARCH-AND-DECISIONS.md`](docs/RESEARCH-AND-DECISIONS.md) - research sources and locked architecture decisions.
- [`docs/BUILD-MAP.md`](docs/BUILD-MAP.md) - canonical task-by-task implementation roadmap and current progress.

## Current build status

```text
Phase 0  Product + Architecture        COMPLETE
Phase 1  Core Data Engine              NOT STARTED
Phase 2  Reliability + Agent Safety    NOT STARTED
Phase 3  Native AI-Verse Integration   NOT STARTED
Phase 4  Ecosystem Adapters            NOT STARTED
Phase 5  Release Hardening             NOT STARTED
```

Implementation should proceed one task at a time from the canonical Build Map.

The next task is:

> **Task 1.1 - Repository/package foundation.**

No later task should begin until the current task is implemented, tested, committed, and reported complete.

## Non-negotiable laws

1. Data is not Memory.
2. Canonical workspace Data is user-owned and survives uninstall.
3. No ordinary agent API gets raw SQL or canonical database paths.
4. Workspace isolation is enforced technically, not only through prompts.
5. Data installation never rewrites sibling canonical state.
6. Data events are not automatically Memory.
7. Brain may reason over Data but does not own it.
8. Multiple Bots grants Data access through scoped authority, not database credentials.
9. Apps use Data instead of hiding canonical operational records in App-local state.
10. Connections remains the route to external canonical systems until explicit sync semantics exist.
11. Dashboard renders Data but does not own or directly open it from the browser.
12. SQLite is a driver, not the public Data contract.

## Research references

The architecture is based on direct review of the current AI-Verse repositories plus structured-data patterns from modern AI-native workspaces and official SQLite/Node documentation.

Key external references:

- Kylon: https://kylon.io/
- SQLite WAL: https://sqlite.org/wal.html
- SQLite isolation: https://sqlite.org/isolation.html
- SQLite STRICT tables: https://sqlite.org/stricttables.html
- SQLite JSON: https://sqlite.org/json1.html
- Node SQLite API: https://nodejs.org/api/sqlite.html
- better-sqlite3: https://github.com/WiseLibs/better-sqlite3

No implementation claim is made by these documents. Phase 0 defines what will be built and the boundaries the implementation must preserve.
