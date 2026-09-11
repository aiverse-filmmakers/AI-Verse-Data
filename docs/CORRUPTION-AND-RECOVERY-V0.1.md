# Corruption and Recovery v0.1

**Task:** 17 / 41  
**Phase:** 2.8 - Corruption/recovery behavior  
**Status:** IMPLEMENTED  
**Public package surface:** `@ai-verse/data/recovery`

This document defines the first fail-closed corruption diagnosis, quarantine, and recovery-staging contract for AI-Verse Data.

## 1. Scope

Phase 2.8 implements:

- physical SQLite integrity detection;
- semantic AI-Verse Data integrity detection;
- durable corruption quarantine evidence;
- canonical write blocking after quarantine;
- no-silent-bootstrap protection for existing uninitialized files;
- read-only health/recovery inspection;
- distinct reporting for corruption, migration, scope, unsupported-format, and unrelated-SQLite states;
- verified recovery staging from Phase 2.5 backup/export artifacts;
- same-binding recovery enforcement;
- no-overwrite recovery staging;
- preservation of the original canonical database during diagnosis and staging.

Phase 2.8 does not implement automatic repair or in-place promotion over a corrupt canonical database.

## 2. Public surface

Package subpath:

```text
@ai-verse/data/recovery
```

Primary API:

```ts
const recovery = new DataRecovery(driver)

await recovery.inspect({ source })
await recovery.stageBackupRecovery({ source, artifactDirectory, destination })
await recovery.stagePortableRecovery({ source, artifactDirectory, destination })
```

The recovery API accepts trusted `DataDatabaseScope` values. It does not accept model-supplied SQL or arbitrary canonical database paths as its authority boundary.

## 3. Core recovery law

Corruption never means:

```text
"start again with an empty database"
```

If a canonical file already exists but no longer contains valid AI-Verse Data identity, normal `create-or-open` does not bootstrap it.

Only a genuinely nonexistent destination may bootstrap as new Data.

An existing zero-byte or uninitialized SQLite file is treated as existing unknown state and fails visibly.

## 4. Corruption categories

Task 17 distinguishes:

### Physical corruption

Examples:

- SQLite integrity check failure;
- SQLite cannot complete an integrity check;
- file bytes are not a usable SQLite database;
- consistent snapshot creation fails because the source is physically unreadable.

Physical corruption is recorded as:

```text
category: physical
code: DATABASE_CORRUPT
```

### Semantic corruption

Examples:

- invalid/incomplete AI-Verse Data metadata;
- SQLite identity signals disagree;
- foreign-key violations;
- entity schema history or schema digest mismatch;
- stored record invalid against its historical schema;
- normalized relation index mismatch;
- idempotency result digest/canonical JSON mismatch;
- provenance event/receipt digest or linkage mismatch;
- provenance scope conflict;
- committed event/idempotency evidence references a canonical record that is missing.

Semantic corruption is recorded as:

```text
category: semantic
code: DATABASE_CORRUPT
```

## 5. States that are not corruption

Recovery reporting keeps these states distinct:

```text
missing
unrecognized
unsupported
scope_conflict
migration_required
migration_incomplete
unavailable
```

Examples:

- a valid unrelated SQLite database is `unrecognized`, not corrupt;
- an older supported database that needs the Task 15 migration is `migration_required`;
- an interrupted Task 15 migration is `migration_incomplete`;
- a different trusted workspace binding is `scope_conflict`.

Task 17 does not relabel these as corruption or create a corruption quarantine for them.

## 6. Durable quarantine marker

Confirmed corruption creates an engine-owned sidecar marker next to the canonical database:

```text
<database-path>.quarantine.json
```

Marker format:

```text
ai-verse-data/quarantine-marker
version: 1
```

The marker records:

- corruption category;
- detection timestamp;
- `DATABASE_CORRUPT`;
- bounded diagnostic message;
- trusted database binding when known.

The marker does not contain canonical records and is not a second source of truth.

