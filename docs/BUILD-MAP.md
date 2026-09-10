# AI-Verse Data Build Map

**Updated:** 2026-09-10  
**Status:** Phase 0 complete, implementation not started

This is the canonical progress map for AI-Verse Data.

Update it whenever a meaningful implementation slice lands so the repository itself always shows:

- where the build is;
- what is complete;
- what is next;
- which acceptance gate proves completion;
- which architecture boundaries must not be bypassed.

## Definition of first complete release

The first complete release is reached when Phases 0 through 5 are complete and the full release acceptance suite passes.

The target is an installable local-first structured-data layer that can run standalone or attach safely to AI-Verse OS, store canonical workspace-scoped structured records, serve humans/agents/Apps through safe typed operations, preserve one source of truth, and integrate with the wider AI-Verse ecosystem without duplicating Memory, Brain, Bots, Connections, or Dashboard state.

## Current position

```text
Phase 0  Product + Architecture        [COMPLETE]      100%
Phase 1  Core Data Engine              [NOT STARTED]     0%
Phase 2  Reliability + Agent Safety    [NOT STARTED]     0%
Phase 3  Native AI-Verse Integration   [NOT STARTED]     0%
Phase 4  Ecosystem Adapters            [NOT STARTED]     0%
Phase 5  Release Hardening             [NOT STARTED]     0%
```

No production code has been written yet.

---

# Phase 0 - Product + Architecture

**Status:** COMPLETE

Goal: lock the product, authority boundaries, storage direction, protocol, installation model, integration rules, safety model, and acceptance gates before implementation.

Completed documents:

1. `README.md` - project north star and founding context.
2. `docs/PRD.md` - product requirements and first-release scope.
3. `docs/ARCHITECTURE.md` - canonical technical architecture.
4. `docs/DATA-MEMORY-BOUNDARY.md` - explicit Data vs Memory ownership law.
5. `docs/ECOSYSTEM-INTEGRATION.md` - OS/Brain/Memory/Skills/Bots/Dashboard/Apps/Connections boundaries.
6. `docs/INSTALLATION-AND-LIFECYCLE.md` - install/update/disable/uninstall/preserve rules.
7. `docs/PROTOCOL-V0.1.md` - first operation/query/mutation protocol direction.
8. `docs/SECURITY-AND-AUTHORITY.md` - scope, permission, concurrency, path, and destructive-action rules.
9. `docs/TESTING-AND-ACCEPTANCE.md` - phase gates and adversarial acceptance plan.
10. `docs/RESEARCH-AND-DECISIONS.md` - research basis and explicit architecture decisions.
11. `docs/BUILD-MAP.md` - this canonical implementation ledger.

### Phase 0 gate

**PASSED by documentation completion.**

Before Phase 1 starts, implementation must follow these locked decisions unless a deliberate architecture amendment is documented:

- Data remains separate from Memory.
- v0.1 is workspace-first.
- native canonical database path is `workspaces/<workspace-id>/data/ai-verse-data.sqlite`.
- one physical SQLite database per workspace.
- user schemas are logical, not direct model-generated SQL DDL.
- raw SQL is not a normal agent/App API.
- TypeScript + Node 22+ is the core implementation direction.
- SQLite is the first storage backend behind a stable driver abstraction.
- `better-sqlite3` is the initial preferred binding subject to dependency verification.
- optimistic record versions and idempotency are both required.
- soft delete is default.
- Data events are not automatic Memory.
- native install uses the OS local extension registry.
- install/update/uninstall must not modify tracked OS files or sibling repo state.
- uninstall preserves canonical Data.

---

# Phase 1 - Core Data Engine

**Status:** NOT STARTED

Goal: produce a runnable host-neutral Data engine with one SQLite driver and the safe structured primitives required for useful local operation.

## Task 1.1 - Repository/package foundation

Build only the implementation skeleton:

- Node/TypeScript package;
- package metadata;
- TypeScript config;
- source/test layout;
- CLI entrypoint placeholder;
- build/test scripts;
- CI skeleton;
- no real Data CRUD yet.

Acceptance:

- clean install/build succeeds;
- CLI returns version/help;
- tests execute;
- no architecture rule is bypassed.

**This is the next task.**

## Task 1.2 - Protocol types and validators

Implement:

- public operation envelopes;
- stable result/error envelopes;
- IDs;
- actor model;
- Data Space/schema/record types;
- query AST types;
- first-release field types;
- runtime validation;
- request-size/shape ceilings.

Acceptance:

- malformed envelopes rejected deterministically;
- unknown operations fail explicitly;
- protocol/database/schema versions remain distinct.

## Task 1.3 - Storage-driver contract + SQLite bootstrap

Implement:

- storage-driver interface;
- SQLite driver;
- database open/create;
- `_meta` and initial internal schema;
- SQLite feature/version checks;
- foreign keys;
- local WAL policy;
- STRICT internal tables where practical;
- internal format version.

Acceptance:

