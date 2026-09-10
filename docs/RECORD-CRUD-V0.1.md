# AI-Verse Data Record CRUD v0.1

**Status:** Implemented in Phase 1.6; reference integrity extended in Phase 1.8; race-safe optimistic concurrency extended in Phase 2.1  
**Date:** 2026-09-10

This document defines the first implemented canonical record layer for AI-Verse Data.

## 1. Purpose

Phase 1.6 turns Data Spaces and entity schemas into usable structured operational state.

The implemented hierarchy is now:

```text
trusted workspace database
  -> Data Space
    -> Entity schema versions
      -> canonical records
```

Records are stored in the same trusted workspace database as their Data Space and entity schema.

## 2. Public record surface

Package subpath:

```text
@ai-verse/data/records
```

Primary direct engine API:

```ts
const records = new DataRecords(database)

records.create(...)
records.get(...)
records.list(...)
records.update(...)
records.softDelete(...)
```

The direct Phase 1.6 engine API is intentionally narrower than the complete transport protocol. General query execution, transaction routing, idempotency persistence, mutation events, receipts, and permission adapters remain later tasks.

## 3. Canonical record shape

The public `DataRecord` shape is:

```text
spaceId
entity
recordId
schemaVersion
version
data
createdAt
updatedAt
createdBy
updatedBy
deletedAt
deletedReason
deletedBy
```

Example:

```json
{
  "spaceId": "crm",
  "entity": "deals",
  "recordId": "rec_0123456789abcdef0123456789abcdef",
  "schemaVersion": 2,
  "version": 3,
  "data": {
    "title": "Campaign renewal",
    "value": 18000,
    "stage": "proposal"
  },
  "createdAt": "2026-09-10T18:00:00.000Z",
  "updatedAt": "2026-09-10T18:10:00.000Z",
  "createdBy": {
    "kind": "human",
    "id": "local-operator"
  },
  "updatedBy": {
    "kind": "bot",
    "id": "sales-bot"
  },
  "deletedAt": null,
  "deletedReason": null,
  "deletedBy": null
}
```

## 4. Record storage

Phase 1.6 adds one fixed engine-owned SQLite table:

```text
_records
```

It is a SQLite STRICT table.

User entities do not become physical SQL tables.

The record row persists:

- Data Space and entity identity;
- stable record ID;
- schema version used for the write;
- monotonically increasing record version;
- canonical JSON payload;
- creation/update timestamps;
- creation/update actor attribution;
- soft-delete timestamp/reason/actor.

The record's `schemaVersion` has a foreign key to the exact immutable schema version stored in `_entity_schema_versions`.

This means a record can always be interpreted against the schema that was actually used when that record version was written.

## 5. Stable record IDs

The first engine generates record IDs internally:

```text
rec_<32 lowercase hexadecimal characters>
```

The ID is generated from cryptographically random UUID material and is stable after creation.

A caller cannot use a record ID to select a filesystem path or SQL object.

## 6. Schema validation

Every record create and update is validated against an entity schema before persistence.

Supported field types:

```text
string
number
integer
boolean
date
datetime
enum
reference
json
attachment_ref
```

Validation includes:

- required fields;
- nullable fields;
- string length limits;
- numeric min/max constraints;
- safe integers;
- valid YYYY-MM-DD dates;
- timezone-qualified ISO datetimes;
- enum membership;
- safe reference/attachment identifiers;
- JSON validity/depth/size constraints;
- unknown-field rejection unless `allowUnknownFields: true`.

Phase 1.8 extends reference fields beyond shape validation: non-null targets must exist, be active, and match the schema-declared Data Space/entity. Valid references are also maintained in the normalized `_record_relations` index atomically with the record mutation.

## 7. Defaults

On create, missing fields with declared defaults receive a deep-cloned default value before persistence.

Missing required fields without defaults fail.

On update, the engine merges the patch with the stored record and validates the full result against the current entity schema. Missing fields introduced by compatible schema evolution can therefore receive current defaults on the next write.

Stored historical records are not silently rewritten merely because a schema version changes.

## 8. Schema-version behavior

A record stores the schema version used for its current persisted payload.

Example:

```text
record created under schema v1
  -> record schemaVersion = 1

entity evolves safely to schema v2
  -> old record remains schemaVersion = 1

record updated
  -> full merged record validates against current schema v2
  -> defaults are applied where appropriate
  -> record schemaVersion becomes 2
```

Reads validate a stored record against its persisted historical schema version.

If valid stored JSON no longer satisfies that historical schema, Data treats the state as `DATABASE_CORRUPT` rather than returning untrusted canonical data.

## 9. Create

`DataRecords.create`:

1. validates actor attribution;
2. resolves the current entity schema;
3. validates the record payload;
4. applies schema defaults;
5. enforces the record-size ceiling;
6. allocates a stable record ID;
7. writes the canonical row;
8. validates declared reference targets;
9. writes the canonical row and normalized relation entries atomically;
10. returns the stored record shape.

New records begin at:

```text
version = 1
```

Creation and update timestamps are identical on the initial write.

## 10. Get

Normal get hides soft-deleted records.

```ts
records.get({
  spaceId: "crm",
  entity: "deals",
  recordId
})
```

A deleted record can be requested explicitly:

