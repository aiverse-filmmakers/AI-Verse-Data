# AI-Verse Data Research and Architecture Decisions

**Status:** Decision record before implementation  
**Date:** 2026-09-10

## 1. Research basis

AI-Verse Data was not chosen because AI-Verse needed another repository for its own sake.

The need emerged from comparing the existing AI-Verse architecture with AI-native platforms that treat structured operational records as a first-class surface.

The most important inputs were:

### Existing AI-Verse architecture

Reviewed directly before this specification:

- AI-Verse OS v2 architecture, source-of-truth rules, expansion policy, runtime contract, action-permission boundary, extension registry, and capability-provider direction;
- AI-Verse Memory v0.2 canonical Markdown / rebuildable SQLite design and installer;
- AI-Verse Brain public-beta ownership/adapters model;
- AI-Verse Skills external provider and immutable-generation integration contract;
- AI-Verse Multiple Bots canonical teammate architecture, capability leases, execution model, and native OS extension registration;
- AI-Verse Dashboard multi-OS, read-model, and canonical SQLite projection architecture;
- AI-Verse Apps founding architecture;
- AI-Verse Connections founding architecture.

### Kylon

Kylon highlighted the value of putting structured databases/apps directly in an AI-native workspace so agents and humans operate on durable records rather than only conversations and documents.

Reference:

- https://kylon.io/

The relevant lesson is not to clone Kylon. It is to recognize that operational systems such as CRM, production tracking, finance, and app records need first-class structured truth.

### SQLite

Official SQLite documentation was reviewed for:

- transactions/isolation;
- Write-Ahead Logging;
- STRICT tables;
- JSON functions;
- integrity behavior.

References:

- https://sqlite.org/wal.html
- https://sqlite.org/isolation.html
- https://sqlite.org/stricttables.html
- https://sqlite.org/json1.html
- https://sqlite.org/docs.html

Key facts affecting the design:

- WAL permits concurrent readers with a writer, but writers remain serialized and WAL is designed for processes on the same host rather than a network-shared database file;
- STRICT tables provide stronger type enforcement for internal SQLite tables;
- SQLite includes JSON functions in modern builds, allowing structured payload queries without making JSON/SQLite details part of the public Data API;
- integrity checks can validate stored database state.

### Node SQLite ecosystem

Node's built-in `node:sqlite` was reviewed. As of the current documentation it is a release-candidate API, not yet the stability level chosen as the long-lived public implementation dependency for v0.1.

Reference:

- https://nodejs.org/api/sqlite.html

`better-sqlite3` was also reviewed as a mature current local SQLite binding with active 2026 releases and prebuilt binaries for supported Node platforms.

Reference:

- https://github.com/WiseLibs/better-sqlite3

The architecture therefore puts SQLite behind a storage-driver interface so this dependency can change without changing the public Data protocol.

## 2. Decision D001: Data remains a separate repository from Memory

**Decision:** accepted.

### Why

Memory's SQLite database is explicitly derived and rebuildable from canonical historical/context Markdown.

Data's local database may itself be canonical operational truth.

The statements:

```text
"Delete this SQLite file and rebuild it."
```

and:

```text
"Deleting this SQLite file destroys the CRM."
```

cannot safely describe the same storage layer.

### Consequence

Data and Memory integrate through provenance/retrieval/candidate-memory contracts, not shared canonical ownership.

## 3. Decision D002: workspace-first canonical storage

**Decision:** accepted for v0.1.

Native path:

```text
workspaces/<workspace-id>/data/ai-verse-data.sqlite
```

### Why

- workspace is already the universal AI-Verse isolation primitive;
- structured operational truth usually belongs to a concrete work scope;
- physical separation strengthens isolation;
- avoids adding a new root-level `data/` layer to AI-Verse OS;
- follows OS expansion policy rather than changing the core architecture prematurely.

### Deferred

Operator-wide/shared Data requires a later explicit authority design.

## 4. Decision D003: one physical SQLite database per workspace

**Decision:** accepted for v0.1.

Multiple logical Data Spaces share the workspace database.

### Why

- one backup target per workspace;
- atomic transactions across related spaces when required;
- simple path/identity validation;
- lower operational complexity;
- adequate local concurrency for first release.

### Tradeoff

SQLite serializes writers. If future high-volume or multi-user deployment outgrows this, a server storage driver can preserve the public API with a different physical layout.

## 5. Decision D004: fixed internal tables, logical user schemas

**Decision:** accepted.

User-created entities do not become arbitrary SQL DDL generated directly by an LLM.

The engine maintains fixed internal tables for spaces, schemas, records, relations, events, idempotency, and migrations. User records are stored as validated structured payloads with schema metadata.

### Why

- safer for agent-generated schemas;
- easier schema versioning;
- stable backup/export/provenance;
- avoids arbitrary DDL privileges;
- simplifies future alternate drivers.

### Deferred optimization

The engine may later introduce generated indexes/materialization for performance without changing the logical API.

## 6. Decision D005: no raw SQL in normal agent/App API

**Decision:** accepted.

Callers use structured query/mutation operations.

### Why

LLMs can hallucinate identifiers, produce overbroad statements, or execute destructive SQL. A typed AST allows validation and capability enforcement before compilation.

A future admin SQL console, if ever added, is a separate privileged product surface.

## 7. Decision D006: TypeScript + Node 22+ core

**Decision:** accepted for initial implementation.

### Why

