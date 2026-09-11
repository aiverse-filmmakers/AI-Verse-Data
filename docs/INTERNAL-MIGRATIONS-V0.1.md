# Internal Database Migrations v0.1

**Task:** 15 / 41  
**Phase:** 2.6 - Internal migration framework  
**Status:** IMPLEMENTED  
**Storage surface:** `@ai-verse/data/storage`

This document defines the first engine-owned migration system for the canonical AI-Verse Data SQLite format.

## 1. Scope

Phase 2.6 implements explicit migrations for the internal database format only.

It covers:

1. database-format compatibility inspection;
2. explicit migration execution;
3. an engine-owned migration ledger;
4. interruption and failed-attempt detection;
5. retry/resume rules for transactional migrations;
6. verified pre-migration backup evidence;
7. preservation of canonical workspace binding and user data.

It does not implement user entity-schema migration, field backfills, destructive schema changes, corruption repair, or automatic migration during ordinary database open.

Those remain later tasks.

## 2. Format version

Task 15 advances the canonical SQLite database format from version 1 to version 2.

Current identity:

```text
format:          ai-verse-data/sqlite
format version:  2
application_id:  0x41495644 (AIVD)
user_version:    2
```

Format v2 adds:

- `migration_framework_version = 1` in `_aiverse_meta`;
- the engine-owned `_schema_migrations` ledger;
- explicit migration compatibility and execution behavior.

A new database is bootstrapped directly as format v2 and starts with an empty migration ledger.

## 3. Internal migration ledger

Format v2 contains:

```text
_schema_migrations
```

Each migration row records:

- stable migration ID;
- deterministic migration-definition SHA-256;
- from/to format versions;
- lifecycle state;
- attempt number;
- pre-migration backup artifact ID;
- backup payload SHA-256;
- backup manifest SHA-256;
- started timestamp;
- completed timestamp;
- failed timestamp;
- bounded failure message.

Supported lifecycle states:

```text
in_progress
failed
completed
```

The ledger is engine metadata. It is not a user Data Space, not Memory, and not a user entity-schema migration log.

## 4. First migration

The first registered migration is:

```text
sqlite-0001-v1-to-v2
```

It advances database format 1 to format 2 and installs migration-framework metadata.

The migration definition has a deterministic digest. A stored ledger row whose ID/version/digest no longer matches the installed migration definition fails closed as incomplete migration state.

## 5. Normal open never auto-migrates

Ordinary `DataStorageDriver.open(...)` does not run migrations.

A format v1 database returns:

```text
DATABASE_MIGRATION_REQUIRED
```

when no incomplete attempt exists.

A database with durable unfinished/failed migration state returns:

```text
DATABASE_MIGRATION_INCOMPLETE
```

Unsupported newer formats continue to return:

```text
DATABASE_VERSION_UNSUPPORTED
```

This keeps a normal application/agent open from silently changing canonical storage.

## 6. Explicit migration operations

The storage driver now exposes:

```text
inspectMigration(...)
migrate(...)
verifyMigrationBackup(...)
```

These are storage/operator capabilities. They are not public Data protocol operations and do not grant agents arbitrary SQL authority.

`inspectMigration` reports:

- current format version;
- target format version;
- trusted binding if present;
- required migration IDs;
- incomplete migration IDs;
- one of `current`, `required`, or `incomplete`.

`migrate` is explicit and requires a caller-selected pre-migration backup artifact directory whenever migration work is required.

Calling `migrate` on an already-current healthy database is a no-op and creates no backup artifact.

## 7. Pre-migration backup law

A migration that changes format must create and verify a consistent backup before canonical migration state is written.

The migration system reuses the same shared SQLite online-backup primitive introduced by Phase 2.5.

It does not copy the live WAL-mode main file directly.

Migration backup layout:

```text
<artifact-directory>/
  database.sqlite
  manifest.json
  receipt.json
```