- create/reopen database;
- format metadata survives restart;
- unsupported format fails closed;
- integrity check works.

## Task 1.4 - Scope and database identity

Implement host-neutral/standalone scope plus native-ready database identity primitives:

- trusted root abstraction;
- workspace/database binding metadata;
- safe path helper contracts;
- no Dashboard `systemId` dependency.

Do not implement OS extension registration yet.

Acceptance:

- database cannot be reopened under a conflicting workspace identity;
- direct raw path is not part of public record/query requests.

## Task 1.5 - Data Spaces and entity schemas

Implement:

- create/list/get Data Spaces;
- create/list/get entity schemas;
- field validation;
- schema digests/versions;
- additive schema update rules.

Acceptance:

- invalid schemas fail without partial state;
- destructive unsupported change returns migration-required.

## Task 1.6 - Record CRUD

Implement:

- create/get/list;
- update;
- soft delete;
- schema validation;
- defaults;
- stable record IDs/timestamps;
- initial actor attribution.

Acceptance:

- CRUD survives reopen;
- unknown/invalid fields rejected;
- soft-deleted records hidden by normal list/read policy unless explicitly requested.

## Task 1.7 - Safe query + aggregate engine

Implement:

- bounded query AST;
- filters;
- sorting;
- cursor pagination;
- field selection;
- count/sum/min/max/avg;
- parameterized compilation.

Acceptance:

- no SQL string injection path from values/field names;
- invalid field/operator/type combinations fail;
- server-side limits override caller request.

## Task 1.8 - Relations + bounded transactions

Implement:

- declared reference validation;
- relation index where needed;
- atomic multi-record transactions;
- bounded transaction operation count;
- intra-transaction record references if included in v0.1.

Acceptance:

- invalid reference prevents commit;
- failed transaction leaves no required partial records.

## Task 1.9 - Phase 1 integration gate

Run the full Phase 1 gate from `TESTING-AND-ACCEPTANCE.md`.

**Phase 1 complete only after the gate passes.**

---

# Phase 2 - Reliability + Agent Safety

**Status:** NOT STARTED

Goal: harden the core for multiple agents, retries, auditability, failures, backup, and schema/engine evolution.

## Task 2.1 - Optimistic concurrency

- monotonically increasing record version;
- `expectedVersion` on update/delete;
- structured conflict errors;
- race/adversarial tests.

## Task 2.2 - Idempotent mutations

- idempotency key store;
- canonical request fingerprint;
- same-key/same-effect replay;
- same-key/different-payload rejection;
- restart persistence.

## Task 2.3 - Events, receipts, provenance

- append-oriented Data events;
- mutation receipts;
- actor attribution;
- transaction/event atomicity;
- event query API.

## Task 2.4 - Bulk-operation safety and limits

- bounded bulk create/update where justified;
- preview/dry-run for consequential bulk mutation;
- operation count/size ceilings;
- no unbounded destructive operation.

## Task 2.5 - Backup/export/import foundation

- consistent canonical backup;
- manifest/digest/receipt;
- portable export/import format where practical;
- verification before claiming success.

## Task 2.6 - Internal migration framework

- database-format migrations;
- migration ledger;
- compatibility gates;
- backup/rollback strategy where needed;
- interrupted-migration behavior.

## Task 2.7 - User-schema migration framework

- safe additive changes;
- backfill plan contract;
- destructive-change preview/rejection until explicitly supported;
- schema-owner/provenance metadata.

## Task 2.8 - Corruption/recovery behavior

- corruption detection;
- fail-closed write policy;
- recovery reporting;
- no silent empty DB recreation.

## Task 2.9 - Phase 2 gate

Run full reliability/adversarial gate.

**Phase 2 complete only after all safety cases pass.**

---

# Phase 3 - Native AI-Verse Integration

**Status:** NOT STARTED

Goal: make Data install into AI-Verse OS v2 like a native optional layer without modifying tracked OS files or sibling canonical state.

## Task 3.1 - AI-Verse OS compatibility detector

Implement:

- v2/unified-workspace detection;
- runtime/extension-contract verification;
- safe file/path checks;
- `compatible`, `no-os`, `incompatible` distinction.

## Task 3.2 - Hardened extension materialization/registration

Implement:

- `.aiverse/extensions/ai-verse-data/` files;
- `ai-verse-data` registry entry;
- lock/re-read/merge/atomic write;
- unknown-field/entry preservation;
- disabled-state preservation;
- symlink/path safety;
- no tracked OS edits.

Use Multiple Bots' hardened registration behavior as the benchmark, not a looser writer.

## Task 3.3 - Native workspace resolver + Data initialization

Implement:

- trusted OS root;
- exact `WORKSPACE.yaml` ID/state checks;
- safe `workspaces/<id>/data/` path;
- explicit database initialization;
- existing DB discovery;
- no initialize-all-workspaces side effect.

## Task 3.4 - Extension instructions/runtime discovery

