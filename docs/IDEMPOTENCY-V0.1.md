# AI-Verse Data Idempotency v0.1

**Status:** Implemented in Phase 2.2  
**Date:** 2026-09-10

## 1. Purpose

Phase 2.2 makes record and bounded-transaction mutations safe to retry after an uncertain transport outcome.

The core guarantee is:

```text
same idempotency key
+ same committed mutation
-> return the original committed result
-> do not execute the mutation again
```

A reused key is never treated as permission to execute a different mutation.

## 2. Covered mutation surfaces

Idempotency is implemented for:

```text
data.record.create
data.record.update
data.record.delete
data.transaction.execute
```

The public low-level record API also requires an idempotency key for create, update, and soft delete.

Package surface:

```text
@ai-verse/data/idempotency
```

## 3. Workspace-database scope

An idempotency key is unique inside one canonical workspace database.

It is not scoped separately by:

- Data Space;
- entity;
- record;
- operation;
- actor.

Therefore one key cannot be reused for a different operation or actor inside that workspace database.

Different workspace databases remain physically isolated and may independently contain the same textual key.

## 4. Canonical request fingerprint

Every fresh mutation receives a deterministic SHA-256 request fingerprint.

Fingerprint version:

```text
1
```

The fingerprint binds:

```text
fingerprint version
operation
trusted actor
semantic mutation request
```

The idempotency key itself is excluded from fingerprint material.

For direct record mutations, request material includes the canonical logical fields relevant to that operation.

Examples:

```text
create:
  spaceId
  entity
  data
  optional clientRef

update:
  spaceId
  entity
  recordId
  expectedVersion
  patch

delete:
  spaceId
  entity
  recordId
  expectedVersion
  optional reason
```

For a bounded transaction, the fingerprint binds the ordered nested operation list.

## 5. Canonical JSON

Fingerprint serialization is deterministic.

Object keys are recursively sorted by raw string/code-point comparison before hashing.

Therefore these represent the same semantic request fingerprint:

```json
{ "name": "A", "value": 1 }
```

```json
{ "value": 1, "name": "A" }
```

Array ordering remains meaningful.

Changing a value, operation, actor, expected version, transaction operation order, or other semantic field changes the fingerprint.

## 6. Durable SQLite storage

SQLite maintains the fixed engine-owned table:

```text
_idempotency
```

Stored fields:

```text
idempotency_key
operation
fingerprint_version
request_fingerprint
result_json
result_digest
created_at
```

The table is STRICT and WITHOUT ROWID.

The key is the primary key.

A created-time index exists for future explicit maintenance and diagnostics.

## 7. Replay result

The stored replay value is the exact logical result returned by the original successful mutation.

Replay returns that original committed snapshot, not the record's current state.

Example:

```text
create K -> record version 1
later update -> record version 2
later update -> record version 3

retry create K
-> return original create result, version 1
-> do not create another record
-> current canonical record remains version 3
```

The same rule applies to update, delete, and bounded transaction results.

## 8. Replay before current-state checks

For a recognized matching idempotency key, replay is resolved before current record/version state is re-evaluated.

This is required for safe retry.

Example:

```text
update K expectedVersion=1 succeeds
  -> canonical record becomes version 2

same update K arrives again
  -> expectedVersion=1 is now stale
  -> but K already proves this exact mutation committed
  -> return original successful version-2 result
  -> no second update
```

Without this ordering, successful retries would incorrectly become version conflicts.

## 9. Same key, different request

If a stored key exists but its operation or request fingerprint differs, Data returns:

```text
IDEMPOTENCY_CONFLICT
```

The mutation does not execute.

This includes:

- different payload;
- different operation;
- different actor;
- different expected version;
- different delete reason;
- different transaction contents or order.

The key is therefore permanently bound to the committed mutation it first represents.

## 10. Actor binding

The trusted actor is part of the request fingerprint.

A key committed by one actor cannot be reused by another actor to obtain a matching replay.

This is defense in depth for mutation identity.

It is not authentication.

Future host integration must still establish and authorize the actor before allowing access to the Data mutation surface or a replay.

Idempotency never grants authority.

## 11. Atomic commit model

Fresh idempotency handling runs inside the same short canonical SQLite write transaction as the mutation.

Conceptually:

```text
BEGIN IMMEDIATE
  lookup idempotency key

  if matching committed entry:
    return saved result
    COMMIT/finish with no canonical mutation

  if conflicting entry:
    fail

  if fresh:
    validate + execute canonical mutation
    update relations as required
    save idempotency key/fingerprint/result
COMMIT
```

The mutation and its replay-control record therefore cannot intentionally commit independently.

## 12. Crash semantics

The atomic transaction provides a simple uncertainty model.

### Crash before commit

Neither the canonical mutation nor its idempotency entry commits.

A later retry is fresh and may execute normally.

### Crash after commit

Both the canonical mutation and idempotency result exist.

A later retry returns the original committed result and does not execute again.

There is no durable exposed `in_progress` idempotency state in v0.1.

## 13. Failed mutations do not reserve keys