Manifest format:

```text
ai-verse-data/migration-backup-manifest
formatVersion: 1
```

Receipt format:

```text
ai-verse-data/migration-backup-receipt
formatVersion: 1
```

The artifact records:

- source database format/version;
- source database creation timestamp;
- source binding, including unbound;
- target format version;
- payload byte count;
- payload SHA-256;
- exact manifest SHA-256.

Verification also opens the backup read-only, runs SQLite integrity checking, and verifies AI-Verse Data identity signals.

An existing backup directory is never overwritten.

## 8. Transaction and interruption semantics

For each migration attempt:

1. verified pre-migration backup is created first;
2. an `in_progress` ledger row is committed;
3. migration work runs in an SQLite immediate transaction;
4. format metadata, SQLite `user_version`, migration changes, and ledger completion commit atomically.

For the supported migration path, SQLite transactional DDL/state is required.

If the process stops after step 2 but before step 4, the database remains at its old format with an `in_progress` ledger row.

Normal open is blocked.

A later explicit `migrate` call may resume the same known migration definition. A fresh verified backup is created for the retry and the attempt counter increments.

## 9. Failure behavior

If a migration transaction throws:

- the migration transaction rolls back;
- the old format version remains canonical;
- the migration row becomes `failed` when that failure state can be durably written;
- normal open is blocked;
- explicit retry is permitted only through the installed known migration path.

A current-format database that somehow contains incomplete migration state is not treated as an older migration that can be replayed. It fails closed with `DATABASE_MIGRATION_INCOMPLETE`.

If final post-migration SQLite integrity verification fails, the last migration row is changed to failed/incomplete state when possible so future normal open is blocked.

## 10. Binding preservation

Migration does not change:

- scope binding version;
- scope kind;
- workspace ID;
- database creation timestamp;
- canonical records;
- record versions;
- Data Space/entity identities;
- idempotency results;
- provenance events/receipts.

A conflicting caller-supplied expected binding is rejected before backup creation or migration execution.

An unbound legacy database remains unbound through migration and may be bound later through the existing one-time scoped-open rule.

## 11. Error contract

Task 15 adds these storage error codes:

```text
DATABASE_MIGRATION_REQUIRED
DATABASE_MIGRATION_INCOMPLETE
DATABASE_MIGRATION_FAILED
MIGRATION_BACKUP_INVALID
MIGRATION_BACKUP_EXISTS
```

Existing format/scope/corruption errors continue to apply where appropriate.

## 12. Deliberate non-features

Phase 2.6 does not implement:

- automatic migration during normal open;
- downgrade migrations;
- migration of unsupported newer database formats;
- user entity-schema migration/backfills;
- arbitrary model-generated SQL migrations;
- corruption repair;
- merge/import of old backups into live Data;
- cross-workspace rebinding;
- sibling-repository changes.

Task 16 / Phase 2.7 owns user-schema migration behavior.

Task 17 / Phase 2.8 owns corruption/recovery behavior.

## 13. Acceptance

Task 15 acceptance requires:

- fresh databases bootstrap directly at format v2;
- migration ledger exists and is empty on a fresh database;
- format v1 is detected as migration-required;
- normal open never auto-migrates;
- v1 to v2 explicit migration succeeds;
- verified pre-migration backup is created before migration state changes;
- backup source remains format v1;
- records, idempotent replay, provenance, and workspace binding survive migration;
- conflicting workspace migration is rejected before backup;
- tampered migration backup fails verification;
- failed migration remains format v1 and becomes durable incomplete state;
- failed migration can be retried safely after the blocking cause is removed;
- simulated interrupted `in_progress` state blocks open and resumes explicitly;
- existing backup destinations are never overwritten;
- already-current migrate is a no-op;
- current-format incomplete state fails closed;
- newer formats remain unsupported;
- Node 22 and Node 24 both pass the complete repository suite.

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
