# AI-Verse Data Build Map

**Updated:** 2026-09-10  
**Status:** Phase 1 in progress  
**Implementation progress:** 2 / 41 tasks complete  
**Next:** Task 3 / 41, Phase 1.3 - Storage-driver contract + SQLite bootstrap

This is the canonical implementation ledger for AI-Verse Data. Update it whenever a meaningful implementation task lands so the repository itself always shows what is complete, what is next, and which gate proves completion.

## Definition of first complete release

The first complete release is reached when Phases 0 through 5 are complete and the full release acceptance suite passes.

The target is an installable local-first structured-data layer that can run standalone or attach safely to AI-Verse OS, store canonical workspace-scoped structured records, serve humans/agents/Apps through safe typed operations, preserve one source of truth, and integrate with the wider AI-Verse ecosystem without duplicating Memory, Brain, Bots, Connections, Apps, or Dashboard state.

## Current position

```text
Phase 0  Product + Architecture        [COMPLETE]      100%
Phase 1  Core Data Engine              [IN PROGRESS]    22%  (2/9)
Phase 2  Reliability + Agent Safety    [NOT STARTED]     0%
Phase 3  Native AI-Verse Integration   [NOT STARTED]     0%
Phase 4  Ecosystem Adapters            [NOT STARTED]     0%
Phase 5  Release Hardening             [NOT STARTED]     0%
```

Overall implementation: **2 / 41 tasks complete**.

---

# Phase 0 - Product + Architecture

**Status:** COMPLETE

Canonical foundation documents:

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

Locked laws include: Data stays separate from Memory; v0.1 is workspace-first; one physical SQLite database per workspace; raw SQL is not a normal agent/App API; SQLite sits behind a stable driver contract; optimistic versions/idempotency/soft delete are required; Data events are not automatic Memory; native install uses the OS extension registry; uninstall preserves canonical user Data.

**Phase 0 gate: PASSED.**

---

# Phase 1 - Core Data Engine

**Status:** IN PROGRESS  
**Progress:** 2 / 9 tasks complete

Goal: produce a runnable host-neutral Data engine with one SQLite driver and the safe structured primitives required for useful local operation.

## Task 1 / 41 - Phase 1.1 Repository/package foundation

**Status:** COMPLETE

Implemented Node 22+ package metadata, strict TypeScript, ESM package/export boundaries, CLI shell, source/test layout, build/test/check scripts, `.gitignore`, and Node 22/24 GitHub CI.

Verification:

```text
Local:       5/5 tests passed
GitHub CI:   Node 22 PASS
GitHub CI:   Node 24 PASS
CI run:      34505126081
```

**Task 1.1 gate: PASSED.**

## Task 2 / 41 - Phase 1.2 Protocol types and validators

**Status:** COMPLETE

Implemented:

- `ai-verse-data/0.1` protocol constant;
- operation registry;
- discriminated request envelopes;
- stable success/failure response envelopes;
- machine-readable error codes;
- workspace scope and actor model;
- authorization metadata;
- Data Space/schema/record types;
- first-release field types;
- additive schema-change types;
- query AST, operators, sort, aggregate types;
- bounded transaction types;
- runtime validators for requests/responses/fields/query filters;
- strict unknown-field rejection;
- safe identifier/slug validation;
- cyclic/non-finite JSON rejection;
- hard bounded defaults for requests, records, schemas, filters, pages, transactions, events, and nested JSON;
- public `@ai-verse/data/protocol` export.

Security proof includes explicit rejection of raw SQL/database-path extras in normal protocol operations.

Verification on the final implementation head:

```text
GitHub Actions run: 34508602201
Node 22:             PASS
Node 24:             PASS
Tests:               18 / 18 PASS
Failures:            0
```

No SQLite/storage execution was introduced.

Detailed evidence: `docs/PHASE-1-STATUS.md`.

**Task 1.2 gate: PASSED.**

## Task 3 / 41 - Phase 1.3 Storage-driver contract + SQLite bootstrap

**Status:** NEXT

Implement only the storage foundation:

