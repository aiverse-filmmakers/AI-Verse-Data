# AI-Verse Data Build Map

**Updated:** 2026-09-10  
**Status:** Phase 1 in progress  
**Implementation progress:** 1 / 41 tasks complete  
**Next:** Task 2 / 41, Phase 1.2 - Protocol types and validators

This is the canonical implementation ledger for AI-Verse Data. Update it whenever a meaningful implementation task lands so the repository itself always shows what is complete, what is next, and which gate proves completion.

## Definition of first complete release

The first complete release is reached when Phases 0 through 5 are complete and the full release acceptance suite passes.

The target is an installable local-first structured-data layer that can run standalone or attach safely to AI-Verse OS, store canonical workspace-scoped structured records, serve humans/agents/Apps through safe typed operations, preserve one source of truth, and integrate with the wider AI-Verse ecosystem without duplicating Memory, Brain, Bots, Connections, Apps, or Dashboard state.

## Current position

```text
Phase 0  Product + Architecture        [COMPLETE]      100%
Phase 1  Core Data Engine              [IN PROGRESS]    11%  (1/9)
Phase 2  Reliability + Agent Safety    [NOT STARTED]     0%
Phase 3  Native AI-Verse Integration   [NOT STARTED]     0%
Phase 4  Ecosystem Adapters            [NOT STARTED]     0%
Phase 5  Release Hardening             [NOT STARTED]     0%
```

Overall implementation: **1 / 41 tasks complete**.

---

# Phase 0 - Product + Architecture

**Status:** COMPLETE

Completed foundation documents:

1. `README.md`
2. `docs/PRD.md`
3. `docs/ARCHITECTURE.md`
4. `docs/DATA-MEMORY-BOUNDARY.md`
5. `docs/ECOSYSTEM-INTEGRATION.md`
6. `docs/INSTALLATION-AND-LIFECYCLE.md`
7. `docs/PROTOCOL-V0.1.md`
8. `docs/SECURITY-AND-AUTHORITY.md`
9. `docs/TESTING-AND-ACCEPTANCE.md`
10. `docs/RESEARCH-AND-DECISIONS.md`
11. `docs/BUILD-MAP.md`

### Phase 0 locked decisions

- Data remains separate from Memory.
- v0.1 is workspace-first.
- native canonical DB path is `workspaces/<workspace-id>/data/ai-verse-data.sqlite`.
- one physical SQLite DB per workspace.
- user schemas are logical, not arbitrary model-generated SQL DDL.
- raw SQL is not a normal agent/App API.
- TypeScript + Node 22+ is the implementation direction.
- SQLite is the first backend behind a stable driver abstraction.
- optimistic versions and idempotency are required.
- soft delete is default.
- Data events are not automatic Memory.
- native install uses the OS local extension registry.
- install/update/uninstall must not modify tracked OS files or sibling repo state.
- uninstall preserves canonical Data.

**Phase 0 gate: PASSED.**

---

# Phase 1 - Core Data Engine

**Status:** IN PROGRESS  
**Progress:** 1 / 9 tasks complete

Goal: produce a runnable host-neutral Data engine with one SQLite driver and the safe structured primitives required for useful local operation.

## Task 1 / 41 - Phase 1.1 Repository/package foundation

**Status:** COMPLETE

Implemented:

- Node 22+ package metadata;
- strict TypeScript configuration;
- ESM package/export boundary;
- source/test layout;
- `ai-verse-data` CLI shell;
- `--help` and `--version`;
- explicit unsupported-argument failure;
- public foundation status surface;
- Node test harness;
- build/test/check scripts;
- Git ignore rules;
- GitHub Actions CI on Node 22 and Node 24.

Verification:

```text
Local:       5/5 tests passed
GitHub CI:   Node 22 PASS
GitHub CI:   Node 24 PASS
CI run:      34505126081
```

No SQLite, CRUD, schemas, queries, or integration behavior was introduced early.

Detailed evidence: `docs/PHASE-1-STATUS.md`.

**Task 1.1 gate: PASSED.**

## Task 2 / 41 - Phase 1.2 Protocol types and validators

**Status:** NEXT

Implement:

- public operation envelopes;
- stable result/error envelopes;
- IDs;
- actor model;
- Data Space/schema/record types;
- query AST types;
- first-release field types;
- runtime validation;
- request size/shape ceilings.

Acceptance:

- malformed envelopes rejected deterministically;
- unknown operations fail explicitly;
- protocol/database/schema versions remain distinct.

Do not implement SQLite in this task.

## Task 3 / 41 - Phase 1.3 Storage-driver contract + SQLite bootstrap

**Status:** NOT STARTED

Implement storage-driver interface, SQLite driver/bootstrap, internal metadata schema, foreign keys, local WAL policy, STRICT internal tables where practical, feature/version checks, and DB format versioning.

Acceptance: create/reopen works, metadata survives restart, unsupported format fails closed, integrity check works.

