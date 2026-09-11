# AI-Verse Data Build Map

**Updated:** 2026-09-11  
**Status:** Phase 3 in progress  
**Implementation progress:** 21 / 41 tasks complete  
**Next:** Task 22 / 41, Phase 3.4 - Extension instructions/runtime discovery

This is the canonical implementation ledger for AI-Verse Data. Update it whenever a meaningful implementation task lands so the repository itself always shows what is complete, what is next, and which gate proves completion.

## Definition of first complete release

The first complete release is reached when Phases 0 through 5 are complete and the full release acceptance suite passes.

The target is an installable local-first structured-data layer that can run standalone or attach safely to AI-Verse OS, store canonical workspace-scoped structured records, serve humans/agents/Apps through safe typed operations, preserve one source of truth, and integrate with the wider AI-Verse ecosystem without duplicating Memory, Brain, Bots, Connections, Apps, or Dashboard state.

## Current position

```text
Phase 0  Product + Architecture        [COMPLETE]      100%
Phase 1  Core Data Engine              [COMPLETE]      100%  (9/9)
Phase 2  Reliability + Agent Safety    [COMPLETE]      100%  (9/9)
Phase 3  Native AI-Verse Integration   [IN PROGRESS]    38%  (3/8)
Phase 4  Ecosystem Adapters            [NOT STARTED]     0%
Phase 5  Release Hardening             [NOT STARTED]     0%
```

Overall implementation: **21 / 41 tasks complete**.

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

**Status:** COMPLETE  
**Progress:** 9 / 9 tasks complete

Goal: produce a runnable host-neutral Data engine with one SQLite driver and the safe structured primitives required for useful local operation.

## Task 1 / 41 - Phase 1.1 Repository/package foundation

**Status:** COMPLETE

Implemented Node 22+ package metadata, strict TypeScript, ESM package/export boundaries, CLI shell, source/test layout, build/test/check scripts, `.gitignore`, and Node 22/24 GitHub CI.

Verification:

```text
5 / 5 tests passed
Node 22 PASS
Node 24 PASS
```

**Task 1.1 gate: PASSED.**

## Task 2 / 41 - Phase 1.2 Protocol types and validators

**Status:** COMPLETE

Implemented the storage-neutral `ai-verse-data/0.1` protocol, operation registry, discriminated request/response envelopes, machine-readable errors, actor/scope/authorization types, Data Space/schema/record/query/aggregate/transaction types, first-release field types, strict runtime validators, safe identifiers, and hard request/query/schema/transaction ceilings.

Security proof includes explicit rejection of raw SQL/database-path extras in normal protocol operations.

Verification:

```text
18 / 18 tests passed
Node 22 PASS
Node 24 PASS
```

**Task 1.2 gate: PASSED.**

## Task 3 / 41 - Phase 1.3 Storage-driver contract + SQLite bootstrap

**Status:** COMPLETE

Implemented:

- storage-driver interface;
- public `@ai-verse/data/storage` surface;
- `better-sqlite3` 13.0.3 SQLite driver;
- create-or-open and open-existing modes;
- database close behavior;
- `_aiverse_meta` format metadata;
- database format string/version;
- SQLite `application_id` and `user_version` identity;
- SQLite runtime-version check with minimum 3.37.0;
- `STRICT` + `WITHOUT ROWID` internal metadata table;
- foreign-key enforcement;
- local WAL mode;
- `synchronous=NORMAL`;
- 5-second busy timeout;
- integrity checking;
- storage diagnostics;
- fail-closed rejection of unrelated SQLite files;
- fail-closed rejection of unsupported/newer AI-Verse Data formats;
- explicit closed-handle safety.

Database format v1:

```text
format:          ai-verse-data/sqlite
format version:  1
application_id:  0x41495644 (AIVD)
user_version:    1
```

Verification:

```text
GitHub Actions run: 34509888259
Node 22:             PASS
Node 24:             PASS
Tests:               25 / 25 PASS
Failures:            0
```

Detailed evidence: `docs/PHASE-1-STATUS.md`. Storage contract: `docs/STORAGE-V0.1.md`.

No Data Space/schema/record CRUD or workspace binding was introduced early.

**Task 1.3 gate: PASSED.**

