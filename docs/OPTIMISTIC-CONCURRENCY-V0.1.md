# AI-Verse Data Optimistic Concurrency v0.1

**Status:** Implemented in Phase 2.1  
**Date:** 2026-09-10

## 1. Purpose

Phase 2.1 hardens record update and soft-delete operations against lost updates when multiple processes or agents act on the same canonical record.

The caller still uses optimistic concurrency:

```text
read record version N
  -> decide mutation
  -> submit expectedVersion = N
  -> commit only if canonical version is still N
```

No durable record locks, lease rows, or coordination state are introduced.

## 2. Public rule

Record update and soft delete require:

```text
expectedVersion
```

A mutation succeeds only if the active canonical record still has exactly that version.

Example:

```text
Agent A reads version 1
Agent B reads version 1

Agent A updates with expectedVersion 1
  -> COMMIT
  -> record becomes version 2

Agent B updates with expectedVersion 1
  -> RECORD_VERSION_CONFLICT
  -> canonical version remains 2
```

The second mutation never overwrites the first.

## 3. Phase 1 weakness that was closed

Phase 1 checked `expectedVersion` in TypeScript before issuing the SQLite write.

That was semantically correct for a single writer but insufficient as the final concurrency boundary because the SQL update itself did not require the old version.

Phase 2.1 moves the decisive comparison into the canonical write predicate.

Conceptually:

```sql
UPDATE _records
SET ...
WHERE space_id = ?
  AND entity_id = ?
  AND record_id = ?
  AND record_version = ?
  AND deleted_at IS NULL
```

The bound `record_version` value is the caller's validated `expectedVersion`.

## 4. Compare-and-swap storage contract

The storage-neutral `DataRecordStorage` contract now requires an expected version for mutable writes:

```ts
updateRecord(record, expectedVersion)
softDeleteRecord(record, expectedVersion)
```

The SQLite implementation returns success only when exactly one canonical row matched and changed.

This is effectively a compare-and-swap boundary:

```text
compare canonical version == expectedVersion
  -> if equal: write new state
  -> if not equal: no effect
```

SQLite remains an implementation detail. Future drivers must provide equivalent atomic semantics.

## 5. Short write transactions

Record create/update/delete operations that may alter canonical record/relation state use the storage transaction mode:

```text
immediate
```

For SQLite, this maps to a short `BEGIN IMMEDIATE` transaction through the driver.

Why:

- WAL permits concurrent readers;
- SQLite still has one writer at a time;
- beginning write intent before mutation reads avoids a read-snapshot-to-write upgrade race;
- competing writers wait according to the configured busy timeout, then re-evaluate canonical state;
- the version predicate remains the final defense against stale writes.

This is not a record-level pessimistic lock API. Callers do not reserve records before deciding what to do.

## 6. Relation integrity and concurrency

Record mutation and normalized relation-index updates remain in one database transaction.

For update:

```text
acquire short write intent
  -> read active canonical record
  -> verify expectedVersion
  -> validate resulting record
  -> validate declared references
  -> conditional record UPDATE with expectedVersion
  -> replace relation index
  -> COMMIT
```

For soft delete:

```text
acquire short write intent
  -> read active canonical record
  -> verify expectedVersion
  -> verify no active inbound references
  -> conditional soft-delete UPDATE with expectedVersion
  -> remove outgoing relation rows
  -> COMMIT
```

A failure rolls back record and relation changes together.

## 7. Bounded multi-record transactions

The outer `DataTransactions.execute(...)` write transaction also uses immediate write intent.

Nested record mutations still enforce their individual `expectedVersion` values.

Therefore two competing bounded transactions that both attempt to update the same record from version 1 cannot both commit that stale version.

One wins. The other observes the new canonical version and fails.

## 8. Conflict error

The stable record-layer error remains:

```text
RECORD_VERSION_CONFLICT
```

Conflict details include:

```text
spaceId
entity
recordId
expectedVersion
currentVersion
```

The caller should re-read current canonical state and decide again.

The engine does not silently merge stale changes.

## 9. Retry behavior

A version conflict is not automatically retry-safe.

Correct handling is:

```text
RECORD_VERSION_CONFLICT
  -> read latest record
  -> reconsider intended change
  -> if still valid, submit a new mutation using the new expectedVersion
```

Blindly replacing `expectedVersion` and replaying an old patch can overwrite a meaningful intervening edit.

Persistent transport-level retry/idempotency semantics are separate and remain Task 11 / 41.

## 10. Real race verification

Phase 2.1 adds a separate-process race worker.

The acceptance test opens the same SQLite file from independent Node processes, synchronizes them at a start barrier, and releases them to mutate the same record with the same stale `expectedVersion`.

Verified race:

```text
4 separate writer processes
all expectedVersion = 1

result:
  1 success
  3 RECORD_VERSION_CONFLICT

final canonical version:
  2
```

The test asserts every loser reports `currentVersion = 2`.

A separate test repeats the race through `DataTransactions` rather than direct record update.

## 11. Storage-level stale-write proof

The suite also reads the same version-1 row through two independent SQLite connections, constructs two candidate version-2 states, then attempts both conditional writes.

Expected result:

```text
writer A conditional update -> true
writer B conditional update -> false
final version              -> 2
```

This directly proves the version predicate exists at the canonical storage boundary rather than only in application code.

## 12. Soft-delete race safety

Soft delete uses the same atomic expected-version predicate.

A stale delete based on version 1 cannot delete a row that another writer has already advanced to version 2.

The failed stale delete leaves:

- the current record active;
- current data unchanged;
- current version unchanged;
- relation state unchanged.

## 13. SQLite busy behavior

The SQLite driver already configures:

```text
busy_timeout = 5000 ms
WAL
foreign_keys = ON
```

Competing local writers may wait briefly for the one SQLite writer slot.

A normal version race should resolve as canonical version comparison rather than as last-write-wins corruption.

Task 2.1 does not add an infinite retry loop around SQLite busy errors.

## 14. No automatic merge

AI-Verse Data does not attempt field-level conflict merging in v0.1.

Reasons:

- two edits may be semantically incompatible even when they touch different JSON keys;
- agent-generated changes may carry assumptions based on the old whole record;
- automatic merging would hide a real decision point.

Conflict resolution belongs to the caller/host/Brain policy, using current canonical state.

## 15. Deliberately not implemented

Phase 2.1 does not implement:

- persistent idempotency keys;
- replay receipts;
- mutation events;
- durable mutation receipts;
- distributed locks;
- cross-workspace transactions;
- multi-primary remote database coordination;
- automatic merge/rebase;
- schema-version concurrency hardening beyond existing catalog behavior.

Those remain separate roadmap tasks.

## 16. Non-negotiable invariants

1. A stale record update cannot overwrite a newer committed version.
2. A stale soft delete cannot delete a newer committed version.
3. The decisive expected-version comparison occurs at the canonical storage write.
4. Exactly one writer may successfully advance one canonical record from version N to N+1.
5. Conflict returns the current canonical version when available.
6. Record/relation changes remain atomic.
7. Bounded transactions cannot bypass record version checks.
8. The engine does not silently merge stale changes.
9. Optimistic concurrency does not imply persistent idempotency.
10. Task 11 remains separate.
