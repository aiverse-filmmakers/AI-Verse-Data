# AI-Verse Data Phase 2 Status

**Phase:** 2 - Reliability + Agent Safety  
**Phase status:** IN PROGRESS  
**Implementation tasks completed:** 7 / 9  
**Overall implementation tasks completed:** 16 / 41  
**Next:** Task 17 / 41, Phase 2.8 - Corruption/recovery behavior

This document records implementation evidence for Phase 2. `docs/BUILD-MAP.md` remains the canonical project-wide task order.

## Task 10 / 41 - Phase 2.1 Optimistic concurrency

**Status:** COMPLETE

### Implemented

Race-safe optimistic concurrency now exists at the canonical record write boundary.

Storage contract:

```text
updateRecord(record, expectedVersion)
softDeleteRecord(record, expectedVersion)
```

SQLite update and soft-delete statements require the old `record_version` directly in their `WHERE` predicates.

Record create/update/delete mutation paths use short immediate write transactions. The outer bounded multi-record transaction also uses immediate write intent, while every nested update/delete still requires its own expected version.

### Conflict semantics

A stale update/delete returns:

```text
RECORD_VERSION_CONFLICT
```

with the caller's expected version and the current canonical version when available.

The engine does not silently merge or auto-rebase stale changes.

### Real competing-writer proof

Task 2.1 adds `test/concurrency-worker.ts` and `test/concurrency.test.ts`.

The suite proves:

1. two independent SQLite connections may both read version 1, but only the first conditional write can advance it;
2. four separate Node processes released simultaneously with `expectedVersion = 1` produce exactly one successful update and three version conflicts;
3. the final canonical record is version 2, never version 3/4/5 from stale writers;
4. each losing process observes `currentVersion = 2`;
5. competing bounded transactions obey the same one-winner rule;
6. a stale soft delete cannot delete a record another writer already advanced.

### Verification evidence

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

### Deliberately not implemented

Task 2.1 does not implement:

- persistent idempotency (completed later in Task 11 / Phase 2.2);
- request fingerprints (completed later in Task 11 / Phase 2.2);
- idempotent replay (completed later in Task 11 / Phase 2.2);
- mutation events;
- durable receipts;
- bulk operations;
- backup/export/import;
- database migration framework;
- user-schema migration execution;
- corruption recovery workflow.

Those remain later Phase 2 tasks.

### Task 2.1 gate

**PASSED.**

Acceptance requirements are satisfied:

- stale writes cannot overwrite newer committed record state;
- stale soft deletes cannot delete newer committed state;
- the decisive version comparison occurs at the storage write;
- real independent-process races have exactly one winner;
- bounded transactions cannot bypass version checks;
- no Task 2.2 idempotency persistence was introduced early; Task 2.2 has since completed separately.

---

## Task 11 / 41 - Phase 2.2 Idempotent mutations

**Status:** COMPLETE

### Implemented

Durable retry-safe idempotency now applies to:

```text
data.record.create
data.record.update
data.record.delete
data.transaction.execute
```

The direct public `DataRecords` create/update/soft-delete surface also requires an idempotency key.

SQLite persists a workspace-database-global `_idempotency` table containing:

- key;
- operation;
- fingerprint version;
- canonical request SHA-256;
- canonical original result JSON;
- result SHA-256;
- commit timestamp.

Fingerprint version 1 binds the operation, trusted actor, and semantic request. Object property insertion order is normalized deterministically.

### Replay semantics

Matching committed key + fingerprint:

```text
return original committed result
do not execute again
```

Replay happens before current record/version checks, allowing a genuine successful update retry to return its original result even after the record later advances.

Different reuse returns:

```text
IDEMPOTENCY_CONFLICT
```

### Atomicity

Fresh canonical mutation effects and their idempotency entry commit in the same short SQLite transaction.

Failed mutations do not reserve keys.

For bounded transactions, nested mutation idempotency entries and the outer transaction result all share the outer atomic transaction. Any failure rolls all of them back.

### Persistence and corruption behavior

Replay survives close/reopen.

Stored result SHA-256 is verified before replay. Tampered replay state fails closed as `DATABASE_CORRUPT`.

Committed v0.1 idempotency entries do not automatically expire.

### Real duplicate-delivery proof

Separate-process tests prove:

1. four processes delivering the same key and same request create exactly one canonical record;
2. every caller receives the same generated record ID and original timestamp;
3. two processes racing with the same key but different payloads result in one commit and one `IDEMPOTENCY_CONFLICT`.

