# AI-Verse Data Bulk Operations v0.1

**Status:** Implemented in Phase 2.4  
**Date:** 2026-09-11

## 1. Purpose

Phase 2.4 adds a bounded way for humans, agents, Apps, and automations to review and commit multiple Data mutations without bypassing the safety guarantees already implemented for normal record and transaction writes.

The core rule is:

```text
preview exact mutation semantics
-> commit nothing

execute reviewed operation set
-> all operations commit together
or
-> none commit
```

There is no best-effort partial-success bulk mode in v0.1.

## 2. Public package surface

```text
@ai-verse/data/bulk
```

Primary API:

```ts
const bulk = new DataBulk(database)

const preview = bulk.preview({
  actor,
  operations
})

const result = bulk.execute({
  actor,
  idempotencyKey,
  expectedPreviewDigest: preview.previewDigest,
  operations
})
```

## 3. Protocol operations

Phase 2.4 adds:

```text
data.bulk.preview
data.bulk.execute
```

Both use the existing bounded record mutation shapes:

```text
data.record.create
data.record.update
data.record.delete
```

Bulk does not introduce arbitrary SQL, arbitrary database paths, schema mutation, cross-workspace writes, or an alternate record mutation engine.

## 4. Hard limits

The engine owns non-negotiable ceilings:

```text
max bulk operations = 50
max bulk payload    = 256 KiB
```

The caller cannot raise these limits.

An empty bulk request is rejected.

Over-count and over-byte requests fail before canonical mutation.

## 5. Preview semantics

`DataBulk.preview` intentionally executes the real bounded transaction engine inside an outer rollback-only SQLite transaction.

Conceptually:

```text
BEGIN IMMEDIATE

  run exact normal transaction logic
    schema validation
    record validation
    reference validation
    expectedVersion checks
    relation-index writes
    idempotency writes
    event writes
    receipt writes

  collect deterministic preview summary

ROLLBACK intentionally
```

This design avoids maintaining a second "simulation validator" that could drift away from real commit behavior.

## 6. Preview commits nothing

A successful preview leaves no durable changes to:

- canonical records;
- relation-index rows;
- nested idempotency entries;
- transaction idempotency entries;
- mutation events;
- mutation receipts;
- SQLite event sequence state.

The acceptance suite checks all of these directly.

Preview is therefore review information, not a canonical mutation.

## 7. Preview-created IDs are not authority

The real transaction engine temporarily generates record/event/receipt/transaction IDs during rollback preview.

Those IDs are transaction-local simulation artifacts and are discarded with the rollback.

The public bulk preview deliberately does not expose generated record IDs for create operations.

Instead:

```text
recordId = null
```

for previewed creates.

Committed execution generates the actual canonical IDs.

## 8. Preview output

A successful preview returns:

```text
previewDigest
operationCount
requestBytes
atomicity = all-or-nothing
items[]
```

Each item contains bounded review metadata:

```text
index
operation
spaceId
entity
recordId | null
schemaVersion
beforeVersion | null
afterVersion
wouldBeDeleted
```

Full record payloads are not duplicated into the preview summary.

The exact requested operation list is already known to the caller and is bound into the preview digest.

## 9. Preview digest

Every preview returns a lowercase SHA-256 digest.

The digest binds:

```text
bulk preview format version
trusted actor
exact ordered mutation operations
deterministic preview summaries
atomicity policy
```

Changing the actor, payload, operation order, expected record version, nested idempotency key, reference, or other bound mutation input changes the digest.

## 10. Commit requires reviewed digest

`DataBulk.execute` requires:

```text
expectedPreviewDigest
```

The value must be a 64-character lowercase SHA-256 hex digest.

Before a fresh commit, the engine runs the exact preview again against current state.

If the resulting digest differs from the supplied digest:

```text
BULK_PREVIEW_STALE
```

and nothing is committed.

This prevents a reviewed bulk request from silently becoming a different bulk request before execution.

## 11. Current-state revalidation

The commit-time preview reuses the real transaction engine.

Therefore changed current state is not ignored.

Examples:

- stale `expectedVersion` still fails;
- deleted/missing reference targets still fail;
- schema incompatibility still fails;
- relation constraints still fail;
- reused nested idempotency provenance still fails.

The bulk layer does not weaken optimistic concurrency or referential integrity.

## 12. Atomic execution

Successful commit reuses `DataTransactions.executeWithReceipt`.

The v0.1 bulk atomicity policy is always:

```text
all-or-nothing
```

There is no parameter for:

```text
continueOnError
bestEffort
partialSuccess
skipFailures
```

If any operation fails, the outer transaction rolls back all operations and their associated relation/idempotency/provenance effects.

## 13. Idempotency model

Bulk execution has its own durable outer idempotency key.

It is bound to:

```text
operation = data.bulk.execute
trusted actor
expected preview digest
exact ordered operation set
```

A matching retry returns the original bulk result.