- storage-driver interface;
- SQLite driver/binding;
- database create/open/close;
- internal `_meta`/format metadata;
- SQLite feature/version checks;
- foreign keys;
- local WAL policy;
- STRICT internal tables where practical;
- internal database format version;
- read-only integrity/status primitives needed by later doctor work.

Acceptance:

- create and reopen database successfully;
- format metadata survives restart;
- unsupported database format fails closed;
- integrity check works;
- public protocol remains SQLite-neutral;
- no Data Space/schema/record CRUD is implemented early.

## Task 4 / 41 - Phase 1.4 Scope and database identity

**Status:** NOT STARTED

Trusted-root abstraction, workspace/database binding metadata, safe path helpers, no Dashboard `systemId` dependency.

Acceptance: a database cannot be reopened under conflicting workspace identity and public record/query requests never accept raw DB paths.

## Task 5 / 41 - Phase 1.5 Data Spaces and entity schemas

**Status:** NOT STARTED

Create/list/get Data Spaces and entity schemas, field validation, schema versions/digests, safe additive schema updates.

Acceptance: invalid schemas fail atomically; destructive unsupported changes return migration-required.

## Task 6 / 41 - Phase 1.6 Record CRUD

**Status:** NOT STARTED

Create/get/list/update/soft-delete, schema validation, defaults, stable record IDs/timestamps, initial actor attribution.

Acceptance: CRUD survives reopen, invalid fields fail, deleted records are hidden by normal reads unless explicitly requested.

## Task 7 / 41 - Phase 1.7 Safe query + aggregate engine

**Status:** NOT STARTED

Bounded query AST execution, filters, sorting, cursor pagination, field selection, count/sum/min/max/avg, parameterized compilation.

Acceptance: no SQL-injection path, invalid field/type/operator combinations fail, server ceilings override callers.

## Task 8 / 41 - Phase 1.8 Relations + bounded transactions

**Status:** NOT STARTED

Declared references, relation validation/indexing, atomic multi-record transactions, bounded operation counts, safe intra-transaction references if retained.

Acceptance: invalid references prevent commit and failed transactions leave no required partial state.

## Task 9 / 41 - Phase 1.9 Phase 1 integration gate

**Status:** NOT STARTED

Run the full Phase 1 acceptance suite in `docs/TESTING-AND-ACCEPTANCE.md`.

**Phase 1 completes only after this gate passes.**

---

# Phase 2 - Reliability + Agent Safety

**Status:** NOT STARTED

## Task 10 / 41 - Phase 2.1 Optimistic concurrency
Record versions, `expectedVersion`, conflict errors, race tests.

## Task 11 / 41 - Phase 2.2 Idempotent mutations
Persistent idempotency keys, canonical request fingerprints, replay semantics, conflict rejection.

## Task 12 / 41 - Phase 2.3 Events, receipts, provenance
Append-oriented Data events, mutation receipts, actor attribution, transaction/event atomicity, event queries.

## Task 13 / 41 - Phase 2.4 Bulk-operation safety and limits
Bounded bulk operations, dry-run/preview, hard size/count ceilings.

## Task 14 / 41 - Phase 2.5 Backup/export/import foundation
Consistent backup, manifests/digests/receipts, verified portable export/import where appropriate.

## Task 15 / 41 - Phase 2.6 Internal migration framework
Database-format migrations, migration ledger, compatibility gates, interruption behavior, rollback/backup strategy.

## Task 16 / 41 - Phase 2.7 User-schema migration framework
Safe additive changes, backfill plans, destructive-change controls, owner/provenance metadata.

## Task 17 / 41 - Phase 2.8 Corruption/recovery behavior
Corruption detection, fail-closed writes, recovery reporting, no silent empty replacement.

## Task 18 / 41 - Phase 2.9 Phase 2 gate
Run the full reliability/adversarial suite.

---

# Phase 3 - Native AI-Verse Integration

**Status:** NOT STARTED

## Task 19 / 41 - Phase 3.1 AI-Verse OS compatibility detector
v2/unified-workspace detection, extension-contract verification, safe path checks, explicit compatible/no-os/incompatible results.

## Task 20 / 41 - Phase 3.2 Hardened extension materialization/registration
Install extension-owned files and register only `ai-verse-data`; preserve unknown registry state and disabled state; lock/re-read/atomic-write; no tracked OS edits.