Its purpose is to persist the fact that canonical writes must remain blocked.

## 7. Quarantine tamper behavior

A quarantine marker is itself fail-closed evidence.

The engine validates:

- format/version;
- category;
- timestamp;
- code;
- bounded message;
- binding version;
- scope kind;
- safe workspace ID.

Malformed JSON, symlinked marker paths, invalid binding identity, or otherwise malformed marker state does not cause the marker to be ignored.

It produces `DATABASE_QUARANTINED`.

## 8. Write blocking

A quarantined database cannot be opened for normal use.

Quarantine is also rechecked at write boundaries on already-open handles.

The write guard covers:

- catalog initialization and writes;
- record initialization and writes;
- relation initialization/replacement/deletion;
- idempotency initialization/write;
- provenance initialization/append;
- database transactions;
- internal database migration execution.

Therefore corruption discovered after a handle was already opened still blocks new canonical mutations.

Read-only migration inspection remains permitted so recovery reporting can distinguish migration state without allowing migration to bypass quarantine.

## 9. Normal-open integrity ordering

For an existing canonical database, normal open now performs physical integrity verification before:

- first trusted binding of an older unbound database;
- WAL configuration;
- returning a normal writable handle.

This prevents normal open from writing trusted binding or WAL state into an existing physically corrupt database before detecting the corruption.

Brand-new nonexistent databases may still bootstrap normally.

## 10. Recovery inspection

`DataRecovery.inspect` is a diagnosis operation.

It:

1. resolves the trusted canonical path from the supplied scope;
2. reads quarantine evidence if present;
3. checks file existence/type/symlink safety;
4. opens the original database read-only;
5. runs bounded SQLite `integrity_check`;
6. runs `foreign_key_check`;
7. inspects internal migration state and trusted binding;
8. if current and physically readable, captures a consistent SQLite online-backup snapshot into temporary storage;
9. opens the temporary snapshot;
10. runs deep AI-Verse semantic verification through the same logical-state verification used by Phase 2.5 backup/export;
11. deletes the temporary inspection snapshot.

Deep verification therefore never initializes missing lazy tables or attempts repair inside the original canonical file.

Only the temporary copy may be opened through the normal engine for semantic verification.

## 11. Semantic consistency against committed evidence

Task 17 strengthens logical verification with one-way committed-record consistency.

Every committed record-targeted event must reference a record that still exists, including soft-deleted records.

Persisted idempotency results for:

```text
data.record.create
data.record.update
data.record.delete
data.transaction.execute
data.bulk.execute
```

must not reference canonical records that have disappeared.

This catches loss of record storage even if older event/idempotency evidence survives.

The rule is deliberately one-way for backward compatibility: records may legitimately predate the provenance subsystem, so not every record is required to have a historical event.

## 12. Recovery report

A recovery report contains:

- state;
- writable flag;
- check timestamp;
- trusted binding when known;
- database format version when known;
- Task 15 migration status when known;
- quarantine evidence;
- corruption category/code/message;
- verified logical state summary when available.

`writable` is true only for `healthy`.

A quarantined database remains quarantined even if later read-only checks can still read its contents.

## 13. Quarantine versus migration

Migration is not a recovery bypass.

If quarantine exists:

- `inspectMigration` may read the migration state;
- `migrate` fails with `DATABASE_QUARANTINED`;
- normal open fails with `DATABASE_QUARANTINED`.

A database that only requires migration and has no corruption quarantine remains `migration_required` or `migration_incomplete` and does not receive a corruption marker.

## 14. Recovery staging

Task 17 recovery never overwrites the canonical source.

A recovery source is an already-created Phase 2.5 artifact:

```text
sqlite-backup
portable-export
```

The artifact is fully verified before recovery staging.

The recovery destination must:

- be represented by a trusted `DataDatabaseScope`;
- have exactly the same binding as the canonical source;
- resolve to a different physical database path;
- not already contain a canonical destination database.

The existing backup/import machinery then installs and verifies the artifact at that alternate location.

