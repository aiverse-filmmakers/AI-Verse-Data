# AI-Verse Data

**The canonical structured-data layer for AI-Verse OS.**

**Status:** Phase 1 implementation in progress  
**Completed implementation tasks:** 1 / 41  
**Latest completed:** Task 1 / 41, Phase 1.1 - Repository/package foundation  
**Next task:** Task 2 / 41, Phase 1.2 - Protocol types and validators  
**Architecture baseline:** 2026-09-10

AI-Verse Data gives AI-Verse a first-class way to store, query, relate, update, and react to structured operational records such as customers, deals, invoices, productions, content items, assets, inventory, metrics, and application data.

> **Give humans, agents, Apps, and automations one safe structured-data layer without turning Memory, Dashboard, Apps, or AI-Verse OS into competing databases.**

## Current implementation

Task 1.1 establishes the runnable package foundation only. No database, SQLite driver, schemas, records, queries, or CRUD operations exist yet.

The repository now includes:

```text
AI-Verse-Data/
├── package.json
├── tsconfig.json
├── src/
│   ├── cli.ts
│   └── index.ts
├── test/
│   ├── cli.test.ts
│   └── foundation.test.ts
├── .github/workflows/ci.yml
├── docs/
└── README.md
```

Current CLI surface:

```bash
ai-verse-data --help
ai-verse-data --version
```

The package currently identifies itself as `@ai-verse/data` version `0.1.0-alpha.0` and requires Node.js 22+.

### Task 1.1 verification

- strict TypeScript build passes;
- 5/5 foundation tests pass locally;
- GitHub CI passes on Node 22 and Node 24;
- CLI help/version behavior is tested;
- unknown CLI arguments fail explicitly;
- package dry-run contains only the intended distributable source outputs and package metadata;
- no SQLite or CRUD implementation was introduced early.

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

## Agent-safe model

Agents will not receive arbitrary SQL access by default. They will operate through validated capabilities such as:

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

The planned engine validates scope, schema, fields, limits, permissions, record versions, and idempotency before committing.

## Technology direction

```text
TypeScript
Node 22+
SQLite
storage-driver abstraction
```

TypeScript/Node implement the engine and APIs. SQLite is the first local canonical storage driver. The public Data contract will remain storage-driver-neutral so future hosted/team deployments can use another backend without rewriting Apps, Bots, or Dashboard clients.

## Native installation direction

Data will use AI-Verse OS's optional extension contract:

```text
.aiverse/extensions/registry.json
```

Its software will live in an extension-owned location. Normal install/update/uninstall must not modify tracked AI-Verse OS files or sibling repo state. Installing the engine will not create databases in every workspace. Canonical workspace Data is created only when explicitly initialized or used, and uninstall must preserve it by default.

## Canonical documents

- [`docs/PRD.md`](docs/PRD.md) - product requirements and first-release scope
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) - technical architecture
- [`docs/DATA-MEMORY-BOUNDARY.md`](docs/DATA-MEMORY-BOUNDARY.md) - Data vs Memory ownership law
- [`docs/ECOSYSTEM-INTEGRATION.md`](docs/ECOSYSTEM-INTEGRATION.md) - integration with the wider AI-Verse ecosystem
- [`docs/INSTALLATION-AND-LIFECYCLE.md`](docs/INSTALLATION-AND-LIFECYCLE.md) - install/update/uninstall rules
- [`docs/PROTOCOL-V0.1.md`](docs/PROTOCOL-V0.1.md) - protocol direction
- [`docs/SECURITY-AND-AUTHORITY.md`](docs/SECURITY-AND-AUTHORITY.md) - security and permission model
- [`docs/TESTING-AND-ACCEPTANCE.md`](docs/TESTING-AND-ACCEPTANCE.md) - test and release gates
- [`docs/RESEARCH-AND-DECISIONS.md`](docs/RESEARCH-AND-DECISIONS.md) - research and locked decisions
- [`docs/BUILD-MAP.md`](docs/BUILD-MAP.md) - canonical 41-task implementation ledger

## Build rule

Implementation follows `docs/BUILD-MAP.md` one task at a time. A task is not marked complete until its acceptance checks pass and the repository state records the result.

**Next:** Task 2 / 41, Phase 1.2 - Protocol types and validators.