### Verification evidence

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

### Deliberately not implemented

Task 2.2 does not implement:

- mutation events;
- durable mutation receipts;
- event/receipt IDs;
- event queries;
- idempotency auto-expiry/pruning;
- external-system side-effect idempotency.

At the Task 2.2 boundary those remained later tasks, with events/receipts/provenance next in Task 12 / 41. Task 12 / Phase 2.3 has since completed that provenance layer.

### Task 2.2 gate

**PASSED.**

Acceptance requirements are satisfied:

- committed duplicate delivery does not duplicate canonical state;
- matching retries return the original successful result;
- changed key reuse conflicts;
- actor and operation are fingerprint-bound;
- failed writes do not leave ghost reservations;
- restart/reopen preserves replay;
- transaction idempotency is atomic with nested effects;
- real concurrent duplicate/conflicting deliveries behave deterministically;
- no Task 2.3 events or receipts were introduced early.

---

## Task 12 / 41 - Phase 2.3 Events, receipts, provenance

**Status:** COMPLETE

### Implemented

Phase 2.3 adds durable, immutable Data audit provenance for successful record mutations and bounded transactions.

Public surface:

```text
@ai-verse/data/provenance
```

Core storage:

```text
_events
_mutation_receipts
```

Implemented guarantees:

- one record event and one receipt per fresh successful create/update/delete;
- one final `transaction.committed` event/receipt per fresh successful bounded transaction;
- nested transaction mutations retain their own event/receipt facts;
- event/receipt state commits atomically with canonical Data + relation + idempotency state;
- failed mutations and transactions leave no partial provenance;
- idempotent replay does not mint new provenance;
- receipt-returning record and transaction APIs return the original durable receipt on replay;
- trusted actor, request, transaction, scope/workspace, target, versions, and commit time are preserved;
- event and receipt SHA-256 digests are verified before public use;
- linked receipt/event shared fields must match;
- SQLite triggers reject normal UPDATE/DELETE against provenance tables;
- full record payloads are not copied into normal event details;
- event streams are bounded and use filter-bound opaque cursors;
- workspace-wide event queries can include transaction-level events;
- fresh transactions reject old nested idempotency provenance, duplicate nested keys, and outer/nested key reuse.

### Adversarial finding closed during implementation

The audit identified a subtle possible provenance-laundering case: a fresh transaction could otherwise reuse a nested idempotency key that had committed earlier outside that transaction.

The transaction engine now requires each nested receipt to belong to the current transaction ID and request ID. A prior committed nested key is rejected with `TRANSACTION_INVALID`, and the fresh outer transaction rolls back.

### Verification

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

### Deliberately not implemented

Task 2.3 does not implement:

- bulk mutation APIs;
- bulk dry-run/preview;
- event subscriptions;
- automation scheduling;
- Memory writes;
- cross-workspace event aggregation;
- external-system side-effect receipts.

At the Task 2.3 boundary those remained later tasks and Task 13 / 41 was next. Task 13 / Phase 2.4 has since completed bounded bulk preview/execute; the other listed capabilities remain later work.

### Task 2.3 gate

**PASSED.**

---

## Task 13 / 41 - Phase 2.4 Bulk-operation safety and limits

**Status:** COMPLETE

### Implemented

Phase 2.4 adds a bounded review-before-commit bulk layer without introducing a second mutation engine.

Public surface:

```text
@ai-verse/data/bulk
```

Protocol operations:

```text
data.bulk.preview
data.bulk.execute
```

Hard limits:

```text
50 operations
256 KiB bulk payload
```

Core guarantees:

- preview runs the real bounded transaction logic inside an intentional rollback;
- preview commits no records, relations, idempotency rows, events, receipts, or event-sequence state;
- temporary preview-generated create IDs are not exposed as canonical IDs;
- preview returns a SHA-256 digest bound to actor, exact ordered operations, deterministic state summary, and all-or-nothing policy;
- execute requires the exact preview digest and revalidates current state;
- changed reviewed operations fail with `BULK_PREVIEW_STALE`;
- stale expected versions/reference failures still fail through the normal lower-layer errors;
- commit is always all-or-nothing;
- there is no best-effort partial-success mode;
- bulk outer idempotency protects retry of the complete operation set;
- the underlying transaction keeps its own deterministic idempotency identity;
- nested keys remain unique and separated from bulk/transaction keys;
- replay is checked against the underlying transaction idempotency result and durable provenance receipt;
- successful bulk commit reuses normal nested record events plus the final transaction event/receipt;
- Phase 2.4 adds no new canonical SQLite table.

