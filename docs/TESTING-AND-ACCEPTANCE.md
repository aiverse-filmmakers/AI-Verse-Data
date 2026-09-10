# AI-Verse Data Testing and Acceptance

**Status:** Canonical quality plan  
**Date:** 2026-09-10

## 1. Goal

AI-Verse Data will hold canonical structured records, so correctness matters more than feature count.

A release is not considered integrated merely because CRUD works.

It must prove:

- source-of-truth integrity;
- workspace isolation;
- concurrent-write safety;
- retry safety;
- install/update/uninstall safety;
- compatibility with optional AI-Verse layers;
- database migration safety;
- path/security hardening;
- cross-platform behavior.

## 2. Testing philosophy

Prefer deterministic tests around every state transition.

Important failure paths must be tested, not only happy paths.

Where an operation can partially fail, tests must prove whether the effect occurred and that retries cannot duplicate or corrupt the effect.

Every implementation phase has its own gate. Later phases inherit all earlier gates.

## 3. Test layers

### Unit tests

Cover:

- ID validation;
- schema validation;
- field coercion/rejection;
- query AST validation;
- query compilation;
- capability matching;
- request fingerprints;
- idempotency logic;
- optimistic-version checks;
- path normalization;
- event/receipt shapes;
- database metadata parsing;
- migration planning.

### Storage integration tests

Use real temporary SQLite databases to prove:

- schema initialization;
- transactions;
- rollback;
- WAL behavior where supported;
- foreign-key enforcement;
- unique constraints;
- event atomicity;
- idempotency persistence;
- record versioning;
- backup/restore;
- integrity checks;
- internal format migrations.

Mocks are not sufficient for core storage correctness.

### CLI/protocol tests

Prove:

- valid JSON request/response behavior;
- stable error codes;
- exit codes;
- bounded output;
- malformed input handling;
- status/doctor behavior;
- human-readable CLI and machine JSON mode where both exist.

### Native AI-Verse integration tests

Construct real temporary AI-Verse OS fixture layouts and prove:

- v2 detection;
- workspace resolution;
- registry merge safety;
- no tracked OS file changes;
- other extension preservation;
- incompatible-host fail-closed behavior;
- Data DB path containment;
- install-order independence.

### Adversarial tests

Explicitly attack:

- `../` traversal;
- absolute POSIX paths;
- Windows drive paths;
- UNC paths;
- NULs;
- symlink escape;
- workspace manifest ID mismatch;
- database metadata mismatch;
- malformed extension registry;
- registry concurrency;
- duplicate request IDs;
- idempotency reuse with altered payload;
- stale expected versions;
- oversized records/queries;
- deeply nested filters;
- unknown fields/operators;
- fake actor/capability fields.

### Cross-platform CI

Required before first release:

- Ubuntu;
- macOS;
- Windows.

Use supported Node versions for the release matrix.

## 4. Phase 0 documentation gate

Phase 0 is complete only when the repo itself contains:

- PRD;
- canonical architecture;
- Data/Memory boundary;
- ecosystem integration contract;
- install/lifecycle contract;
- protocol direction;
- security/authority model;
- testing/acceptance plan;
- research/decision log;
- canonical Build Map.

No implementation code is required for this gate.

## 5. Phase 1 Core Engine gate

The first engine phase must prove at minimum:

1. initialize a standalone temporary Data database;
2. initialize a native-ready workspace-scoped Data database through the trusted workspace scope abstraction;
3. create/list/get Data Spaces;
4. create/list/get entity schemas;
5. validate first-release field types;
6. create/get/list records;
7. update a record only when `expectedVersion` matches;
8. soft-delete with version check;
9. query with validated filters/sorts/pagination;
10. aggregate count/sum/min/max/avg where valid;
11. create validated references;
12. execute a bounded transaction atomically;
13. reopen database and recover exactly the committed state;
14. reject unsupported database format/version.

Phase 1 does **not** require native AI-Verse OS manifest detection/registration. That begins in Phase 3.

### Phase-boundary correction recorded during Task 9 / 41

The original Phase 1 checklist incorrectly included:

- appending mutation events in the same commit;
- returning stable mutation receipts.

Those requirements conflict with the canonical Build Map, which assigns events and receipts to **Task 12 / 41, Phase 2.3**. They are therefore part of the Phase 2 reliability gate, not the Phase 1 core-engine gate.

This correction does not remove those requirements from the product. It prevents Task 9 from silently implementing Phase 2 work early and keeps the canonical task ownership consistent.

### Phase 2.1 concurrency evidence