## 15. Same-binding rule

Recovery cannot remap ownership.

These must match exactly:

```text
bindingVersion
kind
workspaceId
```

A backup/export from workspace `sales` cannot be staged as workspace `other`.

Using another trusted root for the same workspace binding is allowed for staging, because the canonical ownership identity is preserved while the physical path remains distinct.

## 16. Staged-candidate verification

After restore/import, Task 17 runs `DataRecovery.inspect` against the staged destination.

The staged destination must report:

```text
healthy
```

or staging fails with `RECOVERY_DESTINATION_UNHEALTHY`.

The result includes:

- artifact kind/id;
- source recovery report;
- staged destination recovery report;
- Phase 2.5 transfer receipt;
- explicit promotion state.

## 17. No automatic promotion

Task 17 intentionally returns:

```text
promotion: manual-explicit-not-implemented
```

It does not:

- rename the corrupt canonical file;
- delete it;
- truncate it;
- replace it;
- clear quarantine;
- swap the staged database into the canonical path.

A future destructive promotion contract would need separate explicit design, backup/evidence preservation, atomic filesystem semantics, and acceptance tests.

It is not silently introduced here.

## 18. Original-source preservation

Diagnosis never repairs the canonical file.

Staged recovery does not modify the corrupt canonical file.

Tests verify that after staging from a known good artifact:

- the deliberately corrupted canonical provenance value remains corrupted;
- the quarantine marker remains;
- the staged alternate database is healthy and contains the expected canonical Data.

This makes recovery evidence inspectable rather than destructive.

## 19. No silent empty replacement

The Task 17 storage rule is:

```text
path does not exist
  -> creation may bootstrap

path exists but is not initialized AI-Verse Data
  -> fail visibly
  -> never bootstrap over it
```

This includes an existing zero-byte file.

The engine preserves the original bytes.

## 20. Error surfaces

Storage adds:

```text
DATABASE_QUARANTINED
```

Recovery-specific errors:

```text
RECOVERY_BINDING_CONFLICT
RECOVERY_DESTINATION_CONFLICT
RECOVERY_DESTINATION_UNHEALTHY
DATABASE_UNAVAILABLE
```

Existing backup/storage errors remain authoritative for artifact validation, destination collision, migration state, scope conflict, and unsupported formats.

## 21. Deliberate non-features

Task 17 does not implement:

- automatic SQLite repair;
- automatic semantic repair;
- deletion/truncation of a corrupt canonical database;
- in-place restore over an existing canonical path;
- automatic staged-candidate promotion;
- cross-workspace recovery;
- quarantine clearing;
- arbitrary salvage SQL;
- Task 18 Phase 2 integration gate;
- sibling-repository changes.

## 22. Acceptance

Task 17 acceptance requires proof that:

- an existing empty file is never silently initialized;
- healthy Data reports writable health and a semantic summary;
- physical corruption is quarantined without replacing original bytes;
- semantic corruption creates durable quarantine;
- quarantine blocks writes on already-open handles;
- corruption detected during normal open persists quarantine;
- malformed quarantine evidence fails closed;
- lost canonical record storage is detected from surviving committed evidence;
- unrelated valid SQLite remains unrecognized rather than corrupt;
- migration-required state remains distinct from corruption;
- migration-incomplete state remains distinct from corruption;
- read-only migration inspection works while quarantined;
- migration execution cannot bypass quarantine;
- verified backup can stage a healthy same-binding recovery;
- verified portable export can stage a healthy same-binding recovery;
- staged recovery rejects cross-workspace remapping;
- staged recovery rejects the same canonical physical path;
- original corrupt canonical state remains unchanged after staging;
- Node 22 and Node 24 pass the complete repository suite.

Behavioral verification:

```text
GitHub Actions run: 34598198275
Behavioral commit:   1ff0e683603ae4a6da9967a0f2bbc199b526c119
Node 22:             PASS
Node 24:             PASS
Tests:               199 / 199 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```
