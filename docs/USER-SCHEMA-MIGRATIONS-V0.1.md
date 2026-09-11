# User-Schema Migrations v0.1

**Task:** 16 / 41  
**Phase:** 2.7 - User-schema migration framework  
**Status:** IMPLEMENTED  
**Public package surface:** `@ai-verse/data/schema-migrations`

This document defines the first governed migration system for user-owned entity schemas and their active canonical records.

## 1. Scope

Phase 2.7 implements review-before-commit migrations for logical entity schemas.

It covers:

- migration preview;
- deterministic preview digests;
- required-field backfills;
- remove/replace/rename field migrations;
- explicit constant/set-if-missing backfills;
- destructive-change approval metadata;
- bounded active-record rewrites;
- optimistic schema-version gating;
- atomic schema + record + relation + idempotency + provenance commit;
- idempotent retry/replay;
- migration owner/executor/approval provenance.

It does not implement corruption repair, automatic recovery, arbitrary SQL, unbounded migrations, or cross-workspace schema changes.

Those remain separate concerns.

## 2. Public surfaces

Package subpath:

```text
@ai-verse/data/schema-migrations
```

Primary API:

```ts
const migrations = new DataSchemaMigrations(database)

migrations.preview(...)
migrations.execute(...)
migrations.executeWithReceipt(...)
```

Protocol operations:

```text
data.schema.migration.preview
data.schema.migration.execute
```

These are structured operations. Neither accepts SQL, table names, or database paths.

## 3. Distinct from internal database-format migration

Task 15 owns internal SQLite database-format migrations.

Task 16 owns logical user entity-schema migrations.

These version domains stay separate:

```text
SQLite database format version
  !=
entity schema version
```

Executing a user-schema migration does not change SQLite `user_version` or AI-Verse Data's database format version.

## 4. Migration input

A migration proposal contains:

```text
spaceId
entity
expectedSchemaVersion
changes[]
backfills[]?
owner
reason?
```

Execution additionally requires:

```text
idempotencyKey
expectedPreviewDigest
approval?   # required for destructive migrations
```

Supported schema changes reuse the existing schema-change grammar:

```text
add_field
remove_field
replace_field
rename_field
set_name
set_description
```

Metadata-only changes do not belong to this migration path. They remain normal `data.schema.update` operations.

## 5. Backfill grammar

Phase 2.7 deliberately supports a small deterministic backfill language:

```text
set_if_missing
set
```

Example:

```json
{
  "field": "owner",
  "mode": "set_if_missing",
  "value": "unassigned"
}
```

`set_if_missing` writes the value only when the transformed record does not contain the field.

`set` overwrites that field for every active record and is classified as destructive.

The value must already be valid JSON and must satisfy the proposed schema after all transformations/defaults are applied.

No model-generated expression language, JavaScript, or SQL is executed.

## 6. Preview contract

Preview is read-only.

It executes inside one SQLite read transaction so every query sees one consistent committed snapshot.

Preview:

1. verifies the current schema matches `expectedSchemaVersion`;
2. applies the proposed schema changes in memory;
3. validates the proposed complete entity schema;
4. validates every backfill target;
5. scans every active record within the migration ceilings;
6. validates each stored record against its historical schema;
7. applies structural transforms and backfills;
8. applies declared schema defaults;
9. validates the transformed record against the proposed schema;
10. recomputes reference relations against current canonical targets;
11. builds a deterministic SHA-256 preview digest.

Preview returns:

- from/to schema version;
- from/to schema digest;
- active-record count;
- rewritten-record count;
- source bytes scanned;
- rewritten bytes;
- destructive/approval flags;
- owner;
- change/backfill counts;
- preview digest.

Preview commits no schema version, record, relation, idempotency, event, receipt, or sequence changes.

## 7. Preview digest

The digest binds:

- preview format version;
- executor actor;
- migration owner;
- Data Space/entity;
- expected schema version;
- ordered schema changes;
- ordered backfills;
- migration reason when supplied;
- current and proposed schema versions/digests;
- destructive classification;
- every active record ID;
- every active record version;
- every active record historical schema version;
- before/after record data digests;
- resulting reference-relation digest.

Therefore a reviewed preview becomes stale if relevant canonical schema or active record state changes before execution.

Execution recomputes the plan inside an immediate write transaction and requires exact digest equality.

Mismatch returns:

```text
SCHEMA_MIGRATION_STALE
```

## 8. Atomic ceilings

Phase 2.7 uses one short atomic migration transaction and therefore enforces:

```text
max active records: 500
max source record state: 8 MiB
max rewritten record state: 8 MiB
```

A migration beyond those ceilings returns:

```text
SCHEMA_MIGRATION_LIMIT_EXCEEDED
```

It does not silently fall back to partial batches.

A future checkpointed large-migration design can be added deliberately.

## 9. Schema-version concurrency

Every migration is bound to:

```text
expectedSchemaVersion
```

If the entity schema has advanced, the migration cannot apply over it.

The engine returns the existing schema-version conflict instead of last-write-wins behavior.

The new schema version is always exactly the next immutable version.

Historical schema versions remain intact.

## 10. Record migration semantics

Every active record is migrated onto the new schema version.

For each active record the engine:

- validates the old row against its persisted historical schema;
- applies remove/rename transforms;
- applies explicit backfills;
- applies schema defaults;
- validates against the proposed schema;
- validates all reference targets;
- increments the record version exactly once;
- sets the new schema version;
- records the trusted executor as `updatedBy`;
- replaces the normalized outgoing relation index;
- emits normal immutable record-update provenance.