### Verification

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

### Deliberately not implemented

Task 2.4 does not implement:

- best-effort partial bulk success;
- unbounded/background batch jobs;
- cross-workspace bulk writes;
- bulk schema migrations;
- backup creation;
- backup restore;
- export/import;
- internal migration behavior.

Those remain later tasks. Task 14 / 41 is next.

### Task 2.4 gate

**PASSED.**

---

## Task 14 / 41 - Phase 2.5 Backup/export/import foundation

**Status:** COMPLETE

### Implemented

Phase 2.5 adds verified copy, transfer, and restore primitives without changing canonical mutation semantics.

Public surface:

```text
@ai-verse/data/backup
```

Implemented guarantees:

- physical SQLite backup uses SQLite's online backup API;
- backup destinations are atomically reserved and never overwritten;
- portable export is logically separate from a low-level SQLite backup;
- portable export first captures a consistent SQLite snapshot, then reads from that snapshot;
- backup/export artifacts contain a versioned manifest and versioned artifact receipt;
- payload byte count and SHA-256 are recorded and verified;
- the exact manifest bytes are SHA-256 bound into the receipt;
- deterministic logical state receives its own SHA-256 digest;
- complete schema history, records, tombstones, relation indexes, idempotency state, events, receipts, and event sequence are preserved;
- stored records are revalidated against their historical schema versions;
- relation indexes are checked against canonical references;
- idempotency result digests and canonical JSON are checked;
- event/receipt digests and linkage are checked;
- historical provenance committed while a database was legitimately unbound remains valid after later binding;
- artifacts fail closed on format, file, digest, binding, or semantic mismatch;
- restore/import require the exact trusted destination binding;
- restore/import refuse an already-existing canonical database;
- transfer materializes into staging before canonical installation;
- the staging database is sealed into a self-contained SQLite database;
- canonical installation is no-replace;
- installed canonical state is reopened and reverified;
- import is exact transfer into an empty destination, not merge/import into existing Data.

### Behavioral verification

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

The added suite proves exact physical backup/restore state equality, deterministic portable export/import equality, schema-history and tombstone preservation, relation preservation, idempotent record replay after transfer, bulk replay after transfer, provenance preservation, payload-tamper rejection, workspace-binding rejection, existing-destination rejection, valid pre-binding provenance preservation, and low-level backup no-overwrite behavior.

Documentation closeout candidate verification:

```text
Closeout head:       115280c8edb21eeac272828a01e5c56cc2feea90
GitHub Actions run:  34588699217
Node 22:             PASS
Node 24:             PASS
Tests:               162 / 162 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

Detailed contract: `docs/BACKUP-EXPORT-IMPORT-V0.1.md`.

### Deliberately not implemented

Task 2.5 does not implement:

- database-format migration execution;
- migration ledger/checkpoint semantics;
- user-schema migrations/backfills;
- cross-workspace remapping;
- merge/import into an existing canonical database;
- overwrite restore;
- corruption repair;
- background scheduling or cloud backup transport.

At the Task 2.5 boundary, Task 15 / 41 was next. Task 15 / Phase 2.6 has since completed the internal database-format migration framework, and Task 16 / Phase 2.7 has since completed user-schema migrations. Recovery and the Phase 2 gate remain later tasks.

### Task 2.5 gate

**PASSED.**

---

## Task 15 / 41 - Phase 2.6 Internal migration framework

**Status:** COMPLETE

### Implemented

Phase 2.6 adds an explicit engine-owned internal SQLite format migration system.

Current canonical format:

```text
ai-verse-data/sqlite
format version: 2
SQLite user_version: 2
migration framework version: 1
```

Core guarantees:

- fresh databases bootstrap directly at current format v2;
- format v2 contains the fixed `_schema_migrations` ledger;
- migration definitions have stable IDs and deterministic SHA-256 digests;
- the first migration is `sqlite-0001-v1-to-v2`;
- `inspectMigration` reports current/required/incomplete state without mutating canonical storage;
- normal `open` never auto-migrates;
- supported v1 databases fail normal open with `DATABASE_MIGRATION_REQUIRED`;
- failed/interrupted ledger state fails normal open with `DATABASE_MIGRATION_INCOMPLETE`;
- unsupported newer formats remain fail-closed;
- explicit migration requires a verified consistent pre-migration backup;
- migration backup uses the shared Phase 2.5 SQLite online-backup primitive;
- migration-backup artifact includes payload digest, exact manifest digest, source format/binding, and receipt;
- backup artifacts are opened read-only and SQLite-integrity checked during verification;
- backup destination is never overwritten;
- migration execution uses immediate transactional semantics;
- canonical format metadata, SQLite `user_version`, migration changes, and completed ledger state commit atomically;
- interruption after durable `in_progress` registration remains detectable;
- failed migration retains the old format and durable failed/incomplete state;
- explicit retry/resume uses the same installed migration definition and increments attempt state;
- current-format incomplete state cannot masquerade as a resumable old-format migration;
- final SQLite integrity failure is fail-closed;
- trusted binding is preserved exactly;
- canonical records, idempotency results/replay, events, and receipts survive migration.

### Behavioral verification

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

Documentation closeout candidate verification:

```text
Closeout head:       2ce1cf3ce4d459885bb12552b6abb694806b803a
GitHub Actions run:  34591037137
Node 22:             PASS
Node 24:             PASS
Tests:               173 / 173 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

