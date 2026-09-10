# AI-Verse Data Events, Receipts, and Provenance v0.1

**Status:** Implemented in Phase 2.3  
**Date:** 2026-09-10

## 1. Purpose

Phase 2.3 gives every successfully committed record mutation and bounded transaction a durable, inspectable audit fact.

The core model is:

```text
canonical mutation
+ immutable Data event
+ durable mutation receipt
+ idempotency result
-> commit together
```

Events are structured Data history. They are not AI-Verse Memory and do not automatically become semantic memories.

## 2. Public package surface

Public reader/API surface:

```text
@ai-verse/data/provenance
```

Primary public class:

```ts
const provenance = new DataProvenance(database)
```

Public callers may list mutation events, fetch a receipt by receipt ID, fetch the receipt for a committed idempotency key, and list all receipts linked to one bounded transaction.

The internal provenance writer is deliberately not exported from the public package surface. Normal callers therefore cannot use the public API to append fabricated audit facts.

## 3. Covered committed operations

Phase 2.3 emits provenance for:

```text
data.record.create        -> record.created
data.record.update        -> record.updated
data.record.delete        -> record.deleted
data.transaction.execute  -> transaction.committed
```

A bounded transaction also preserves the individual nested record mutation events and receipts.

## 4. Event and receipt identity

Every event receives an engine-generated opaque ID:

```text
evt_<generated-id>
```

SQLite also assigns a monotonic local event sequence used for deterministic pagination and transaction ordering. It is not authorization or a globally distributed clock.

Every successful provenance event has exactly one durable receipt:

```text
rcpt_<generated-id>
```

The receipt proves that AI-Verse Data committed the represented local mutation. It does not prove an unrelated external system performed a side effect.

## 5. Request and transaction identity

Every mutation event stores a request ID:

```text
req_<generated-or-caller-supplied-id>
```

Direct record mutations have no transaction ID unless executing inside a bounded transaction.

Every fresh bounded transaction receives:

```text
txn_<generated-id>
```

The same transaction ID is attached to every nested record event, every nested mutation receipt, the final `transaction.committed` event, and the final transaction receipt.

## 6. Scope provenance

Provenance stores a snapshot of the trusted database binding:

```text
scopeKind: unbound | standalone | workspace
workspaceId: string | null
```

For a bound workspace database, `scopeKind = workspace` and `workspaceId` comes from the trusted database binding.

Dashboard `systemId`, arbitrary absolute paths, and model-provided filesystem identities are not persisted as canonical provenance identity.

## 7. Record mutation event shape

Record events carry event ID, event type, operation, request ID, optional transaction ID, scope kind/workspace ID, idempotency key, Data Space/entity/record ID, before/after versions, trusted actor, committed timestamp, and bounded structured details.

Version rules:

```text
record.created:
  beforeVersion = null
  afterVersion = 1

record.updated:
  afterVersion = beforeVersion + 1

record.deleted:
  afterVersion = beforeVersion + 1
```

The reader fails closed if persisted version relationships are invalid.

## 8. Transaction event shape

A successful bounded transaction emits one final event:

```text
eventType = transaction.committed
operation = data.transaction.execute
```

It has request ID, transaction ID, outer idempotency key, actor, commit timestamp, no single Data Space/entity/record target, no record before/after version, and structured details containing operation count plus ordered child event and receipt IDs.

## 9. No full record payload duplication

Events do not duplicate the complete canonical record payload.

Current record-event details are intentionally small, for example:

```json
{ "schemaVersion": 1 }
```

Delete may additionally include its reason.

The canonical record remains in the Data record store. This keeps provenance inspectable without turning the event stream into a second editable source of truth or an unnecessary copy of sensitive structured records.

## 10. SQLite storage

SQLite uses two fixed engine-owned tables:

```text
_events
_mutation_receipts
```

`_events` is append-oriented and STRICT. `_mutation_receipts` is STRICT and WITHOUT ROWID.