- aligns with AI-Verse Multiple Bots and OS tooling;
- integrates naturally with future Dashboard/Apps TypeScript clients;
- strong schema/type tooling;
- cross-platform runtime;
- easy CLI and local service packaging;
- straightforward JSON protocol implementation.

Node 22+ is the minimum direction. Exact supported versions will be pinned in package/CI during Phase 1 and reviewed against dependency support.

## 8. Decision D007: SQLite first, storage driver abstracted

**Decision:** accepted.

### Why SQLite

- local-first;
- transactional;
- portable single-file canonical storage;
- mature;
- inspectable and backup-friendly;
- supports required query/index functionality;
- suitable for one-user/local-agent OS use.

### Why abstraction

Future hosted/team AI-Verse may need a server database. Apps/Bots/Dashboard should not need to be rewritten just because physical storage changes.

## 9. Decision D008: prefer mature SQLite binding behind the driver

**Decision:** implementation preference, subject to Phase 1 dependency verification.

Initial candidate: `better-sqlite3`.

### Why

It is mature, actively maintained, and keeps a small local operational model.

### Why not expose it

The public API must not depend on library-specific connection/query objects.

Node's `node:sqlite` can be reconsidered later as its API stabilizes.

## 10. Decision D009: use WAL only for local supported storage

**Decision:** accepted.

### Why

WAL improves local read/write concurrency and fits multiple agents/UI readers.

### Constraint

WAL should not be used as a scheme for sharing one SQLite database file across machines/network filesystems.

Future multi-user remote deployments should use a server driver.

## 11. Decision D010: extension registry is the native installation hook

**Decision:** accepted.

Data installs through:

```text
.aiverse/extensions/registry.json
```

and owns only its own local extension entry/files.

### Why

This is the existing OS-supported optional-extension path and Multiple Bots has already hardened its safe registration pattern.

### Consequence

Normal Data installation does not edit tracked `AGENTS.md`, `AI-VERSE.yaml`, `skills/registry.yaml`, or other OS files.

## 12. Decision D011: canonical records survive uninstall

**Decision:** accepted.

### Why

Canonical workspace records are user-owned state, not package files.

Uninstall removes software/registration, not user truth.

Permanent purge is a separate explicit destructive operation.

## 13. Decision D012: Dashboard `systemId` is not canonical Data identity

**Decision:** accepted.

### Why

Dashboard's `systemId` is a local UI/Gateway connection identifier. Data must work without Dashboard.

Canonical native identity derives from the trusted OS root and verified workspace.

Dashboard can add its `systemId` at its own boundary.

## 14. Decision D013: v0.1 supports only `local_canonical`

**Decision:** accepted.

### Why

External sync semantics are easy to get wrong. Supporting `external_canonical`, replicated, or bidirectional sync before conflict/authority rules exist would undermine source-of-truth discipline.

Connections remains the route to external systems until a deliberate sync phase is designed.

## 15. Decision D014: soft delete by default

**Decision:** accepted.

### Why

Agents can make mistakes and operational audit/recovery matters.

Normal delete changes record lifecycle state rather than irreversibly purging bytes.

Hard purge is a separate future administrative capability.

## 16. Decision D015: optimistic concurrency plus idempotency

**Decision:** accepted.

Both are required because they solve different problems:

```text
optimistic version
-> prevents stale concurrent overwrite

idempotency key
-> prevents duplicate effect after retry/timeout
```

Neither substitutes for the other.

## 17. Decision D016: Data events are not automatic Memory

**Decision:** accepted.

Data keeps mutation events because it needs audit/provenance and future reactive integration.

Memory remains selective historical recall.

A future memory-candidate mechanism may derive a meaningful Memory entry from selected Data history, but ordinary CRUD does not flood Memory.

## 18. Decision D017: Apps do not own canonical records

**Decision:** accepted.

An App may define/maintain an entity schema through a declared contract, but Data owns the records.

Removing an App preserves its Data by default.

This prevents AI-generated Apps from becoming hidden data silos.

## 19. Decision D018: Data does not become the scheduler

**Decision:** accepted.

Data emits facts/events. OS/Automations decide which events trigger work.

No cron/workflow engine belongs in Data.

## 20. Decision D019: Data does not authenticate humans

**Decision:** accepted.

Data records actor attribution and consumes trusted auth context.

A future AI-Verse identity/access layer owns human accounts, tenant membership, and login/session authentication.

This keeps the local single-user release simple without blocking future multi-user operation.

## 21. Decision D020: standalone is optional portability, not an incompatible-host fallback

**Decision:** accepted.

Data can eventually run standalone under `.ai-verse-data/`.

But if an AI-Verse host is detected and incompatible, installation fails. It must not create a parallel store that appears integrated when it is not.

## 22. Deferred questions

The following are intentionally postponed until first-release requirements justify them:

- operator/shared cross-workspace Data;
- Postgres/server driver;
- semantic search/indexing over records;
- formulas/computed fields;
- row/field ACLs for multi-user platform mode;
- materialized views;
- external sync engine;
- real-time remote subscriptions;
- hard-delete retention policy;
- multi-database transaction semantics;
- schema package marketplace;
- domain-specific types beyond the small v0.1 type system.

## 23. Architecture change rule

These decisions are meant to prevent scope drift during implementation.

If code work discovers that one of these decisions is unsound, do not silently work around it. Update this decision record and the affected canonical docs with the reason before merging the architectural change.