### Deliberately not implemented

Task 2.6 does not implement:

- user entity-schema migration execution;
- field backfill plans;
- destructive user-schema change approval;
- migration-generated user record rewrites;
- automatic internal migration during normal open;
- downgrade migration;
- corruption repair/recovery;
- arbitrary model-generated SQL migrations.

At the Task 2.6 boundary, Task 16 / 41 was next. Task 16 / Phase 2.7 has since completed the governed user-schema migration framework; corruption/recovery behavior and the Phase 2 gate remain later tasks.

### Task 2.6 gate

**PASSED.**

---

## Task 16 / 41 - Phase 2.7 User-schema migration framework

**Status:** COMPLETE

### Implemented

Phase 2.7 adds a governed logical entity-schema migration path without changing the internal SQLite database format.

Core guarantees:

- public `@ai-verse/data/schema-migrations` surface;
- structured preview/execute protocol operations, never caller SQL;
- consistent SQLite read-transaction preview;
- `expectedSchemaVersion` compare-and-swap boundary;
- immutable next schema version + deterministic schema digest;
- deterministic migration preview digest over schema instructions plus active record versions/data and resulting relation state;
- execution recomputes that digest under immediate write intent;
- required-field backfills can be planned explicitly;
- deterministic `set_if_missing` and destructive `set` backfills;
- remove/replace/rename field migrations are explicit;
- destructive operations require approval metadata;
- migration owner, trusted executor, and approver remain distinct provenance fields;
- maximum 500 active records;
- maximum 8 MiB source record state and 8 MiB rewritten state;
- active records advance schema version and record version exactly once;
- deleted records remain historical;
- reference targets are revalidated against the proposed schema;
- normalized outgoing relation indexes are rebuilt atomically;
- stale preview/schema/record state commits nothing;
- matching idempotent retry produces no duplicate schema version, record rewrite, event, or receipt;
- migration record updates use existing immutable provenance + idempotency machinery;
- one transaction-level event/receipt identifies the semantic schema migration and its child audit facts;
- forced mid-commit provenance failure proves the whole migration rolls back.

### Behavioral verification

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

Documentation closeout candidate verification:

```text
Closeout head:       ec03751517caf67e72361c25cd77792b77da3bd7
GitHub Actions run:  34593931881
Node 22:             PASS
Node 24:             PASS
Tests:               185 / 185 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

### Deliberately not implemented

Task 2.7 does not implement:

- arbitrary SQL or arbitrary-code backfills;
- cross-workspace schema migrations;
- checkpointed/unbounded large migrations;
- automatic migrations based on model suggestion;
- hard-deleted record recovery;
- corruption repair;
- recovery selection/restoration policy;
- Task 17 corruption/recovery behavior.

Task 17 / 41 is next.

### Task 2.7 gate

**PASSED.**

---

## Remaining Phase 2 tasks

| Overall task | Phase task | Status | Purpose |
|---|---|---|---|
| 17 / 41 | 2.8 | NEXT | Corruption/recovery behavior |
| 18 / 41 | 2.9 | NOT STARTED | Phase 2 gate |

## Current boundary

Task 17 / 41 is next. Do not begin Task 18 / 41 until Task 17 is implemented, verified, committed, logged in `docs/CONTINUATION-HANDOFF.md`, and reported complete.