A changed request using the same bulk key returns the existing idempotency conflict behavior.

## 14. Underlying transaction idempotency

The bulk engine derives a deterministic internal transaction idempotency key from the bulk key.

This gives the committed transaction its normal transaction-level retry identity without exposing a second user-supplied outer transaction key.

Nested record mutations keep their own caller-supplied idempotency keys.

Key-separation rules require:

1. bulk outer key differs from every nested key;
2. nested keys are unique;
3. nested keys do not collide with the derived transaction key;
4. normal transaction provenance rules remain enforced.

## 15. Replay verification

Bulk replay does not blindly trust only the outer bulk idempotency value.

Before returning a stored replay, the engine verifies:

1. the underlying transaction idempotency result still exists;
2. the underlying transaction result equals the stored bulk transaction result;
3. the stored transaction receipt still resolves through durable provenance;
4. the durable receipt equals the receipt stored in the bulk replay result.

Inconsistent durable state fails closed as database corruption rather than returning an unverified replay.

## 16. Provenance model

Bulk is a safety/orchestration wrapper around one canonical bounded transaction.

It does not mint a second synthetic "bulk mutation" event in v0.1.

A successful bulk commit therefore produces the same canonical provenance as the transaction it executes:

```text
nested record event + receipt
nested record event + receipt
...
transaction.committed event + receipt
```

`DataBulk.execute` returns the final transaction receipt as:

```text
transactionReceipt
```

This avoids duplicate audit facts for one canonical mutation set.

## 17. Preview and provenance

Preview creates no durable audit event because no canonical mutation commits.

That is deliberate.

Audit history should state what happened, not what was merely simulated and rolled back.

A higher-level UI may separately keep its own non-canonical interaction history if needed, but it must not forge Data mutation events.

## 18. ClientRef support

Because preview and commit both reuse the existing transaction engine, safe backward `clientRef` references work in bulk operations exactly as they do in bounded transactions.

Example:

```text
create company with clientRef "company"
create deal referencing { "$ref": "company" }
```

Preview validates that relation in rollback state.

Commit generates new canonical record IDs and persists the real relation atomically.

Preview never exposes the temporary generated create IDs.

## 19. Failure codes

Bulk-specific stable errors include:

```text
BULK_INVALID
BULK_LIMIT_EXCEEDED
BULK_PREVIEW_STALE
```

Existing lower-layer failures are intentionally preserved when they are more precise, including record-version, reference, schema, transaction, idempotency, and corruption errors.

## 20. Storage impact

Phase 2.4 adds no new canonical SQLite table.

Bulk reuses:

```text
_records
_record_relations
_idempotency
_events
_mutation_receipts
```

and the existing storage transaction boundary.

SQLite remains an implementation driver, not the public bulk semantic contract.

A future sanctioned storage driver must provide equivalent rollback preview and atomic execution guarantees.

## 21. Security boundary

Bulk does not grant authority.

The trusted host remains responsible for actor identity, workspace scope, capability/permission checks, and approval policy before exposing a bulk mutation surface.

Preview does not count as permission to execute.

A preview digest proves only:

```text
this actor reviewed this exact validated operation set/state summary
```

It is not authentication, authorization, or a cryptographic human signature.

## 22. Deliberately not implemented

Phase 2.4 does not implement:

- best-effort partial success;
- unbounded batch jobs;
- background batch scheduling;
- cross-workspace bulk writes;
- schema bulk migrations;
- bulk hard purge;
- bulk import/export;
- backup creation;
- backup restore;
- remote/distributed transactions;
- external-system side-effect batching.

Backup/export/import belongs to Task 14 / Phase 2.5.

## 23. Behavioral verification

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

The suite proves exact rollback preview, zero committed preview state including event sequence, clientRef simulation, digest binding, actor binding, atomic commit, stale-state rejection, idempotent replay, key separation, count ceilings, byte ceilings, and protocol validation.

Final exact-head documentation closeout CI is verified separately after all status/log updates.

## 24. Non-negotiable invariants

1. Bulk is bounded by hard engine ceilings.
2. Preview uses real mutation semantics, not an approximate parallel validator.
3. Preview commits no canonical or supporting mutation state.
4. Preview-generated create IDs never become public canonical identity.
5. Commit requires the exact reviewed preview digest.
6. The preview digest binds actor, ordered operations, and deterministic state summary.
7. Commit revalidates current state.
8. Commit is all-or-nothing.
9. Bulk never silently becomes best-effort partial success.
10. Existing schema/reference/OCC/idempotency/provenance guarantees remain active.
11. Matching bulk retries do not duplicate canonical mutations.
12. Bulk replay is checked against underlying transaction idempotency and durable provenance.
13. Bulk does not create duplicate synthetic audit facts for one transaction.
14. Normal APIs still do not accept raw SQL or canonical database paths.
15. Workspace isolation remains enforced by the existing database scope boundary.
16. Task 14 backup/export/import behavior is not implemented early.