## Task 4 / 41 - Phase 1.4 Scope and database identity

**Status:** NOT STARTED

Implement trusted-root abstraction, workspace/database binding metadata, safe path helpers, and native-ready scope without depending on Dashboard `systemId`.

Acceptance: DB cannot be reopened under conflicting workspace identity and public record/query requests do not accept raw DB paths.

## Task 5 / 41 - Phase 1.5 Data Spaces and entity schemas

**Status:** NOT STARTED

Implement create/list/get Data Spaces, entity schemas, field validation, schema versions/digests, and safe additive schema updates.

Acceptance: invalid schema changes are atomic; unsupported destructive change returns migration-required.

## Task 6 / 41 - Phase 1.6 Record CRUD

**Status:** NOT STARTED

Implement create/get/list/update/soft-delete, schema validation, defaults, stable record IDs/timestamps, and initial actor attribution.

Acceptance: CRUD survives reopen, invalid fields fail, soft-deleted records remain hidden by normal reads unless explicitly requested.

## Task 7 / 41 - Phase 1.7 Safe query + aggregate engine

**Status:** NOT STARTED

Implement bounded query AST, filters, sorting, cursor pagination, field selection, count/sum/min/max/avg, and parameterized compilation.

Acceptance: no SQL injection path through values or field identifiers, invalid type/operator combinations fail, server ceilings override callers.

## Task 8 / 41 - Phase 1.8 Relations + bounded transactions

**Status:** NOT STARTED

Implement declared references, relation validation/indexing, atomic multi-record transactions, bounded operation counts, and safe intra-transaction references if retained in v0.1.

Acceptance: invalid references prevent commit and failed transactions leave no required partial state.

## Task 9 / 41 - Phase 1.9 Phase 1 integration gate

**Status:** NOT STARTED

Run the complete Phase 1 acceptance suite in `docs/TESTING-AND-ACCEPTANCE.md`.

**Phase 1 completes only after this gate passes.**

---

# Phase 2 - Reliability + Agent Safety

**Status:** NOT STARTED

Goal: harden the core for concurrent agents, retries, auditability, backup, failures, and schema/engine evolution.

## Task 10 / 41 - Phase 2.1 Optimistic concurrency

Record versions, `expectedVersion`, structured conflict errors, race tests.

## Task 11 / 41 - Phase 2.2 Idempotent mutations

Persistent idempotency keys, canonical request fingerprints, same-key replay behavior, conflicting replay rejection.

## Task 12 / 41 - Phase 2.3 Events, receipts, provenance

Append-oriented Data events, mutation receipts, actor attribution, transaction/event atomicity, event queries.

## Task 13 / 41 - Phase 2.4 Bulk-operation safety and limits

Bounded bulk operations, preview/dry-run for consequential mutations, hard size/count ceilings.

## Task 14 / 41 - Phase 2.5 Backup/export/import foundation

Consistent canonical backup, manifests/digests/receipts, verified portable export/import where appropriate.

## Task 15 / 41 - Phase 2.6 Internal migration framework

Database-format migrations, migration ledger, compatibility gates, interrupted migration behavior, rollback/backup strategy.

## Task 16 / 41 - Phase 2.7 User-schema migration framework

Safe additive changes, backfill plans, destructive-change preview/rejection, owner/provenance metadata.

## Task 17 / 41 - Phase 2.8 Corruption/recovery behavior

Corruption detection, fail-closed writes, recovery reporting, no silent replacement with empty DB.

## Task 18 / 41 - Phase 2.9 Phase 2 gate

Run the full reliability/adversarial suite.

**Phase 2 completes only after this gate passes.**

---

# Phase 3 - Native AI-Verse Integration

**Status:** NOT STARTED

Goal: make Data install into AI-Verse OS v2 like a native optional layer without modifying tracked OS files or sibling canonical state.

## Task 19 / 41 - Phase 3.1 AI-Verse OS compatibility detector

v2/unified-workspace detection, extension-contract verification, safe file/path checks, explicit `compatible` / `no-os` / `incompatible` results.

## Task 20 / 41 - Phase 3.2 Hardened extension materialization/registration

Install extension-owned files, register only `ai-verse-data`, preserve unknown entries/fields and disabled state, lock/re-read/atomic-write registry, enforce symlink/path safety, never edit tracked OS files.

## Task 21 / 41 - Phase 3.3 Native workspace resolver + Data initialization

Trusted OS root, exact workspace identity/status checks, safe workspace Data path, explicit initialization, existing-DB discovery, no initialize-all-workspaces side effect.

## Task 22 / 41 - Phase 3.4 Extension instructions/runtime discovery

Task-relevant extension instructions through the local extension hook without permanent edits to `AGENTS.md` or tracked runtime adapters.

## Task 23 / 41 - Phase 3.5 Native CLI install/update/disable/uninstall

