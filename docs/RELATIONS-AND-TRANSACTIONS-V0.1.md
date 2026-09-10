# AI-Verse Data Relations and Transactions v0.1

**Status:** Implemented in Phase 1.8  
**Date:** 2026-09-10

## 1. Purpose

Phase 1.8 adds referential integrity between declared record references and bounded atomic transactions across records inside one workspace database.

The design keeps relations explicit, schema-driven, and storage-neutral. It does not introduce joins, arbitrary SQL, cross-workspace transactions, or a second authorization system.

## 2. Declared references

A schema reference field identifies its target entity:

```json
{
  "type": "reference",
  "entity": "companies"
}
```

If `spaceId` is omitted, the reference targets the same Data Space as the source schema.

A cross-space reference inside the same workspace database may declare:

```json
{
  "type": "reference",
  "spaceId": "crm",
  "entity": "companies"
}
```

The stored record value is the canonical target `recordId`.

## 3. Referential-integrity rules

For ordinary create and update:

1. reference fields are still validated as safe record IDs;
2. every non-null reference target must exist;
3. the target must not be soft deleted;
4. the target must match the schema-declared Data Space and entity;
5. invalid references fail before the mutation commits.

These rules apply to direct CRUD and transaction mutations equally.

## 4. Normalized relation index

SQLite maintains a fixed engine-owned table:

```text
_record_relations
```

Each row stores:

```text
source Data Space
source entity
source record
source field
target Data Space
target entity
target record
```

The table is STRICT and WITHOUT ROWID.

It has foreign keys to canonical `_records` rows and an index over target identity for inbound-reference checks.

The relation index is supporting canonical structure for declared reference fields. It does not replace the source record payload or schema declaration.

## 5. Atomic record + relation changes

Record creation, update, and soft deletion now run through the storage transaction boundary when relation state can change.

This guarantees that the canonical record and its normalized relation rows do not diverge.

For example:

```text
update deal.company
  -> validate new target
  -> update deal record
  -> replace relation index row
  -> COMMIT together
```

If any step fails, the entire mutation rolls back.

## 6. Delete protection

A target record cannot be soft-deleted while an active source record still references it.

This prevents valid structured state from becoming a dangling relation.

Deleting the source record removes its outgoing relation-index rows as part of the same transaction. After no inbound references remain, the former target may be deleted normally.

Hard delete is not part of v0.1.

## 7. Workspace boundary

References may cross Data Spaces only when both records live inside the same physical workspace database.

The first release does not support:

- references into another workspace database;
- cross-workspace transactions;
- implicit remote/external references.

External-system identity belongs to future Connections/Data authority contracts rather than this local canonical relation mechanism.

## 8. Public transaction surface

Package subpath:

```text
@ai-verse/data/transactions
```

Primary API:

```ts
const transactions = new DataTransactions(database)

transactions.execute({
  actor,
  payload
})
```

The transaction payload uses the existing `data.transaction.execute` protocol shape.

## 9. Allowed transaction operations

The v0.1 transaction engine accepts only:

```text
data.record.create
data.record.update
data.record.delete
```

Every nested operation goes through the same record engine used outside transactions.

Transactions do not bypass:

- schema validation;
- record limits;
- expected-version checks;
- reference validation;
- soft-delete rules;
- actor attribution.

## 10. Transaction bounds

The protocol hard ceiling is:

```text
maximum transaction operations = 50
```

The caller cannot raise this limit.

A transaction must contain at least one operation.

## 11. Atomicity

The entire operation sequence executes inside one storage transaction on one workspace database.

Conceptually:

```text
BEGIN
  operation 1
  operation 2
  operation 3
COMMIT
```

If any nested operation throws, SQLite rolls the whole sequence back.

This includes rollback of:

- records created earlier in the transaction;
- record updates;
- soft deletes;
- relation-index changes.

## 12. Safe intra-transaction references

A create operation may declare a transaction-local alias:

```json
{
  "clientRef": "company"
}
```

A later create/update operation may reference that newly created record only inside a schema-declared reference field:

```json
{
  "company": { "$ref": "company" }
}
```

The engine replaces that exact marker with the canonical generated record ID before normal record validation.

Rules:

1. the target `clientRef` must have been created earlier in the same transaction;
2. forward references are rejected;
3. duplicate `clientRef` values are rejected;
4. `$ref` substitution occurs only for declared `reference` fields;
5. arbitrary JSON/string fields are never treated as executable reference syntax.

This keeps the mechanism explicit and prevents generic recursive string substitution.

## 13. clientRef is not identity or authority

`clientRef` exists only for the duration of one transaction.

It is:

- not a canonical record ID;
- not persisted as record identity;
- not authorization;
- not reusable across transactions.

The transaction result returns a mapping from successful local aliases to generated canonical record IDs.

## 14. Transaction result

A successful transaction returns ordered operation results plus the resolved alias map.

Conceptually:

```json
{
  "operations": [
    {
      "index": 0,
      "operation": "data.record.create",
      "record": {}
    }
  ],
  "clientRefs": {
    "company": "rec_..."
  }
}
```

Mutation receipts are not claimed yet. Durable receipts land in Task 12 / 41.

## 15. Idempotency boundary

The protocol already requires transaction and record-mutation idempotency keys.

Phase 1.8 validates those fields structurally, but does not persist or replay idempotency results.

Persistent idempotency remains Task 11 / 41.

Therefore:

```text
accepted idempotencyKey
!=
implemented idempotent replay
```

## 16. Optimistic concurrency boundary

Nested update/delete operations still require `expectedVersion`.

Phase 1.8 preserves the existing semantic conflict checks.

Race-safe optimistic-concurrency hardening under competing database writers remains Task 10 / 41.

## 17. Events and receipts

Phase 1.8 does not append mutation events or issue durable mutation receipts.

Those remain Task 12 / 41.

Transaction atomicity is implemented now; audit/event atomicity comes later when the event subsystem exists.

## 18. Not implemented

Phase 1.8 intentionally does not add:

- arbitrary joins;
- automatic relation traversal in queries;
- many-to-many collection fields;
- cross-workspace references;
- cross-workspace transactions;
- persistent idempotent replay;
- mutation events;
- durable mutation receipts;
- hard delete;
- permission/capability enforcement;
- external-system synchronization.

## 19. Non-negotiable invariants

1. Direct CRUD cannot bypass declared reference integrity.
2. Missing or deleted targets reject the mutation.
3. Record payload and normalized relation state commit together.
4. Referenced targets cannot be soft-deleted while inbound references remain.
5. One failed transaction operation rolls back the whole transaction.
6. Transaction size is bounded by the engine.
7. Intra-transaction aliases resolve only backward to earlier creates.
8. `clientRef` never becomes canonical identity or authority.
9. Transactions remain inside one workspace database.
10. Task 1.9 remains a separate Phase 1 integration gate.