```ts
records.get({
  spaceId: "crm",
  entity: "deals",
  recordId,
  includeDeleted: true
})
```

A missing or normally hidden record returns `RECORD_NOT_FOUND`.

## 11. List

`DataRecords.list` provides a bounded basic entity listing.

The default list size reuses the protocol's safe default page size, and callers cannot exceed the protocol maximum.

Phase 1.6 intentionally does not implement the general query/filter/sort/cursor engine. That belongs to Task 7 / 41.

Normal lists hide soft-deleted records. `includeDeleted: true` includes them.

## 12. Update

Update requires:

```text
spaceId
entity
recordId
expectedVersion
patch
actor
```

The engine:

1. loads the active record;
2. checks the supplied expected version;
3. loads the record's historical schema for integrity validation;
4. merges the patch with current data;
5. validates the full result against the current schema;
6. applies missing current-schema defaults;
7. validates the resulting declared reference targets;
8. increments record version;
9. stores current schema version and updated actor/timestamp;
10. atomically replaces normalized relation entries.

A stale version returns:

```text
RECORD_VERSION_CONFLICT
```

Phase 2.1 hardens this contract at the canonical storage write itself. SQLite update/delete statements include `record_version = expectedVersion` in their `WHERE` clause, so a stale writer cannot commit even if another process changes the record between reads. Record write transactions use short immediate write intent to avoid WAL read-to-write snapshot races while preserving optimistic caller semantics.

## 13. Soft delete

Delete is soft delete only.

A successful soft delete:

- increments record version;
- records `deletedAt`;
- stores optional deletion reason;
- records `deletedBy`;
- updates `updatedAt` and `updatedBy`;
- keeps the canonical row for explicit deleted-record reads and future audit/history.

Deleted records are hidden by normal get/list calls.

Normal update/delete calls cannot operate on an already deleted record.

Phase 1.8 also prevents soft deletion of a record while active inbound references still point to it. Deleting a source record removes its outgoing normalized relation entries in the same transaction.

Hard purge is not implemented.

## 14. Actor attribution

Phase 1.6 stores initial canonical actor attribution for record state:

```text
createdBy
updatedBy
deletedBy
```

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

Actor IDs use the same safe identifier rules as protocol actors.

This is attribution only. Authentication, permission enforcement, capability leases, and host-bound authorization remain later integration tasks.

## 15. Record versions

Every canonical record has an integer `version`.

```text
create       -> 1
update       -> 2
update       -> 3
soft delete  -> 4
```

Record version is distinct from entity `schemaVersion`.

The two numbers answer different questions:

```text
record version: how many canonical state transitions has this record had?
schema version: which entity definition was used for this stored payload?
```

## 15.1 Phase 2.1 atomic concurrency extension

The decisive version comparison now occurs in SQLite, not only in application code.

Storage mutations require both the candidate row and the caller's `expectedVersion`:

```text
updateRecord(record, expectedVersion)
softDeleteRecord(record, expectedVersion)
```

The SQL write matches `record_version = expectedVersion` and `deleted_at IS NULL`. If the row no longer matches, no canonical effect occurs.

Competing record writers use a short immediate transaction. This lets one writer acquire SQLite write intent, commit version N+1, and forces a later stale writer to observe the new version and return `RECORD_VERSION_CONFLICT`.

The full contract and multi-process race evidence are in `docs/OPTIMISTIC-CONCURRENCY-V0.1.md`.

## 16. Failure atomicity

Validation happens before record creation/update persistence.

Therefore:

- unknown fields do not create partial records;
- invalid field types do not create partial records;
- missing required fields do not create partial records;
- oversized records do not create partial records;
- stale expected versions do not write a new record version;
- invalid updates leave the previous canonical row unchanged;
- invalid reference targets do not create/update canonical records;
- record and normalized relation-index changes commit or roll back together.

SQLite constraints additionally protect JSON validity, schema-version foreign keys, actor kinds, and soft-delete metadata consistency.

## 17. Corruption behavior

Record reads fail closed when persisted canonical state is inconsistent.

Examples:

- malformed/non-object record JSON;
- invalid stored timestamps;
- invalid stored actor attribution;
- record payload that does not validate against its persisted schema version.

These conditions return `DATABASE_CORRUPT` from the record layer rather than presenting damaged state as valid.

## 18. Deliberately not implemented

Phase 1.6 does not implement:

- persistent idempotency keys/replay;
- mutation events;
- mutation receipts;
- bulk operations;
- backup/export/import;
- permissions/capability enforcement;
- AI-Verse OS extension installation;
- sibling-layer adapters.

Those remain separate tasks in the canonical Build Map.

## 19. Non-negotiable invariants

1. Records stay inside the trusted workspace database.
2. Record payloads must satisfy an entity schema before canonical write.
3. Record storage remains behind the storage-driver contract.
4. Agent-defined entities do not create arbitrary SQL tables.
5. Every persisted record remembers its exact schema version.
6. Normal reads hide soft-deleted records.
7. Deleted records remain canonical until an explicit future purge contract exists.
8. Actor attribution is stored with record state.
9. Record and schema versions remain distinct.
10. Reference integrity, bounded transactions, and race-safe optimistic concurrency are implemented; persistent idempotency, events, and receipts remain later tasks.