## Task 21 / 41 - Phase 3.3 Native workspace resolver + Data initialization
Trusted OS root, exact workspace identity/status checks, safe workspace Data path, explicit initialization, existing-DB discovery.

## Task 22 / 41 - Phase 3.4 Extension instructions/runtime discovery
Task-relevant extension instructions through the existing OS local extension hook.

## Task 23 / 41 - Phase 3.5 Native CLI install/update/disable/uninstall
Lifecycle commands while preserving canonical workspace databases; purge stays separate/destructive.

## Task 24 / 41 - Phase 3.6 Native doctor + status
Registration, engine health, DB state, SQLite features, binding, integrity, migration status.

## Task 25 / 41 - Phase 3.7 Installation-order/registry coexistence suite
Representative orders with Memory, Brain, Multiple Bots, Skills metadata, and unrelated extensions.

## Task 26 / 41 - Phase 3.8 Phase 3 gate
Run the complete native installation acceptance story.

---

# Phase 4 - Ecosystem Adapters

**Status:** NOT STARTED

No sibling repo may be modified automatically. Consumer-side changes require separately approved tasks.

## Task 27 / 41 - Phase 4.1 Typed Data client SDK
Stable typed client over the protocol.

## Task 28 / 41 - Phase 4.2 Multiple Bots Data adapter
Capability-lease-scoped access, Bot/Worker provenance, Task/Artifact-linked receipts, no privilege laundering.

## Task 29 / 41 - Phase 4.3 Brain structured-data adapter contract
Bounded structured Data retrieval suitable for Brain host adapters without copying Data into Brain state.

## Task 30 / 41 - Phase 4.4 Memory provenance/candidate bridge
Stable Data references/evidence lookup/candidate-memory shape, no automatic Memory writes.

## Task 31 / 41 - Phase 4.5 Dashboard projection adapter
Data-side query/health/provenance surfaces; browser never receives raw DB paths.

## Task 32 / 41 - Phase 4.6 Apps Data contract
App-friendly schema/client/permission metadata so Apps use Data rather than hidden competing databases.

## Task 33 / 41 - Phase 4.7 Connections authority boundary
Local-vs-external authority metadata and import/source-reference contracts; no implicit bidirectional sync.

## Task 34 / 41 - Phase 4.8 Automation event adapter
Committed Data event subscription for OS activation/automation without adding a scheduler to Data.

## Task 35 / 41 - Phase 4.9 Phase 4 gate
Prove adapters preserve ownership, scope, permissions, receipts, and optionality.

---

# Phase 5 - Release Hardening

**Status:** NOT STARTED

## Task 36 / 41 - Phase 5.1 Cross-platform CI matrix
macOS, Linux, Windows, supported Node versions, build/package/install smoke tests.

## Task 37 / 41 - Phase 5.2 Full adversarial filesystem/security suite
Traversal, symlink/reparse escapes, Windows paths, malformed registries, stale locks, oversized inputs, corrupt DBs, capability forgery.

## Task 38 / 41 - Phase 5.3 Performance baseline
Measure open/create/update/query/aggregate/transaction/event/doctor behavior and set evidence-based budgets.

## Task 39 / 41 - Phase 5.4 Documentation/examples
CRM, content planner, production tracker, Bot-safe operations, backup/reinstall, Data-vs-Memory guidance.

## Task 40 / 41 - Phase 5.5 Packaging and simple install command
Stable distribution metadata and clean GitHub install path, then optional npm publication when appropriate.

## Task 41 / 41 - Phase 5.6 Full release acceptance suite
Prove the complete release story on clean environments.

**First release completes only when Task 41 passes.**

---

# Deferred after first release

Hosted multi-user backend, Postgres/remote driver, operator/shared cross-workspace Data Spaces, row/field multi-human ACLs, bidirectional external sync, formulas/computed fields, advanced vector/search indexes, materialized analytics views, arbitrary SQL console, hard-purge automation, and cross-workspace transactions remain outside first-release scope.

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

**Task 3 / 41: Phase 1.3 - Storage-driver contract + SQLite bootstrap.**

Do not begin Task 4 / 41 until Task 3 is implemented, tested, committed, and reported complete.