Soft-deleted records are not rewritten.

They remain historical records bound to the schema version that was canonical when they were deleted.

## 11. Destructive approval

A migration is classified as destructive when it contains any of:

```text
remove_field
replace_field
rename_field
backfill mode: set
```

Destructive execution requires explicit approval metadata:

```text
approvalRef
approvedBy
approvedAt
reason?
```

Missing approval returns:

```text
APPROVAL_REQUIRED
```

The Data engine validates the approval shape and persists it as provenance metadata.

Authentication/organizational policy for who is allowed to approve remains the trusted host's responsibility.

## 12. Owner and executor provenance

Migration input includes a structured `owner`.

Execution separately receives the trusted executor actor.

The migration provenance therefore distinguishes:

- migration owner;
- executor;
- approver where required.

This is metadata about the schema migration, not a human-authentication system.

## 13. Provenance model

Task 16 deliberately reuses the existing immutable provenance system rather than creating a second canonical migration-event database.

Each rewritten active record emits one normal:

```text
record.updated
```

event + receipt with details including:

- schema migration marker;
- migration ID;
- migration owner;
- from/to schema version;
- from/to schema digest;
- preview digest.

The entire migration also emits one existing:

```text
transaction.committed
```

event + receipt.

Its details identify the requested semantic operation as:

```text
data.schema.migration.execute
```

and preserve:

- migration ID;
- Data Space/entity;
- schema versions/digests;
- owner;
- preview digest;
- destructive flag;
- approval metadata;
- child event/receipt IDs;
- operation count.

This preserves the existing append-only event/receipt integrity model and keeps Phase 2.5 backup/export compatibility intact.

## 14. Idempotency

Execution is retry-safe.

The outer idempotency key is bound to the full migration execution request through the existing transaction idempotency boundary.

A matching retry returns the original migration result and original transaction receipt.

It does not:

- create another schema version;
- rewrite records twice;
- advance record versions twice;
- duplicate relation writes;
- duplicate events/receipts.

Each internal record rewrite also receives a deterministic migration-scoped internal idempotency key so every emitted record event remains backed by durable idempotency state.

## 15. Atomicity

Execution occurs inside one immediate SQLite transaction.

The atomic commit includes:

- current schema pointer update;
- immutable new schema version;
- every active record rewrite;
- every relation-index replacement;
- internal child idempotency entries;
- child record events/receipts;
- outer transaction event/receipt;
- outer idempotency result.

Any required failure rolls the whole migration back.

Tests deliberately force provenance insertion to fail after schema/record work begins and verify the original schema, record versions, idempotency state, and audit sequence remain unchanged.

## 16. Reference migrations

Reference definitions are validated against the proposed schema.

Every transformed reference is checked against the proposed target Data Space/entity.

The normalized relation index is rebuilt from transformed canonical record data.

Changing a reference target fails preview if existing values do not exist in the new target.

An explicit destructive `set` backfill may replace those values with a valid target, subject to approval.

## 17. Narrowing and replacement

A replacement field must be valid for every active record after structural transforms/backfills/defaults.

Examples that fail preview without a suitable explicit rewrite:

- enum value removal when current records use removed values;
- number to string replacement for numeric records;
- tighter numeric/string bounds violated by current values;
- reference target changes whose current IDs do not exist there;
- making a previously optional field required when records are missing it.

No invalid record is skipped.

## 18. Failure codes

Task 16 adds protocol-level migration errors:

```text
SCHEMA_MIGRATION_INVALID
SCHEMA_MIGRATION_STALE
SCHEMA_MIGRATION_LIMIT_EXCEEDED
```

Existing errors also apply:

```text
SCHEMA_VERSION_CONFLICT
APPROVAL_REQUIRED
IDEMPOTENCY_CONFLICT
REFERENCE_INVALID
DATABASE_CORRUPT
```

The direct `DataSchemaMigrations` surface exposes `DataSchemaMigrationError` for migration-specific failures.

## 19. Deliberate non-features

Phase 2.7 does not implement:

- arbitrary SQL migrations;
- arbitrary code/expression backfills;
- cross-workspace migrations;
- migrations larger than the atomic ceilings;
- automatic migration based on model suggestion;
- hard-deleted record recovery;
- corruption repair;
- Task 17 recovery behavior;
- sibling-repository changes.

## 20. Acceptance

Task 16 acceptance requires proof that:

- protocol recognizes preview/execute migration operations;
- required-field migration can backfill active records;
- new immutable schema version is created exactly once;
- active records advance schema + record version exactly once;
- deleted records remain historical;
- matching retry replays one committed migration;
- destructive rename requires approval and preserves value;
- invalid narrowing fails preview;
- explicit destructive backfill can make narrowing valid;
- reference target migration validates/rebuilds relation indexes;
- record drift makes a reviewed preview stale;
- more than 500 active records is rejected;
- source and rewritten byte ceilings are enforced;
- preview uses a consistent SQLite read transaction;
- forced mid-commit provenance failure rolls everything back;
- migration provenance records owner/executor/schema metadata;
- rewritten-state expansion beyond 8 MiB is rejected before mutation;
- migration idempotency and provenance survive verified portable export/import and replay exactly after import;
- Node 22 and Node 24 pass the complete repository suite.

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
