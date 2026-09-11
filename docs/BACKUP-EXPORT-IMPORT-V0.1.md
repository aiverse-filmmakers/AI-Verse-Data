# Backup, Export, Import, and Restore Contract v0.1

**Task:** 14 / 41  
**Phase:** 2.5 - Backup/export/import foundation  
**Status:** IMPLEMENTED  
**Public package surface:** `@ai-verse/data/backup`

This document defines the first reliability contract for making verified copies of canonical AI-Verse Data and restoring/importing them without weakening workspace ownership or silently replacing existing Data.

## 1. Scope

Phase 2.5 implements four operator-side capabilities:

1. consistent SQLite backup;
2. backup verification and restore;
3. verified portable logical export;
4. portable import into an empty canonical destination.

It does not implement database-format migration, user-schema migration, merge/import into an existing database, cross-workspace remapping, corruption repair, or normal agent/App protocol operations.

Those remain later tasks.

## 2. Public surface

The package exports:

```text
@ai-verse/data/backup
```

The primary API is `DataBackup`.

Supported operations:

```text
createBackup
verifyBackup
restoreBackup

createPortableExport
verifyPortableExport
importPortableExport
```

Backup/export creation accepts an already trusted `ScopedDatabaseHandle`.

Restore/import accepts a trusted `DataDatabaseScope`.

Normal restore/import APIs do not accept a raw canonical database path.

## 3. Two artifact kinds

Phase 2.5 deliberately keeps physical backup and portable logical export separate.

### 3.1 SQLite backup

Artifact kind:

```text
sqlite-backup
```

Directory layout:

```text
<artifact-directory>/
  database.sqlite
  manifest.json
  receipt.json
```

`database.sqlite` is created through SQLite's online backup API from the open canonical database. A valid backup is therefore a complete SQLite database, not a copy of only the WAL-mode main file.

### 3.2 Portable export

Artifact kind:

```text
portable-export
```

Directory layout:

```text
<artifact-directory>/
  export.json
  manifest.json
  receipt.json
```

Before logical state is read, Data first creates a consistent online SQLite snapshot. The portable state is collected from that snapshot rather than by walking a live changing database.

The v0.1 portable payload is deterministic canonical JSON.

## 4. Artifact identity and metadata

Manifest format:

```text
ai-verse-data/artifact-manifest
formatVersion: 1
```

Receipt format:

```text
ai-verse-data/artifact-receipt
formatVersion: 1
```

The manifest records:

- artifact kind and artifact ID;
- creation time;
- source database format/version/driver;
- original database creation time;
- trusted source binding;
- fixed payload filename and media type;
- payload byte length;
- SHA-256 payload digest;
- deterministic logical-state SHA-256;
- logical-state counts.

The receipt binds:

- receipt ID;
- artifact ID;
- artifact kind;
- completion time;
- SHA-256 of the exact manifest bytes;
- payload SHA-256;
- logical-state digest;
- source binding.

A file, manifest, or receipt mismatch fails closed.

## 5. Portable state coverage

Portable state version 1 preserves the reliability state required for exact replay and audit continuity:

- Data Spaces;
- every immutable entity-schema version;
- active records;
- soft-deleted record tombstones;
- record versions and exact schema-version attribution;
- actor/timestamp deletion metadata;
- normalized relation-index rows;
- durable idempotency entries;
- canonical replay-result JSON and digests;
- immutable Data events;
- durable mutation receipts;
- event sequence numbers;
- event/receipt digests and linkage;
- current trusted database binding.

A portable import is not considered successful merely because rows can be inserted. The imported database is recollected and its deterministic state digest must exactly match the exported state digest.

## 6. Integrity verification

Artifact verification includes multiple independent checks.

### File-level

- artifact directory must exist and must not be a symlink;
- manifest, receipt, and payload must be regular non-symlink files;
- manifest/receipt formats and versions must be supported;
- fixed payload name and media type must match the artifact kind;
- recorded payload size must match;
- recorded SHA-256 must match;
- receipt must match the manifest and payload.

### Database-level

SQLite backup verification is performed on a temporary copy so verification does not modify the backup artifact.

The copied database must:

- open as the current AI-Verse Data SQLite format;
- match the recorded trusted binding;
- pass SQLite integrity checking;
- pass the logical-state validator;
- reproduce the manifest state summary and digest.