Validation errors, version conflicts, relation errors, or any other failed mutation roll back without creating an idempotency entry.

Therefore:

```text
attempt K fails
-> K is still unused
-> caller may correct the request and reuse K
```

Only a successful committed mutation binds a key permanently.

## 14. Bounded transaction idempotency

`data.transaction.execute` has an outer idempotency key.

Each nested record mutation also has its own required key.

The outer key stores the entire successful transaction result, including generated record IDs and transaction-local `clientRef` resolutions.

A retry of the same outer transaction key:

- returns the original full result;
- does not rerun nested operations;
- therefore returns the same generated record IDs.

On a fresh transaction, nested idempotency entries are written inside the same outer transaction.

If any nested operation fails, canonical data, nested idempotency entries, and the outer idempotency entry all roll back together.

## 15. Concurrent duplicate delivery

SQLite write serialization plus the idempotency primary key provides deterministic local duplicate handling.

For multiple processes delivering the same key and same request concurrently:

```text
one process executes and commits
other processes wait
other processes observe the committed matching key
other processes replay the same result
```

The acceptance suite releases four separate Node processes against one SQLite file and verifies:

- all calls succeed;
- all receive the same canonical record ID;
- all receive the same original creation timestamp;
- only one canonical record exists.

## 16. Concurrent conflicting reuse

If two processes race with the same key but different payloads:

```text
one request commits
the other observes the bound key
the other receives IDEMPOTENCY_CONFLICT
only one canonical mutation exists
```

There is no last-write-wins behavior.

## 17. Replay-result integrity

The persisted result is accompanied by a SHA-256 digest.

Before replay, Data recomputes that digest.

A mismatch fails closed as:

```text
DATABASE_CORRUPT
```

Data does not replay untrusted or tampered result state.

Stored fingerprint metadata, digest shape, timestamp, key bounds, and fingerprint version are also validated when read.

## 18. Key validation

Mutation keys must:

- be strings;
- contain 1..256 characters;
- contain no NUL.

The protocol and direct record API share the same length ceiling.

Key format is intentionally flexible enough for caller-generated structured keys such as:

```text
task_123:update:deal_42:v7
automation:daily-sync:2026-09-10:item-17
```

The key does not select a filesystem path or SQL object.

## 19. Retention

v0.1 does not automatically expire or prune committed idempotency entries.

Reason:

If an old key is silently removed, an old delayed retry could execute the canonical mutation again.

Therefore the safe first-release rule is:

```text
committed idempotency entry remains durable
until a future explicit maintenance policy proves deletion is safe
```

Future pruning must be explicit, bounded, documented, and coordinated with backup/recovery semantics.

## 20. Authorization and replay

A matching idempotency entry proves only:

```text
this mutation committed before
```

It does not prove:

```text
this caller is currently authorized to learn or replay the result
```

The current host-neutral engine does not implement the future host authorization boundary.

When native adapters arrive, authorization must happen before exposing mutation/replay results.

## 21. Storage-driver requirement

SQLite is the first implementation.

The public semantic contract is storage-neutral.

Any future sanctioned storage driver must provide equivalent guarantees:

- atomic key lookup and mutation/result commit;
- one committed binding per key;
- same-fingerprint replay;
- conflicting-fingerprint rejection;
- no duplicate canonical execution after a committed result.

## 22.1 Phase 2.3 provenance extension

Task 12 / Phase 2.3 now composes durable idempotency with immutable mutation provenance.

For a fresh successful mutation, canonical Data effects, event, receipt, and idempotency result share the same SQLite transaction.

For a matching retry:

```text
return original mutation result
return original durable receipt through receipt-returning APIs
create no new event
create no new receipt
```

A retry may carry a different delivery-time request ID, but the durable receipt continues to identify the original committed request.

Bounded transactions also protect provenance from nested idempotency reuse. A fresh transaction rejects a nested key already committed outside that transaction, rejects duplicate nested keys, and rejects reuse of the outer key as a nested key.

Detailed contract: `docs/EVENTS-RECEIPTS-PROVENANCE-V0.1.md`.

## 22. Deliberately not implemented

Phase 2.2 does not implement:

- idempotency cleanup/pruning command;
- cross-database/global distributed idempotency;
- external-system side-effect idempotency;
- remote multi-primary coordination.

Events, receipts, and provenance are implemented in Task 12 / Phase 2.3.

## 23. Non-negotiable invariants

1. Successful retries do not duplicate canonical mutations.
2. Same key plus same semantic request returns the original committed result.
3. Same key plus different semantic request returns `IDEMPOTENCY_CONFLICT`.
4. The key is unique across one workspace database.
5. Operation and trusted actor are bound into the fingerprint.
6. Object property order does not change the fingerprint.
7. Failed mutations do not reserve keys.
8. Mutation and idempotency entry commit atomically.
9. Transaction failure rolls back nested and outer idempotency state.
10. Replay result integrity is digest-checked.
11. Committed entries do not silently expire in v0.1.
12. Idempotency is not authorization.
13. Events and receipts compose with idempotency through the Phase 2.3 provenance contract.