The schema constrains event types, supported mutation operations, scope/workspace consistency, positive versions when present, JSON validity, one event per idempotency key, one receipt per event, and one receipt per idempotency key.

## 11. Append-only enforcement

SQLite triggers reject normal UPDATE and DELETE operations against both provenance tables:

```text
_events_no_update
_events_no_delete
_receipts_no_update
_receipts_no_delete
```

This prevents ordinary accidental or application-level mutation of committed provenance. The triggers are defense in depth, not a cryptographic trust boundary against an administrator who can replace the whole database file.

## 12. Event and receipt integrity

Every event stores a SHA-256 digest over its canonical structured provenance fields.

Before returning an event, the public reader validates identifiers, event type/operation, actor, scope, timestamp, versions, event-specific semantics, structured details, and the event digest.

Every receipt also stores its own SHA-256 digest. Before returning a receipt, the reader validates the receipt, recomputes its digest, loads and validates the linked event, and verifies all shared provenance fields match.

A mismatch or broken linkage fails closed as:

```text
DATABASE_CORRUPT
```

## 13. Actor attribution

The trusted mutation actor is persisted in both event and receipt.

Supported actor kinds remain:

```text
human
bot
worker
app
automation
system
import
connection
```

Provenance records attribution. It does not authenticate the actor by itself. A host integration remains responsible for trusted identity and effective authorization.

## 14. Receipt-returning APIs

Existing record mutation APIs remain compatible:

```ts
records.create(...)
records.update(...)
records.softDelete(...)
```

They continue returning record snapshots.

Phase 2.3 adds:

```ts
records.createWithReceipt(...)
records.updateWithReceipt(...)
records.softDeleteWithReceipt(...)
```

Each returns `{ record, receipt }`.

Existing bounded transaction execution remains `transactions.execute(...)`. Phase 2.3 adds `transactions.executeWithReceipt(...)`, which returns `{ result, receipt }`. The returned receipt is the final transaction receipt; nested receipts remain queryable through the transaction ID.

## 15. Atomicity

For a fresh direct record mutation, the existing short SQLite write transaction includes:

```text
record mutation
relation-index mutation if applicable
event append
receipt append
idempotency result
COMMIT
```

If any step fails, none of those effects intentionally commit.

For a fresh bounded transaction, nested record mutations, nested events/receipts/idempotency entries, the final transaction event/receipt, and outer idempotency result all share the same outer SQLite transaction.

A nested failure rolls back all canonical records, relations, events, receipts, and idempotency entries from that transaction.

## 16. Idempotent replay and provenance

A matching committed idempotency retry returns before new provenance is created.

Therefore:

```text
same committed request retried
-> same original mutation result
-> same original receipt
-> same original event
-> zero new audit facts
```

If a retry supplies a different request ID, the durable original receipt still reports the original committed request ID. The retry is not misrepresented as a second canonical mutation.

## 17. Nested idempotency provenance safety

A fresh bounded transaction may not adopt an already-committed nested mutation from outside that transaction.

Without this rule, a reused nested idempotency key could replay an old mutation and falsely present it as a child of a new transaction.

Phase 2.3 therefore requires:

1. the outer transaction idempotency key differs from every nested key;
2. nested idempotency keys are unique within the transaction;
3. each nested receipt used by a fresh transaction contains the current transaction ID;
4. each nested receipt contains the current transaction request ID.

If a nested key is already bound outside the fresh transaction, execution fails with `TRANSACTION_INVALID` and the outer transaction rolls back.

This prevents provenance laundering through idempotency replay.

## 18. Event queries and pagination

`DataProvenance.listEvents` supports a bounded event stream.

Filters may be workspace-database-wide, by Data Space, by Data Space + entity, or by Data Space + entity + record.

Hierarchy is enforced:

```text
entity requires spaceId
recordId requires spaceId + entity
```

The workspace-wide stream is necessary because `transaction.committed` events have no single Data Space/entity target.

Event pagination uses opaque `evc_` cursors containing a cursor version, last event sequence, and SHA-256 fingerprint of the event filter. A cursor from one filter cannot be reused for another filter.