Task 10 / 41 adds real competing-writer proof, not only sequential stale-version assertions.

The suite includes:

- two independent storage connections reading the same version and attempting compare-and-swap writes;
- four separate Node processes released against one record with the same `expectedVersion`;
- competing bounded transactions updating one canonical record;
- a stale soft delete after another writer advances the record.

Required result:

```text
one stale-version winner
all other stale writers rejected
no lost update
no stale delete
final canonical version advances exactly once
```

Implementation run `34521416868` passed 110 / 110 tests on Node 22 and Node 24.

### Phase 2.2 idempotency evidence

Task 11 / 41 adds durable retry-safety proof for record and bounded-transaction mutations.

The suite verifies:

- canonical SHA-256 fingerprints are stable across object property order;
- operation, trusted actor, and semantic request are fingerprint-bound;
- create/update/delete matching retries return the original committed snapshot;
- replay is resolved before stale current-version checks;
- same key with a changed request returns `IDEMPOTENCY_CONFLICT`;
- failed mutations leave no key reservation;
- replay survives database close/reopen;
- bounded transaction replay returns identical generated record IDs;
- failed transactions roll back nested and outer idempotency entries;
- persisted replay result tampering fails closed by digest verification;
- four separate Node processes delivering the same key/request create one canonical record and receive one shared result;
- two processes racing with one key but different payloads produce one commit and one conflict.

Behavioral verification run `34523382398` passed 125 / 125 tests on Node 22 and Node 24.

## 6. Phase 2 Reliability and Agent Safety gate

Must prove:

- stale write conflict does not overwrite current record;
- retry with same idempotency key and same request returns one effect;
- same key with different request is rejected;
- process restart does not forget committed idempotency outcome;
- concurrent create/update attempts preserve invariants;
- transaction failure rolls back all required writes/events;
- every committed canonical mutation appends its required Data event atomically;
- every committed mutation returns a stable mutation receipt;
- soft-delete history remains inspectable;
- bulk operations enforce limits;
- record/query size ceilings are enforced;
- actor provenance is stored;
- event sequence/identity remains stable;
- database backup is consistent;
- exported data can be verified/reimported according to the supported format;
- corruption is reported instead of silently replaced;
- migration-required state blocks unsafe writes.

## 7. Phase 3 Native Installation gate

Must prove against real fixture repositories:

1. clean AI-Verse OS v2 is detected;
2. unsupported major schema fails;
3. wrong architecture fails;
4. missing required OS contract fails;
5. extension files stay inside `.aiverse/extensions/ai-verse-data/`;
6. registry entry is added without changing unrelated entries;
7. unknown top-level and per-entry fields survive;
8. existing `enabled: false` survives reinstall;
9. competing registry writer is detected rather than overwritten;
10. registry change during install does not cause lost update;
11. path/symlink escape is rejected;
12. install does not modify `AI-VERSE.yaml`, `AGENTS.md`, `CLAUDE.md`, `skills/registry.yaml`, Memory, Brain, or Multiple Bots state;
13. install does not create a database in every workspace;
14. explicit workspace init creates only that workspace's database;
15. reinstall discovers compatible existing Data;
16. update preserves canonical records;
17. disable preserves canonical records;
18. uninstall removes only Data-owned software/registration state and preserves canonical workspace databases;
19. reinstall after uninstall can reopen preserved compatible Data;
20. standalone fallback does not mask an incompatible AI-Verse OS.

## 8. Installation-order matrix

At least these orders must be exercised using realistic extension registries:

```text
OS -> Data
OS -> Memory -> Data
OS -> Data -> Memory
OS -> Brain -> Data
OS -> Data -> Brain
OS -> Multiple Bots -> Data
OS -> Data -> Multiple Bots
OS -> Skills -> Data
OS -> Data -> Skills
OS -> Memory -> Brain -> Multiple Bots -> Data
OS -> Data -> Memory -> Brain -> Multiple Bots
```

Where sibling installers are not directly callable inside this repo's CI, representative valid registry fixtures plus dedicated cross-repo acceptance later may cover the first local gate.

The eventual ecosystem release should add a real multi-repository integration suite.

## 9. Workspace isolation acceptance

This is non-negotiable.

Create two workspaces:

```text
workspace-a
workspace-b
```

Both may contain:

```text
space: crm
entity: deals
record id: deal_42
```

Tests must prove:

- reading A never returns B;
- writing A never changes B;
- identical logical IDs do not collide physically;
- relative path tricks cannot open B from A;
- symlink from A toward B is rejected;
- a database copied into the wrong workspace is rejected because embedded workspace identity mismatches;
- events/receipts remain scoped to the actual workspace;
- future Dashboard `systemId` is not required for isolation.