Install, update, enable/disable, uninstall software while preserving canonical workspace DBs. Purge remains separate/destructive.

## Task 24 / 41 - Phase 3.6 Native doctor + status

Verify registration, engine health, workspace DB state, SQLite features, binding, integrity, migration status, and optional sibling absence.

## Task 25 / 41 - Phase 3.7 Installation-order/registry coexistence suite

Test representative orders with Memory, Brain, Multiple Bots, Skills metadata, and unrelated extension entries.

## Task 26 / 41 - Phase 3.8 Phase 3 gate

Run the native install acceptance story.

**After this passes, Data is a useful installable release candidate even without optional ecosystem adapters.**

---

# Phase 4 - Ecosystem Adapters

**Status:** NOT STARTED

Goal: make other AI-Verse layers consume Data through explicit contracts while ownership remains separate.

No sibling repo may be modified automatically in this phase. Any consumer-side change requires a separately approved task.

## Task 27 / 41 - Phase 4.1 Typed Data client SDK

Stable typed client over the public protocol.

## Task 28 / 41 - Phase 4.2 Multiple Bots Data adapter

Capability-lease-scoped access, Bot/Worker provenance, Task/Artifact-linked receipts, no privilege laundering.

## Task 29 / 41 - Phase 4.3 Brain structured-data adapter contract

Bounded structured Data retrieval suitable for Brain host adapters without copying Data into Brain state.

## Task 30 / 41 - Phase 4.4 Memory provenance/candidate bridge

Stable Data source references, evidence lookup, optional candidate-memory shape, no automatic Memory writes.

## Task 31 / 41 - Phase 4.5 Dashboard projection adapter

Data-side query/health/provenance surfaces for Dashboard Gateway. Browser never receives raw DB paths.

## Task 32 / 41 - Phase 4.6 Apps Data contract

App-friendly schema/client/permission metadata so generated Apps can use Data instead of embedding competing canonical DBs.

## Task 33 / 41 - Phase 4.7 Connections authority boundary

Local-vs-external authority metadata and import/source-reference contracts. No bidirectional sync until separately designed.

## Task 34 / 41 - Phase 4.8 Automation event adapter

Committed Data event subscription suitable for OS automation/activation without adding a scheduler to Data.

## Task 35 / 41 - Phase 4.9 Phase 4 gate

Prove adapters preserve ownership, workspace scope, permissions, receipts, and optionality.

---

# Phase 5 - Release Hardening

**Status:** NOT STARTED

Goal: make the package safe for members to install and use on real machines.

## Task 36 / 41 - Phase 5.1 Cross-platform CI matrix

macOS, Linux, Windows, supported Node versions, build/package/install smoke tests.

## Task 37 / 41 - Phase 5.2 Full adversarial filesystem/security suite

Traversal, symlink/reparse escapes, Windows path cases, malformed registries, stale locks, oversized inputs, corrupt DBs, capability forgery.

## Task 38 / 41 - Phase 5.3 Performance baseline

Measure open/create/update/query/aggregate/transaction/event growth/doctor behavior and set product budgets from evidence.

## Task 39 / 41 - Phase 5.4 Documentation/examples

CRM, content planner, production tracker, Bot-safe operations, backup/reinstall, Data-vs-Memory guidance.

## Task 40 / 41 - Phase 5.5 Packaging and simple install command

Stable distribution metadata and clean GitHub install path, then optional npm publication when appropriate.

## Task 41 / 41 - Phase 5.6 Full release acceptance suite

Prove the complete release story from `docs/TESTING-AND-ACCEPTANCE.md` on clean environments.

**First release completes only when Task 41 passes.**

---

# Deferred after first release

Not first-release scope:

- hosted multi-user server backend;
- Postgres/remote driver;
- operator/shared cross-workspace Data Spaces;
- row-level/field-level multi-human ACLs;
- bidirectional external sync;
- formulas/computed fields;
- advanced search/vector indexes;
- materialized analytics views;
- arbitrary SQL console;
- hard-purge automation;
- cross-workspace transactions.

These require separate architecture work and must not sneak into current tasks.

---

# Non-negotiable implementation laws

1. Data is not Memory.
2. Canonical workspace Data is user-owned and survives uninstall.
3. Data never writes canonical sibling-layer state as an integration shortcut.
4. No normal agent API accepts raw SQL or canonical DB paths.
5. Workspace isolation is enforced technically, not only by prompt.
6. Dashboard `systemId` is not Data's canonical identity.
7. SQLite is an implementation driver, not the public Data contract.
8. Data events are audit facts, not automatic Memory.
9. Registration is not permission, health, or workspace authorization.
10. Cross-repo changes are separate explicit tasks, never hidden side effects.
11. One task is completed and verified before the next task starts.

---

# Next task

**Task 2 / 41: Phase 1.2 - Protocol types and validators.**

Do not begin Task 3 / 41 until Task 2 is implemented, tested, committed, and reported complete.
