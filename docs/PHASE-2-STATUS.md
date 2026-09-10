# AI-Verse Data Phase 2 Status

**Phase:** 2 - Reliability + Agent Safety  
**Phase status:** IN PROGRESS  
**Implementation tasks completed:** 4 / 9  
**Overall implementation tasks completed:** 13 / 41  
**Next:** Task 14 / 41, Phase 2.5 - Backup/export/import foundation

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

## Remaining Phase 2 tasks

| Overall task | Phase task | Status | Purpose |
|---|---|---|---|
| 14 / 41 | 2.5 | NEXT | Backup/export/import foundation |
| 15 / 41 | 2.6 | NOT STARTED | Internal migration framework |
| 16 / 41 | 2.7 | NOT STARTED | User-schema migration framework |
| 17 / 41 | 2.8 | NOT STARTED | Corruption/recovery behavior |
| 18 / 41 | 2.9 | NOT STARTED | Phase 2 gate |

## Current boundary

Do not begin Task 15 / 41 until Task 14 / 41 is implemented, verified, committed, logged in `docs/CONTINUATION-HANDOFF.md`, and reported complete.