## Task 4 / 41 - Phase 1.4 Scope and database identity

**Status:** COMPLETE

Implemented:

- public `@ai-verse/data/scope` surface;
- `TrustedDataRoot` canonical-root capability;
- host-neutral standalone scope;
- native-ready workspace scope;
- safe derived database-path helpers;
- cross-platform-safe filesystem workspace IDs;
- existing child-symlink rejection;
- persistent database scope binding v1;
- one-time binding of older unbound AI-Verse Data databases;
- fail-closed `DATABASE_SCOPE_CONFLICT` on workspace/kind mismatch;
- fail-closed partial-binding corruption detection;
- physical separation for matching workspace IDs under different trusted roots;
- no Dashboard `systemId` or absolute root path in canonical binding.

Verification:

```text
GitHub Actions run: 34511358818
Node 22:             PASS
Node 24:             PASS
Tests:               37 / 37 PASS
Failures:            0
```

Detailed contract: `docs/SCOPE-AND-IDENTITY-V0.1.md`.

No Data Space/schema/record semantics were introduced.

**Task 1.4 gate: PASSED.**

## Task 5 / 41 - Phase 1.5 Data Spaces and entity schemas

**Status:** COMPLETE

Implemented:

- public `@ai-verse/data/catalog` surface;
- storage-neutral `DataCatalogStorage` contract;
- SQLite `_data_spaces`, `_entities`, and `_entity_schema_versions` STRICT tables;
- Data Space create/list/get with duplicate protection;
- entity schema create/list/get;
- immutable historical schema versions;
- deterministic SHA-256 schema digests over canonical JSON;
- digest verification when stored schemas are read;
- type-aware field default validation;
- safe additive schema updates;
- optimistic `expectedSchemaVersion` checks;
- explicit historical-version lookup errors;
- `SCHEMA_MIGRATION_REQUIRED` for unsupported destructive changes;
- atomic schema creation/update transactions;
- no arbitrary SQL table generation from entity definitions.

Verification:

```text
GitHub Actions run: 34513039706
Node 22:             PASS
Node 24:             PASS
Tests:               53 / 53 PASS
Failures:            0
```

Detailed contract: `docs/CATALOG-AND-SCHEMAS-V0.1.md`.

No record storage/CRUD was introduced.

**Task 1.5 gate: PASSED.**

## Task 6 / 41 - Phase 1.6 Record CRUD

**Status:** COMPLETE

Implemented:

- public `@ai-verse/data/records` surface;
- storage-neutral `DataRecordStorage` contract;
- SQLite `_records` STRICT, WITHOUT ROWID table;
- fixed engine-owned storage rather than generated per-entity SQL tables;
- create/get/list/update/soft-delete operations;
- stable engine-generated `rec_...` record IDs;
- exact persisted `schemaVersion` provenance;
- monotonically increasing record versions;
- schema-aware field validation for all first-release field types;
- required/nullability/string/range/date/datetime/enum validation;
- unknown-field rejection unless explicitly allowed by schema;
- deep-cloned schema defaults on create and compatible schema evolution;
- stable creation/update timestamps;
- `createdBy`, `updatedBy`, and `deletedBy` actor attribution;
- bounded basic record listing;
- normal deleted-record hiding with explicit `includeDeleted` access;
- basic `expectedVersion` rejection for update/delete;
- fail-closed stored-record validation against historical schema;
- reopen persistence for CRUD state and provenance.

Verification:

```text
GitHub Actions run: 34514486550
Node 22:             PASS
Node 24:             PASS
Tests:               71 / 71 PASS
Failures:            0
```

Detailed contract: `docs/RECORD-CRUD-V0.1.md`.

At the Phase 1.6 boundary, Tasks 10, 11, and 12 were still responsible for race-safe concurrency, persistent idempotency, and events/receipts. Those responsibilities have since been completed in Phase 2.1 through 2.3.

No general query/aggregate engine, relation enforcement, or multi-record transaction execution was introduced.

**Task 1.6 gate: PASSED.**

## Task 7 / 41 - Phase 1.7 Safe query + aggregate engine

**Status:** COMPLETE

Implemented:

- public `@ai-verse/data/query` surface;
- storage-neutral `DataQueryStorage` plan contract;
- parameterized SQLite query compiler;
- bounded structured filter AST execution;
- `and`, `or`, and `not` groups;
- `eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `in`, `not_in`, `contains`, `starts_with`, `is_null`, and `is_not_null`;
- schema-aware field/operator/value compatibility checks;
- declared-field-only filtering/sorting/aggregates;
- bounded multi-key sorting with stable record-ID tie break;
- field selection/projection after canonical hydration;
- opaque cursor pagination with query fingerprints;
- maximum cursor offset ceiling;
- deleted-row visibility controls;
- count/sum/min/max/avg aggregates;
- aggregate type and alias validation;
- wildcard escaping for LIKE-backed string operations;
- SQL-looking values retained as bound parameters;
- shared historical-schema record hydration for query results.

Verification:

```text
GitHub Actions run: 34516259373
Node 22:             PASS
Node 24:             PASS
Tests:               90 / 90 PASS
Failures:            0
```

Detailed contract: `docs/QUERY-AND-AGGREGATES-V0.1.md`.

No relation traversal, relation validation, or multi-record transaction execution was introduced.

**Task 1.7 gate: PASSED.**

## Task 8 / 41 - Phase 1.8 Relations + bounded transactions

**Status:** COMPLETE

Implemented:

- storage-neutral `DataRelationStorage` contract;
- SQLite `_record_relations` STRICT normalized relation index;
- declared-reference target existence and active-state validation;
- same-space and declared cross-space references within one workspace database;
- atomic record and relation-index create/update/delete behavior;
- inbound-reference protection against dangling soft deletes;
- public `@ai-verse/data/transactions` surface;
- bounded create/update/delete transaction sequences;
- maximum 50 operations per transaction;
- whole-transaction rollback on any nested failure;
- safe `clientRef` aliases for records created earlier in the same transaction;
- rejection of forward and duplicate transaction aliases;
- normal schema/reference/version rules reused inside transactions.

Verification:

```text
GitHub Actions run: 34517605246
Node 22:             PASS
Node 24:             PASS
Tests:               102 / 102 PASS
Failures:            0
```

Detailed contract: `docs/RELATIONS-AND-TRANSACTIONS-V0.1.md`.

At the Phase 1.8 boundary, persistent idempotency, race-safe optimistic concurrency, events, and receipts were deferred to Phase 2. Tasks 10, 11, and 12 have since completed concurrency, idempotency, and provenance. No Phase 1.9 integration-gate work was introduced early.

**Task 1.8 gate: PASSED.**

## Task 9 / 41 - Phase 1.9 Phase 1 integration gate

**Status:** COMPLETE

The final Phase 1 acceptance audit added an integrated end-to-end suite proving the core engine operates correctly as one system.

Acceptance coverage:

- standalone scoped database initialization;
- native-ready workspace-scoped database initialization;
- Data Space create/list/get;
- entity schema create/list/get;
- first-release field validation;
- record create/get/list/update/soft-delete;
- matching/stale `expectedVersion` behavior;
- validated query/filter/sort/pagination;
- count/sum/min/max/avg aggregates;
- declared references;
- bounded atomic transactions;
- exact committed-state recovery after close/reopen;
- two-workspace physical/logical isolation;
- unsupported newer database format rejection.

During the gate, `docs/TESTING-AND-ACCEPTANCE.md` was corrected because its original Phase 1 checklist incorrectly included mutation events and durable receipts. Those requirements were intentionally deferred to Task 12 / Phase 2.3 and have since been implemented and verified.

Verification:

```text
GitHub Actions run: 34520521012
Node 22:             PASS
Node 24:             PASS
Tests:               106 / 106 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

Detailed acceptance evidence: `docs/PHASE-1-ACCEPTANCE.md`.

**Task 1.9 gate: PASSED.**  
**Phase 1 Core Data Engine gate: PASSED.**

---

# Phase 2 - Reliability + Agent Safety

**Status:** COMPLETE  
**Progress:** 9 / 9 tasks complete

## Task 10 / 41 - Phase 2.1 Optimistic concurrency

**Status:** COMPLETE

Implemented:

- atomic `expectedVersion` comparison at the canonical record write;
- `DataRecordStorage.updateRecord(record, expectedVersion)`;
- `DataRecordStorage.softDeleteRecord(record, expectedVersion)`;
- SQLite `record_version = expectedVersion` write predicates;
- short immediate write transactions for record create/update/delete;
- immediate outer write intent for bounded multi-record transactions;
- stable `RECORD_VERSION_CONFLICT` behavior with current-version details;
- no automatic stale-patch merge/rebase;
- storage-level compare-and-swap tests across independent connections;
- real separate-process update races;
- competing bounded-transaction races;
- stale soft-delete rejection after an intervening write.

Verification:

```text
GitHub Actions run: 34521416868
Node 22:             PASS
Node 24:             PASS
Tests:               110 / 110 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

Detailed contract: `docs/OPTIMISTIC-CONCURRENCY-V0.1.md`.  
Phase status: `docs/PHASE-2-STATUS.md`.

At the Task 10 boundary, no persistent idempotency/request-fingerprint/replay behavior had been introduced. Task 11 has since implemented that layer.

**Task 2.1 gate: PASSED.**

## Task 11 / 41 - Phase 2.2 Idempotent mutations

**Status:** COMPLETE

Implemented:

- public `@ai-verse/data/idempotency` surface;
- workspace-database-global durable idempotency keys;
- fixed SQLite `_idempotency` STRICT table;
- fingerprint version 1;
- deterministic canonical JSON request serialization;
- SHA-256 request fingerprints;
- operation + trusted actor + semantic-request binding;
- direct record create/update/delete idempotency enforcement;
- exact original-result replay before current-state checks;
- same-key/different-request `IDEMPOTENCY_CONFLICT`;
- SHA-256 replay-result integrity verification;
- no key reservation after failed mutation;
- replay persistence across close/reopen;
- outer + nested bounded-transaction idempotency;
- transaction rollback of all idempotency entries on failure;
- no automatic v0.1 idempotency expiry;
- separate-process same-key/same-request duplicate-delivery proof;
- separate-process same-key/different-request conflict proof.

Verification:

```text
GitHub Actions run: 34523382398
Node 22:             PASS
Node 24:             PASS
Tests:               125 / 125 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

Detailed contract: `docs/IDEMPOTENCY-V0.1.md`.  
Phase status: `docs/PHASE-2-STATUS.md`.

No mutation events, durable receipts, event IDs, or provenance query system were introduced.

**Task 2.2 gate: PASSED.**

## Task 12 / 41 - Phase 2.3 Events, receipts, provenance

**Status:** COMPLETE

Implemented:

- public `@ai-verse/data/provenance` reader surface;
- internal-only governed provenance writer;
- fixed SQLite `_events` append-oriented table;
- fixed SQLite `_mutation_receipts` table;
- immutable UPDATE/DELETE rejection triggers for both provenance tables;
- engine-generated `evt_`, `rcpt_`, `req_`, and `txn_` identifiers;
- record create/update/delete event + receipt generation;
- trusted actor attribution;
- trusted database scope/workspace attribution;
- before/after record-version provenance;
- bounded structured event details without full record-payload duplication;
- SHA-256 event digests;
- SHA-256 receipt digests;
- receipt-to-linked-event consistency verification;
- `createWithReceipt`, `updateWithReceipt`, and `softDeleteWithReceipt`;
- `executeWithReceipt` for bounded transactions;
- child record provenance plus one final `transaction.committed` event/receipt;
- transaction child event/receipt linking;
- transaction-wide rollback of record, relation, event, receipt, and idempotency state;
- idempotent replay with no duplicate events or receipts;
- original receipt/request identity retained on replay;
- fresh-transaction rejection of already-committed nested idempotency provenance;
- duplicate nested-key and outer-key reuse rejection;
- workspace-wide or progressively scoped event queries;
- opaque query-bound `evc_` event cursors;
- stable `RECEIPT_NOT_FOUND` error;
- fail-closed digest/linkage corruption behavior.

Behavioral verification:

```text
GitHub Actions run: 34526163488
Commit:              911c5d51d605bd6234f35dc351eef76c68ac61e6
Node 22:             PASS
Node 24:             PASS
Tests:               141 / 141 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

Detailed contract: `docs/EVENTS-RECEIPTS-PROVENANCE-V0.1.md`.  
Continuation state: `docs/CONTINUATION-HANDOFF.md`.

No Task 13 bulk-operation, preview, or dry-run behavior was introduced.

**Task 2.3 gate: PASSED.**

## Task 13 / 41 - Phase 2.4 Bulk-operation safety and limits

**Status:** COMPLETE

Implemented:

- public `@ai-verse/data/bulk` package surface;
- `data.bulk.preview` and `data.bulk.execute` protocol operations;
- shared protocol validation using the existing record-mutation shapes;
- hard maximum 50 operations per bulk request;
- hard maximum 256 KiB bulk payload;
- exact rollback-only preview through the real bounded transaction engine;
- preview reuse of schema, relation, expectedVersion, idempotency, event, and receipt semantics;
- no committed preview records;
- no committed preview relation rows;
- no committed preview idempotency entries;
- no committed preview events or receipts;
- no durable event-sequence advancement during preview;
- no exposure of temporary preview-generated create IDs;
- deterministic SHA-256 preview digest;
- preview digest bound to trusted actor, exact ordered operations, deterministic state summary, and atomicity policy;
- mandatory `expectedPreviewDigest` before commit;
- commit-time re-preview/current-state validation;
- explicit `BULK_PREVIEW_STALE` rejection;
- all-or-nothing commit only;
- no best-effort/continue-on-error mode;
- durable outer bulk idempotency;
- deterministic internal transaction idempotency key;
- nested/outer/internal idempotency-key separation;
- bulk replay verified against underlying transaction idempotency result;
- bulk replay transaction receipt verified against durable provenance;
- normal nested record + final transaction provenance reused instead of duplicate synthetic bulk events;
- safe existing transaction `clientRef` behavior preserved in preview and commit;
- stable bulk-specific error codes;
- no new canonical storage table.

Behavioral verification:

```text
GitHub Actions run: 34535289214
Commit:              48cc437647fdf76e21b51b310eb6567f4a843d1f
Node 22:             PASS
Node 24:             PASS
Tests:               153 / 153 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

Detailed contract: `docs/BULK-OPERATIONS-V0.1.md`.  
Continuation state: `docs/CONTINUATION-HANDOFF.md`.

No Task 14 backup/export/import behavior was introduced.

**Task 2.4 gate: PASSED.**

## Task 14 / 41 - Phase 2.5 Backup/export/import foundation

**Status:** COMPLETE

Implemented:

- public `@ai-verse/data/backup` package surface;
- consistent SQLite online backup;
- atomically reserved no-overwrite backup destinations;
- separate physical backup and portable logical export artifacts;
- manifest format/version, artifact identity, source identity, payload metadata, and state summary;
- SHA-256 payload, manifest, event, receipt, idempotency-result, and logical-state verification;
- durable artifact receipt metadata;
- backup verification on an isolated temporary copy;
- portable export from a consistent SQLite snapshot rather than a live multi-query walk;
- preservation of Data Spaces and complete immutable schema history;
- preservation of active records and soft-delete tombstones;
- preservation and validation of normalized relation indexes;
- preservation of durable idempotency state and exact replay results;
- preservation of immutable events, mutation receipts, and event sequence;
- valid historical pre-binding provenance preserved after later trusted binding;
- semantic portable-import verification before acceptance;
- trusted binding conflict rejection;
- existing canonical destination rejection;
- staging plus SQLite sealing before canonical installation;
- post-install canonical state verification;
- no Task 15 migration behavior.

Behavioral verification:

```text
GitHub Actions run: 34588281966
Commit:              ce03b101c3560825b0e994ca4b30a269c4e3c4a3
Node 22:             PASS
Node 24:             PASS
Tests:               162 / 162 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

Detailed contract: `docs/BACKUP-EXPORT-IMPORT-V0.1.md`.  
Phase status: `docs/PHASE-2-STATUS.md`.

**Task 2.5 gate: PASSED.**

## Task 15 / 41 - Phase 2.6 Internal migration framework

**Status:** COMPLETE

Implemented:

- canonical SQLite database format version 2;
- migration framework version 1;
- engine-owned `_schema_migrations` STRICT ledger;
- stable migration ID `sqlite-0001-v1-to-v2`;
- deterministic migration-definition SHA-256;
- explicit storage-driver `inspectMigration`, `migrate`, and `verifyMigrationBackup`;
- normal database open never auto-migrates;
- format v1 reported as `DATABASE_MIGRATION_REQUIRED`;
- interrupted/failed migration state reported as `DATABASE_MIGRATION_INCOMPLETE`;
- unsupported newer formats remain `DATABASE_VERSION_UNSUPPORTED`;
- consistent online SQLite pre-migration backup before canonical migration state changes;
- versioned migration-backup manifest + receipt with SHA-256 payload/manifest binding;
- read-only backup identity + SQLite integrity verification;
- no-overwrite migration-backup destination;
- transactional v1 to v2 migration execution;
- atomic format metadata + `user_version` + ledger completion;
- durable `in_progress`, `failed`, and `completed` lifecycle states;
- explicit retry/resume with incremented attempt number;
- impossible current-format incomplete state fails closed;
- post-migration integrity failure leaves fail-closed ledger state when possible;
- trusted workspace binding preserved exactly;
- canonical records, idempotent replay, and provenance preserved;
- no Task 16 user-schema migration/backfill behavior.

Behavioral verification:

```text
GitHub Actions run: 34590556661
Behavioral commit:   55c197b5c9c53eba6f09261555e9bf6e4807386e
Node 22:             PASS
Node 24:             PASS
Tests:               173 / 173 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

Detailed contract: `docs/INTERNAL-MIGRATIONS-V0.1.md`.  
Phase status: `docs/PHASE-2-STATUS.md`.

**Task 2.6 gate: PASSED.**

## Task 16 / 41 - Phase 2.7 User-schema migration framework

**Status:** COMPLETE

Implemented:

- public `@ai-verse/data/schema-migrations` surface;
- protocol operations `data.schema.migration.preview` and `data.schema.migration.execute`;
- strict migration payload/backfill/approval validation;
- consistent read-transaction preview;
- deterministic SHA-256 preview digest bound to actor, owner, schema changes, schema digests, record versions/data, and relation outcomes;
- exact preview-digest revalidation inside the execute transaction;
- required-field backfills through deterministic constant values;
- `set_if_missing` and destructive `set` backfill modes;
- governed remove/replace/rename field migrations;
- explicit destructive approval metadata;
- immutable next entity-schema version;
- maximum 500 active records per atomic migration;
- maximum 8 MiB scanned source state and 8 MiB rewritten state;
- every active record validated against its historical schema before transformation;
- transformed records validated against the proposed schema;
- active record schema version + record version advance exactly once;
- soft-deleted records remain historical on their prior schema version;
- normalized reference indexes rebuilt from transformed canonical data;
- stale schema or active-record state rejects reviewed execution;
- outer and child durable idempotency state;
- matching execute retry returns one committed migration result/receipt;
- per-record immutable `record.updated` provenance for migrated records;
- one immutable transaction-level migration receipt/event with migration ID, owner, executor, schema versions/digests, preview digest, and approval metadata;
- forced mid-commit provenance failure proves complete schema/record/relation/idempotency/audit rollback;
- no arbitrary SQL, code expressions, cross-workspace migration, or Task 17 recovery behavior.

Behavioral verification:

```text
GitHub Actions run: 34593805448
Behavioral commit:   52ca515e3ad18ecdb9dd6907b7362aa00c3530e1
Node 22:             PASS
Node 24:             PASS
Tests:               185 / 185 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

Detailed contract: `docs/USER-SCHEMA-MIGRATIONS-V0.1.md`.  
Phase status: `docs/PHASE-2-STATUS.md`.

**Task 2.7 gate: PASSED.**

## Task 17 / 41 - Phase 2.8 Corruption/recovery behavior

**Status:** COMPLETE

Implemented:

- public `@ai-verse/data/recovery` surface;
- durable engine-owned quarantine marker beside the canonical database;
- physical SQLite corruption and semantic AI-Verse Data corruption distinction;
- malformed/unsafe quarantine evidence fails closed;
- normal open rejects quarantined databases;
- already-open catalog/record/relation/idempotency/provenance/transaction writes recheck quarantine;
- internal migration execution cannot bypass quarantine while read-only migration inspection remains available;
- existing zero-byte/uninitialized files are never silently bootstrapped as fresh canonical Data;
- existing databases pass physical integrity verification before first binding/WAL writes;
- unrelated valid SQLite remains `unrecognized`, not corruption;
- migration-required/incomplete states remain distinct from corruption;
- read-only original-source diagnosis with SQLite integrity + foreign-key checks;
- deep semantic verification on a consistent temporary SQLite online-backup snapshot;
- semantic verification checks schema history/digests, records, relations, idempotency, provenance, binding, and committed references;
- lost canonical record storage is detected from surviving event/idempotency evidence;
- confirmed corruption persists quarantine and blocks unsafe writes;
- verified same-binding recovery staging from Phase 2.5 SQLite backup artifacts;
- verified same-binding recovery staging from Phase 2.5 portable exports;
- recovery destination must be a distinct empty physical path;
- staged candidate must re-verify healthy;
- original corrupt canonical database and quarantine evidence remain untouched;
- no automatic repair, overwrite, promotion, quarantine clearing, or cross-workspace remapping;
- no Task 18 Phase 2 gate behavior implemented early.

Behavioral verification:

```text
GitHub Actions run: 34598198275
Behavioral commit:   1ff0e683603ae4a6da9967a0f2bbc199b526c119
Node 22:             PASS
Node 24:             PASS
Tests:               199 / 199 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

Detailed contract: `docs/CORRUPTION-AND-RECOVERY-V0.1.md`.  
Phase status: `docs/PHASE-2-STATUS.md`.

**Task 2.8 gate: PASSED.**

## Task 18 / 41 - Phase 2.9 Phase 2 gate

**Status:** COMPLETE

Implemented:

- dedicated `test/phase2-integration.test.ts` cross-feature gate;
- integrated lifecycle covering replay, OCC, bulk, user-schema migration, backup/export, reopen, and health;
- corruption -> quarantine -> verified same-binding staged recovery lifecycle;
- recovered state preserves idempotent record replay and user-schema migration replay without duplicate provenance;
- adversarial failure-class matrix keeps OCC/idempotency/bulk/schema-migration failures distinct;
- internal format migration preserves idempotency/provenance and allows post-migration writes;
- reporting keeps unrecognized, migration-required, and quarantined corruption states distinct;
- all dedicated Phase 2 adversarial suites remain part of the authoritative gate;
- final Phase 2 acceptance matrix recorded in `docs/PHASE-2-ACCEPTANCE.md`;
- complete repository suite passes Node 22 and Node 24.

Behavioral verification:

```text
GitHub Actions run: 34600296642
Behavioral commit:   d173e822d5a851051bdd1c3c9c9b4642ec1d58bc
Node 22:             PASS
Node 24:             PASS
Tests:               204 / 204 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

Detailed acceptance record: `docs/PHASE-2-ACCEPTANCE.md`.  
Phase status: `docs/PHASE-2-STATUS.md`.

**Task 2.9 gate: PASSED.**  
**Phase 2 gate: PASSED.**

---

# Phase 3 - Native AI-Verse Integration

**Status:** IN PROGRESS  
**Progress:** 3 / 8 tasks complete

## Task 19 / 41 - Phase 3.1 AI-Verse OS compatibility detector

**Status:** COMPLETE

Implemented:

- public `@ai-verse/data/native` surface;
- explicit `compatible`, `no-os`, and `incompatible` compatibility results;
- AI-Verse OS schema major 2 verification;
- exact `unified-workspace` architecture verification;
- safe `AI-VERSE.yaml`, `AGENTS.md`, `operator/`, and `workspaces/` contract checks;
- `system/extensions/README.md` extension-contract verification;
- required reference to `.aiverse/extensions/registry.json`;
- existing registry path safety without parsing or modifying registry contents;
- existing `TrustedDataRoot` path-containment and symlink rules reused;
- root/manifest/AGENTS/extension-contract/registry symlink rejection;
- bounded manifest/contract file reads;
- unknown additive manifest metadata tolerated;
- strong partial-host evidence prevents unsafe standalone fallback;
- ordinary projects without sufficient AI-Verse evidence remain `no-os`;
- complete fixture-tree read-only preservation proof;
- no extension registration/materialization or workspace initialization introduced early.

Behavioral verification:

```text
GitHub Actions run: 34602056368
Behavioral commit:   6b1f6757bd24492376754bdb0508b35233883193
Node 22:             PASS
Node 24:             PASS
Tests:               216 / 216 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