Implement Data-owned task-relevant instructions through the local extension hook so AI-Verse runtimes can recognize structured-data work without permanent edits to `AGENTS.md` or tracked skill adapters.

## Task 3.5 - Native CLI install/update/disable/uninstall

Implement lifecycle rules:

- install;
- update;
- disable/enable;
- uninstall software;
- preserve canonical workspace DBs;
- reinstall/recovery;
- purge remains separate/destructive.

## Task 3.6 - Native `doctor` + `status`

Prove:

- registration;
- engine health;
- workspace database state;
- SQLite features;
- workspace binding;
- integrity/migration status;
- missing optional siblings is not an error.

## Task 3.7 - Installation-order/registry coexistence suite

Test representative combinations with Memory, Brain, Multiple Bots, Skills metadata, and unrelated unknown extension entries.

## Task 3.8 - Phase 3 gate

Run the complete native installation acceptance story.

At this point AI-Verse Data becomes the **first useful installable release candidate** even before optional ecosystem adapters.

---

# Phase 4 - Ecosystem Adapters

**Status:** NOT STARTED

Goal: make other AI-Verse layers consume Data through explicit contracts while keeping ownership separate.

No existing sibling repository should be modified automatically from this phase. Any required cross-repo change is proposed and approved separately.

## Task 4.1 - Typed Data client SDK

Provide stable client package over the public protocol.

## Task 4.2 - Multiple Bots Data adapter

Data-side support for:

- capability-lease-scoped read/write;
- Bot/Worker actor provenance;
- mutation receipts linked to Task/Artifact provenance;
- no privilege laundering.

If Multiple Bots itself requires a consumer-side change, document/propose it separately before touching that repo.

## Task 4.3 - Brain structured-data adapter contract

Expose bounded Data querying suitable for a Brain host adapter.

Do not copy Data into Brain state.

Any Brain repository change requires a separate approved task.

## Task 4.4 - Memory provenance/candidate bridge

Provide:

- stable Data source references;
- event/record evidence lookup;
- optional candidate-memory input shape.

Do not auto-write Memory.

Any Memory repository change requires separate approval.

## Task 4.5 - Dashboard projection adapter

Provide Data-side query/health/provenance surfaces suitable for Dashboard Gateway.

Browser never sees raw DB path.

## Task 4.6 - Apps Data contract

Provide App-friendly schema/client/permission metadata so generated Apps can use Data without embedding their own canonical DB.

## Task 4.7 - Connections authority boundary

Lock local-vs-external authority metadata and import/source-reference contracts.

Do not build bidirectional sync until a dedicated sync design exists.

## Task 4.8 - Automation event adapter

Expose committed Data events in a normalized subscription form suitable for the OS automation/activation boundary without adding a scheduler to Data.

## Task 4.9 - Phase 4 gate

Prove adapters preserve ownership, workspace scope, permissions, receipts, and optionality.

---

# Phase 5 - Release Hardening

**Status:** NOT STARTED

Goal: make the package safe for members to install and use on real machines.

## Task 5.1 - Cross-platform CI matrix

- macOS;
- Linux;
- Windows;
- supported Node versions;
- package/build/install smoke tests.

## Task 5.2 - Full adversarial filesystem/security suite

- traversal;
- symlink/reparse escape;
- Windows paths;
- malformed registries;
- stale locks;
- oversized inputs;
- corrupt databases;
- capability forgery.

## Task 5.3 - Performance baseline

Measure representative:

- open;
- create/update;
- query;
- aggregate;
- transaction;
- event growth;
- doctor/integrity behavior.

Set product budgets based on measurements.

## Task 5.4 - Documentation/examples

Ship clear examples for:

- CRM;
- content planner;
- production tracker;
- Bot-safe operations;
- backup/reinstall;
- Data vs Memory guidance.

## Task 5.5 - Packaging and simple install command

Prepare stable distribution/package metadata and a clean GitHub install path, then optional npm publication when appropriate.

## Task 5.6 - Full release acceptance suite

Prove the complete story in `TESTING-AND-ACCEPTANCE.md` on clean environments.

**Phase 5 and first release are complete only when this passes.**

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

These require their own architecture work and should not sneak into the current phases.

---

# Non-negotiable implementation laws

1. Data is not Memory.
2. Canonical workspace Data is user-owned and survives uninstall.
3. Data never writes canonical sibling-layer state as an integration shortcut.
4. No normal agent API accepts raw SQL or canonical DB path.
5. Workspace isolation is enforced technically, not only by prompt.
6. `systemId` remains Dashboard-local and does not become Data canonical identity.
7. SQLite is an implementation driver, not the public Data contract.
8. Events are Data audit facts, not automatic Memory.
9. Registration is not permission, health, or workspace authorization.
10. Cross-repo changes are separate explicit tasks, never hidden side effects of Data implementation.

---

# Next task

**Task 1.1 - Repository/package foundation.**

Do not begin Task 1.2 until Task 1.1 is implemented, tested, committed, and reported complete.