## 10. Data/Memory coexistence acceptance

Use realistic Memory fixtures and prove:

- Data install does not alter Memory canonical files;
- Memory install order does not alter Data records;
- Memory SQLite index path is never opened as Data;
- Data database is never treated as disposable Memory index;
- ordinary Data mutation does not create atomic Memory files;
- a future Data source reference can be stored as Memory provenance without copying the record into Memory;
- current Data state wins over older Memory for Data-owned current fields.

## 11. Multiple Bots acceptance

When the adapter phase begins, prove:

- Bot with read lease can read and cannot write;
- Bot with update lease can update only allowed space/entity;
- Worker cannot gain broader Data authority than its Task/leader grant;
- delegation to stronger Bot cannot launder privilege;
- mutation receipt can be linked to Task/Artifact provenance;
- expired/revoked lease prevents new Data write;
- version conflict is surfaced to Bot rather than auto-overwritten.

## 12. Brain acceptance

When Brain adapter work begins, prove:

- Brain can receive bounded structured state through host adapter;
- Data is not copied into Brain canonical state;
- Brain proposal cannot mutate Data without normal host/action authorization;
- Data mutation receipt can support objective evidence without automatically closing an objective;
- stale Memory cannot override current Data result in assembled context.

## 13. Dashboard acceptance

When Dashboard integration begins, prove:

- browser never receives canonical database path as authority;
- Dashboard Gateway reads through Data client/adapter;
- system A and system B Data remain isolated by Dashboard's trusted root mapping;
- Dashboard cache deletion does not affect Data;
- UI mutation reconciles only after Data commit receipt/event;
- a stale UI record update returns conflict rather than last-write-wins.

## 14. Apps acceptance

When Apps integration begins, prove:

- App receives only declared/granted Data capabilities;
- App cannot open SQLite directly using a host path;
- App uninstall preserves Data by default;
- App update cannot gain broader Data permissions silently;
- two Apps can safely use the same canonical entity where policy permits;
- schema-owner metadata does not make App runtime the record owner.

## 15. Connections acceptance

When external sync/import exists, prove before shipping:

- source authority is explicit;
- external IDs/provenance are preserved;
- offline external source does not cause local replica to silently become canonical;
- conflicting writes follow a documented policy;
- replayed webhook/import does not duplicate records;
- connection credential values never enter Data events/records unless explicitly modeled by a secure separate system.

## 16. Migration acceptance

Every internal database-format migration must test:

- clean upgrade from previous supported version;
- interrupted migration/recovery semantics;
- unsupported newer version;
- rollback strategy where applicable;
- data count/content preservation;
- event/idempotency preservation;
- workspace metadata preservation;
- integrity check after migration;
- no destructive downgrade guess.

Every user-schema migration feature must test:

- additive field change;
- required field with valid backfill;
- invalid narrowing;
- relation changes;
- enum changes;
- records that cannot satisfy proposed schema;
- dry-run/preview output;
- no partial destructive change.

## 17. Performance budgets

Do not optimize prematurely, but establish regression budgets once Phase 1 exists.

Measure at least:

- cold open;
- create/update latency;
- list/query latency for representative datasets;
- aggregate latency;
- transaction latency;
- event growth;
- startup migration check;
- doctor quick check;
- memory usage under bounded result sizes.

Tests should include datasets large enough to expose obviously poor query design, but performance targets should be based on measured product requirements rather than invented numbers.

## 18. Release acceptance suite

The first complete release is not ready until one automated suite proves this story:

```text
fresh AI-Verse OS
  -> install Data
  -> initialize workspace A
  -> create CRM Data Space and schemas
  -> create related records
  -> query and aggregate them
  -> update safely with versions/idempotency
  -> simulate concurrent conflict
  -> backup
  -> restart/reopen
  -> verify exact state/events/receipts
  -> create workspace B
  -> prove isolation
  -> install representative sibling extension state
  -> reinstall/update Data without damage
  -> uninstall Data software
  -> prove canonical DB remains
  -> reinstall Data
  -> reopen/verify preserved records
```

## 19. Definition of "ready to work"

For AI-Verse Data, "ready" means more than package installation.

A production claim requires:

- package installed;
- extension registered/enabled where native;
- engine healthy;
- workspace Data initialized when requested;
- database format supported;
- integrity healthy;
- caller has appropriate scope/permission;
- operation passes schema/version/idempotency rules.

Any missing prerequisite should be visible rather than assumed.