Detailed contract: `docs/AI-VERSE-OS-COMPATIBILITY-V0.1.md`.  
Phase status: `docs/PHASE-3-STATUS.md`.

**Task 3.1 gate: PASSED.**

## Task 20 / 41 - Phase 3.2 Hardened extension materialization/registration

**Status:** COMPLETE

Implemented:

- public `AiVerseDataExtensionInstaller` under `@ai-verse/data/native`;
- read-only installation planning;
- exact AI-Verse OS local registry schema `1.0` validation;
- Data-owned materialization under `.aiverse/extensions/ai-verse-data/`;
- deterministic `INSTRUCTIONS.md`, `engine.mjs`, and `extension.json`;
- registration owns only `extensions["ai-verse-data"]`;
- package/extension version alignment;
- unknown top-level registry fields preserved;
- unrelated extension entries preserved;
- unknown existing Data-entry fields preserved;
- existing `enabled: false` preserved;
- unknown files in the Data extension directory preserved;
- exclusive `registry.json.lock` without stale-lock stealing;
- Task 19 compatibility recheck inside the lock;
- latest registry re-read inside the lock;
- exact raw-registry lost-update precondition;
- same-directory temporary file + rename registry replacement;
- atomic Data-owned file materialization and verification;
- pre-registry-commit owned-file rollback on failure;
- traversal/absolute/drive/UNC/NUL path rejection;
- symlinked extension roots/files rejected;
- byte-stable persistent reinstall when current;
- malformed/unsupported registry state fails closed;
- no tracked OS file mutation;
- no workspace Data initialization.

Behavioral verification:

```text
GitHub Actions run: 34606467549
Behavioral commit:   1e88ba758dcc1151b4de6f60e8c3b2a9822afad7
Node 22:             PASS
Node 24:             PASS
Tests:               229 / 229 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

Detailed contract: `docs/EXTENSION-MATERIALIZATION-REGISTRATION-V0.1.md`.  
Phase status: `docs/PHASE-3-STATUS.md`.

**Task 3.2 gate: PASSED.**

## Task 21 / 41 - Phase 3.3 Native workspace resolver + Data initialization

**Status:** COMPLETE

Implemented:

- ID-only `resolveWorkspace` plus `AiVerseWorkspaceResolver` under `@ai-verse/data/native`;
- active-only `initWorkspaceData` plus `AiVerseWorkspaceDataInitializer`;
- seven-state `discoverWorkspaceData` plus `AiVerseWorkspaceDiscovery`;
- Task 19-compatible trusted OS root prerequisite with no standalone fallback;
- host-contract workspace ID validation before filesystem inspection;
- requested-workspace-only inspection with no cross-workspace enumeration;
- real non-symlink workspace directory validation;
- regular non-symlink bounded `WORKSPACE.yaml` validation;
- exact manifest `id` match against requested ID and directory identity;
- supported schema major 2 with additive manifest fields tolerated;
- non-empty `name`/`type` plus string `purpose` validation;
- resolution reports `active`, `paused`, and `archived`;
- fresh init requires `active` and creates no paused/archived database;
- internally derived `workspaces/<id>/data/ai-verse-data.sqlite` path;
- `data/` parent and database symlink rejection;
- single-workspace explicit init with no every-workspace side effect;
- exact workspace binding reuse on fresh databases;
- idempotent `unchanged` repeat init;
- discovery states `missing`, `compatible`, `migration_required`, `quarantined`, `scope_conflict`, `unsupported`, and `unavailable`;
- no silent replace, migrate, repair, rebind, or quarantine clearing;
- no Task 22 runtime discovery or Task 23 CLI lifecycle;
- no sibling repository modifications.

Detailed contract: `docs/WORKSPACE-RESOLVER-INITIALIZATION-V0.1.md`.  
Phase status: `docs/PHASE-3-STATUS.md`.

**Task 3.3 gate: PASSED.**

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

**Task 19 / 41: Phase 3.1 - AI-Verse OS compatibility detector.**

Do not begin Task 20 / 41 until Task 19 is implemented, verified, committed, logged in the continuation handoff, and reported complete.