### Logical-state level

The validator reuses existing engine guarantees:

- schema definitions and schema digests are revalidated;
- schema history must be contiguous;
- every record must validate against its persisted historical schema version;
- relation-index rows must match active canonical references;
- deleted records must not retain outgoing relation-index rows;
- idempotency result digests and canonical JSON are verified;
- event digests are verified;
- receipt digests are verified;
- event/receipt linkage is verified;
- provenance scopes must either represent legitimate pre-binding `unbound` history or match the current trusted database binding;
- every provenance idempotency key must still exist in durable idempotency state.

## 7. Consistency law

A backup or portable export must represent one consistent committed database state.

Physical backup uses SQLite's online backup API.

Portable export first creates the same type of online SQLite snapshot and then exports from that closed-world snapshot.

Phase 2.5 never defines "copy the live main `.sqlite` file" as a valid backup procedure for a WAL-mode canonical database.

## 8. Destination safety

Restore/import never silently overwrites canonical Data.

Before installation:

1. the artifact is fully verified;
2. the artifact binding must match the trusted destination binding;
3. the canonical destination database must not exist.

Materialization happens in a staging database in the destination directory.

The staging database is then sealed through SQLite's online backup API into a self-contained SQLite file.

Installation uses an atomic same-directory hard-link create. If the canonical destination appears first, installation fails instead of replacing it.

After installation, the canonical database is reopened with the expected binding and its logical-state digest is verified again.

If this post-install verification fails, only the newly created destination is removed.

## 9. Workspace ownership

v0.1 restore/import preserves binding identity exactly.

An artifact created for:

```text
kind: workspace
workspaceId: sales
```

may be restored/imported under another trusted root or machine only when the destination scope is also the `sales` workspace binding.

It is not silently rebound to another workspace.

Cross-workspace remapping is not part of Phase 2.5.

Historical provenance that was legitimately committed while a database was still `unbound` remains historical `unbound` provenance after the database is later bound. It is preserved rather than rewritten.

## 10. No-overwrite rules

The following are hard failures:

- artifact destination directory already exists;
- low-level SQLite backup destination cannot be atomically reserved;
- canonical restore/import destination already exists;
- canonical destination appears during installation.

The low-level SQLite backup primitive atomically reserves its destination with exclusive creation before SQLite is allowed to write it.

## 11. Error contract

Backup/portability errors use `DataBackupError`.

Stable Phase 2.5 codes:

```text
ARTIFACT_ALREADY_EXISTS
ARTIFACT_NOT_FOUND
ARTIFACT_INVALID
ARTIFACT_FORMAT_UNSUPPORTED
ARTIFACT_DIGEST_MISMATCH
ARTIFACT_SCOPE_CONFLICT
DESTINATION_ALREADY_EXISTS
DATABASE_CORRUPT
DATABASE_UNAVAILABLE
```

Errors fail closed. There is no automatic "repair and continue" mode.

## 12. Deliberate non-features

Phase 2.5 does not add:

- database-format migrations;
- user-schema migrations or backfills;
- import into an existing canonical database;
- merge semantics;
- overwrite restore;
- cross-workspace identity remapping;
- partial restore;
- arbitrary SQL;
- raw canonical database paths in normal agent/App APIs;
- a background backup scheduler;
- cloud upload/storage;
- encryption/key management;
- corruption repair;
- sibling-repository modifications.

Task 15 / Phase 2.6 owns the internal migration framework.

## 13. Acceptance

Task 14 acceptance requires:

- Node 22 PASS;
- Node 24 PASS;
- exact backup/restore state equality;
- portable export/import state equality;
- schema-history preservation;
- soft-delete preservation;
- relation-index preservation;
- idempotent record replay after restore/import;
- bulk replay after restore/import;
- event/receipt preservation;
- tampered backup rejection;
- tampered portable export rejection;
- workspace-binding conflict rejection;
- existing canonical destination rejection;
- existing artifact destination rejection;
- valid pre-binding provenance preservation;
- low-level no-overwrite proof.

The current behavioral test suite contains 162 tests after the final Task 14 hardening additions. The exact final run is recorded in `docs/PHASE-2-STATUS.md` and the continuation handoff once closeout CI passes.