## 19. Protocol event query

The `data.events.list` protocol payload permits a workspace-wide request:

```json
{}
```

or progressively narrower filters:

```json
{
  "spaceId": "crm",
  "entity": "deals",
  "recordId": "rec_...",
  "after": null,
  "limit": 100
}
```

Ambiguous shapes such as an entity without its Data Space are rejected.

## 20. Receipt lookups

Public receipt lookup supports receipt ID, idempotency key, and transaction ID.

A missing single receipt returns:

```text
RECEIPT_NOT_FOUND
```

Transaction receipt listing returns all linked receipts in canonical event-sequence order.

## 21. Events are not Memory

A Data event answers:

```text
What Data mutation committed?
Which record changed?
Which actor performed it?
What versions were involved?
Which transaction contained it?
```

AI-Verse Memory answers different questions about durable historical context and learned meaning.

Therefore Data events do not automatically write Memory, Memory does not become the canonical Data audit log, and a future Memory bridge may selectively reference Data evidence without mirroring the event database.

## 22. Public writer boundary

The package exports the provenance reader. The engine-internal provenance writer is not part of `@ai-verse/data/provenance`.

Normal mutation provenance is produced only as a consequence of successful canonical mutation execution.

A future import/migration framework may need governed provenance-writing privileges, but it must not become an unrestricted public event forge.

## 23. Failure behavior

Examples:

- malformed event cursor -> `QUERY_INVALID`;
- cursor reused against another filter -> `QUERY_INVALID`;
- malformed receipt ID -> `QUERY_INVALID`;
- missing receipt -> `RECEIPT_NOT_FOUND`;
- event digest mismatch -> `DATABASE_CORRUPT`;
- receipt digest mismatch -> `DATABASE_CORRUPT`;
- missing/inconsistent linked event -> `DATABASE_CORRUPT`;
- fresh transaction adopting prior nested provenance -> `TRANSACTION_INVALID`.

## 24. Deliberately not implemented

At the Phase 2.3 boundary, Task 13 bulk-operation APIs and preview/dry-run were intentionally not implemented early. They have since landed in Phase 2.4. Event subscriptions, automation scheduling, Memory writes, cross-workspace event aggregation, external-key cryptographic signing, remote multi-primary event coordination, external-system side-effect receipts, and event pruning/compaction remain outside Phase 2.3.

Bulk-operation safety has since been completed in Task 13 / Phase 2.4. Automation event adapters remain a later ecosystem-adapter task.

## 25. Verification

Behavioral verification before documentation closeout:

```text
GitHub Actions run: 34526163488
Commit: 911c5d51d605bd6234f35dc351eef76c68ac61e6
Node 22: PASS
Node 24: PASS
Tests: 141 / 141 PASS
Failures: 0
Skipped: 0
Cancelled: 0
```

Final exact-head closeout CI is verified separately after all documentation/log updates.

## 26. Non-negotiable invariants

1. A successful canonical record mutation produces one event and one receipt.
2. A successful bounded transaction produces nested record provenance plus one final transaction event/receipt.
3. Provenance commits atomically with the canonical mutation and idempotency state it describes.
4. Failed mutations leave no committed events or receipts.
5. Matching idempotent replay creates no duplicate audit facts.
6. Replayed receipt identity remains the original committed receipt.
7. Events and receipts are immutable through normal SQLite UPDATE/DELETE paths.
8. Persisted event and receipt digests are verified before public use.
9. Receipt and linked event shared fields agree exactly.
10. Full record payloads are not copied into normal provenance details.
11. Workspace provenance comes from the trusted database binding.
12. Transaction child provenance cannot be laundered through previously committed nested idempotency keys.
13. Event queries are bounded and cursor-bound to their filter.
14. Provenance writing remains internal to governed canonical mutation execution.
15. Data events are audit facts, not automatic Memory.
16. Task 13 bulk-operation behavior was not implemented early in Phase 2.3; it has since landed independently in Phase 2.4.
