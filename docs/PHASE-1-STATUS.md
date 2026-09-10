# AI-Verse Data Phase 1 Status

**Updated:** 2026-09-10  
**Phase:** 1 - Core Data Engine  
**Phase status:** IN PROGRESS  
**Implementation tasks completed:** 7 / 9  
**Overall implementation tasks completed:** 7 / 41  
**Next:** Task 8 / 41, Phase 1.8 - Relations + bounded transactions

This document records concrete implementation evidence for Phase 1. `docs/BUILD-MAP.md` remains the canonical project-wide task order.

## Task 1 / 41 - Phase 1.1 Repository/package foundation

**Status:** COMPLETE

Implemented Node.js 22+ package metadata, TypeScript strict compilation, ESM exports, CLI help/version, explicit unsupported-input failure, Node test harness, source/test layout, build/check scripts, `.gitignore`, and GitHub Actions CI on Node 22/24.

Verification:

```text
5 / 5 tests passed
Node 22 PASS
Node 24 PASS
```

**Task 1.1 gate: PASSED.**

---

## Task 2 / 41 - Phase 1.2 Protocol types and validators

**Status:** COMPLETE

Implemented the storage-neutral `ai-verse-data/0.1` protocol, discriminated operation envelopes, response/error envelopes, actor/scope/authorization types, Data Space/schema/record/query/aggregate/transaction types, first-release field types, runtime validators, strict unknown-field rejection, safe logical identifiers, and hard request/query/schema/transaction ceilings.

Security proof includes explicit rejection of raw SQL and database-path extras from normal public protocol requests.

Verification:

```text
18 / 18 tests passed
Node 22 PASS
Node 24 PASS
```

**Task 1.2 gate: PASSED.**

---

## Task 3 / 41 - Phase 1.3 Storage-driver contract + SQLite bootstrap

**Status:** COMPLETE

### Implemented

Public/internal storage surface:

```text
@ai-verse/data/storage
```

Storage-driver contract:

- `DataStorageDriver`;
- `DataStorageDatabase`;
- `StorageOpenOptions`;
- storage metadata;
- diagnostics;
- integrity results;
- stable storage error codes.

SQLite implementation:

- `SqliteStorageDriver`;
- `better-sqlite3` 13.0.3 behind the driver boundary;
- create-or-open mode;
- open-existing mode;
- explicit close behavior;
- idempotent close;
- `_aiverse_meta` internal table;
- database format string/version;
- SQLite `application_id` identity;
- SQLite `user_version` identity;
- creation timestamp persistence;
- SQLite runtime version check;
- minimum SQLite version 3.37.0;
- `STRICT` metadata table;
- `WITHOUT ROWID` metadata table;
- foreign-key enforcement;
- WAL mode;
- `synchronous=NORMAL`;
- 5-second busy timeout;
- integrity checking;
- driver diagnostics.

### Database identity

Format v1 currently uses:

```text
format:          ai-verse-data/sqlite
formatVersion:   1
application_id:  0x41495644  (AIVD)
user_version:    1
```

These remain distinct from package/protocol/entity-schema versions.

Detailed storage contract: `docs/STORAGE-V0.1.md`.

### Fail-closed behavior

The driver refuses to silently adopt an unrelated SQLite file.

It also fails visibly when:

- `open-existing` points to a missing database;
- an existing database is not initialized as AI-Verse Data;
- stored AI-Verse Data format is newer/unsupported;
- SQLite identity metadata conflicts;
- SQLite runtime is too old;
- a closed handle is used again.

The driver does not silently repair identity or rewrite unknown databases.

### Verification evidence

Final implementation CI:

```text
GitHub Actions run: 34509888259
Node 22:             PASS
Node 24:             PASS
Tests:               25 / 25 PASS
Failures:            0
```

The 25-test suite includes the 18 prior package/protocol tests plus 7 storage tests proving:

1. creation of a real AI-Verse Data SQLite database;
2. stable metadata across close/reopen;
3. WAL mode and foreign-key enforcement;
4. STRICT metadata storage;
5. healthy `PRAGMA integrity_check` behavior;
6. clear missing-database failure for `open-existing`;
7. rejection of unrelated existing SQLite databases;
8. rejection of unsupported newer format versions;
9. rejection of conflicting application identity;
10. explicit closed-handle failure.

### Build issue found and fixed during the task

The first strict TypeScript build rejected a redundant redeclaration of `Error.cause`. The implementation was corrected to use the native `Error` cause mechanism. Final Node 22 and Node 24 CI is green.

### Deliberately not implemented

Task 1.3 does **not** implement:

- trusted OS/workspace path resolution;
- workspace/database binding;
- Data Spaces;
- entity-schema persistence;
- records;
- CRUD;
- query execution;
- relations;
- OS extension registration;
- sibling-layer integrations.

Those remain later tasks and are not hidden inside the SQLite driver.

### Task 1.3 gate

**PASSED.**

Acceptance requirements are satisfied:

- create database succeeds;
- reopen succeeds;
- metadata survives restart/reopen;
- unsupported format fails closed;
- integrity checking works;
- SQLite remains behind a storage-driver abstraction;
- public protocol remains SQLite-neutral;
- no Data Space/schema/record CRUD was implemented early.

---

## Task 4 / 41 - Phase 1.4 Scope and database identity

**Status:** COMPLETE

### Implemented

Public scope surface:

```text
@ai-verse/data/scope
```

Scope foundation:

- `TrustedDataRoot.fromExistingDirectory(...)`;
- canonical real-path normalization;
- root existence/directory validation;
- root revalidation before derived path resolution;
- `createWorkspaceDataScope(...)`;
- `createStandaloneDataScope(...)`;
- `openScopedDataDatabase(...)`;
- safe known-segment path derivation;
- cross-platform filesystem-safe workspace ID validation;
- existing child symbolic-link rejection;
- no raw database path in normal scoped open calls.

Database binding:

```text
bindingVersion = 1
kind           = standalone | workspace
workspaceId    = logical workspace identity
```

SQLite persists those values in `_aiverse_meta`. Absolute root paths and Dashboard `systemId` values are not persisted.

An unbound AI-Verse Data database from the Phase 1.3 foundation may be bound exactly once. After binding, a workspace/kind mismatch returns `DATABASE_SCOPE_CONFLICT`. Partial binding metadata is treated as `DATABASE_CORRUPT`.

### Isolation behavior

Two separate trusted roots may both contain workspace `shared`. Their logical bindings can match, while their physical database paths remain distinct because root selection is host-side authority.

The scope layer does not parse `WORKSPACE.yaml` yet. That native OS validation belongs to Phase 3 and is not falsely claimed here.

### Verification evidence

```text
GitHub Actions run: 34511358818
Node 22:             PASS
Node 24:             PASS
Tests:               37 / 37 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

The new tests prove trusted-root canonicalization, missing/non-directory rejection, workspace and standalone path derivation, unsafe filesystem workspace-ID rejection, child-symlink escape rejection, durable scope binding across reopen, one-time binding of older unbound databases, conflicting workspace rejection, conflicting scope-kind rejection, partial-binding corruption rejection, and same-ID isolation across different trusted roots.

Detailed contract: `docs/SCOPE-AND-IDENTITY-V0.1.md`.

### Deliberately not implemented

- AI-Verse OS compatibility detection;
- `WORKSPACE.yaml` parsing;
- workspace status checks;
- directory initialization policy;
- Data Spaces;
- entity schemas;
- records/CRUD;
- query execution;
- permissions;
- extension registration;
- sibling-layer adapters.

### Task 1.4 gate

**PASSED.**

Acceptance requirements are satisfied:

- a database cannot be reopened under conflicting workspace identity;
- workspace/database binding survives reopen;
- direct raw paths remain outside public record/query protocol operations;
- Dashboard `systemId` is not canonical Data identity;
- no Data Space/schema/record semantics were introduced early.

---

## Task 5 / 41 - Phase 1.5 Data Spaces and entity schemas

**Status:** COMPLETE

### Implemented

Public catalog surface:

```text
@ai-verse/data/catalog
```

The catalog now provides Data Space create/list/get and entity schema create/list/get/update on top of the storage-driver abstraction.

SQLite persists catalog truth in fixed engine-owned STRICT tables:

```text
_data_spaces
_entities
_entity_schema_versions
```

Agent-defined schemas remain structured JSON and never become arbitrary model-generated SQL tables.

### Schema integrity and evolution

- first entity schema version is 1;
- accepted updates create immutable subsequent versions;
- historical versions remain readable;
- deterministic canonical JSON produces a SHA-256 schema digest;
- persisted definitions are revalidated and digest-checked on read;
- stale `expectedSchemaVersion` fails with `SCHEMA_VERSION_CONFLICT`;
- duplicate Data Spaces/entities fail without replacement;
- defaults must satisfy field type, nullability, enum, range, date, and datetime constraints;
- additive fields are allowed when compatible;
- a new required field without a default requires migration;
- remove/replace/rename field operations return `SCHEMA_MIGRATION_REQUIRED`;
- invalid/unsupported changes do not create partial versions.

Schema creation and updates use SQLite transactions. The current-version pointer and immutable version row commit together or roll back together.

### Verification evidence

```text
GitHub Actions run: 34513039706
Node 22:             PASS
Node 24:             PASS
Tests:               53 / 53 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

Detailed contract: `docs/CATALOG-AND-SCHEMAS-V0.1.md`.

### Deliberately not implemented

- record table/storage;
- record create/get/list/update/delete;
- record defaults application;
- record actor attribution;
- query/aggregate execution;
- relations;
- record transactions/events/receipts;
- OS extension installation;
- sibling-layer adapters.

### Task 1.5 gate

**PASSED.**

Acceptance requirements are satisfied:

- Data Spaces persist and survive reopen;
- entity schemas persist and survive reopen;
- schema versions/digests are stable and historical versions are immutable;
- invalid schemas fail before canonical persistence;
- unsupported destructive changes return migration-required;
- safe additive updates are versioned and atomic;
- no record CRUD was implemented early.

---

## Task 6 / 41 - Phase 1.6 Record CRUD

**Status:** COMPLETE

### Implemented

Public record surface:

```text
@ai-verse/data/records
```

The record engine now provides create/get/list/update/soft-delete on top of the storage-driver abstraction.

SQLite persists canonical records in one fixed engine-owned table:

```text
_records
```

`_records` is STRICT and WITHOUT ROWID. It stores stable record identity, exact entity schema version, record version, canonical JSON, timestamps, actor attribution, and soft-delete metadata. Its schema-version foreign key points to the exact immutable schema version used for the persisted payload.

### Validation and defaults

- all first-release field types are validated;
- required and nullable semantics are enforced;
- string length and numeric range constraints are enforced;
- date/datetime and enum values are validated;
- reference/attachment IDs are shape-validated;
- unknown fields fail unless the schema explicitly permits them;
- schema defaults are deep-cloned and applied on create;
- compatible new defaults can be applied when an old record is next updated under the current schema;
- record-size ceilings are enforced after normalization/defaults.

### Record state and provenance

- engine-generated stable `rec_...` IDs;
- record version begins at 1 and advances on update/delete;
- stored `schemaVersion` remains distinct from record version;
- `createdAt` and `updatedAt` persist across reopen;
- `createdBy`, `updatedBy`, and `deletedBy` actor attribution persists;
- soft delete preserves the canonical record, reason, and actor;
- normal get/list hide deleted records;
- `includeDeleted: true` explicitly exposes deleted rows.

### Expected-version behavior

Update and soft delete require a matching `expectedVersion` and reject stale callers with `RECORD_VERSION_CONFLICT`.

This is the Phase 1 semantic check. Task 10 / 41 still owns race-safe atomic optimistic concurrency under competing writers and dedicated race tests.

### Failure behavior

Invalid creates/updates fail before canonical persistence. Stored record payloads are revalidated against their persisted historical schema version on read, and invalid stored canonical state fails closed as `DATABASE_CORRUPT`.

### Verification evidence

```text
GitHub Actions run: 34514486550
Node 22:             PASS
Node 24:             PASS
Tests:               71 / 71 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

Detailed contract: `docs/RECORD-CRUD-V0.1.md`.

### Deliberately not implemented

- general query/filter/sort/cursor execution;
- aggregate execution;
- relation existence/index enforcement;
- bounded multi-record transactions;
- race-safe atomic concurrency hardening;
- persistent idempotency;
- mutation events and receipts;
- permissions/capability enforcement;
- OS extension installation;
- sibling-layer adapters.

### Task 1.6 gate

**PASSED.**

Acceptance requirements are satisfied:

- create/get/list/update/soft-delete persist;
- CRUD survives close/reopen;
- invalid fields and missing required fields fail;
- defaults are applied correctly;
- record IDs/timestamps/schema versions are stable;
- initial actor attribution persists;
- stale expected versions fail without overwriting current state;
- deleted records are hidden by normal reads unless explicitly requested;
- no general Task 1.7 query/aggregate execution was introduced early.

---

## Task 7 / 41 - Phase 1.7 Safe query + aggregate engine

**Status:** COMPLETE

### Implemented

Public query surface:

```text
@ai-verse/data/query
```

The engine now executes bounded schema-aware query/filter/sort/select/cursor operations and count/sum/min/max/avg aggregates through a storage-neutral `DataQueryStorage` contract.

SQLite receives parameterized plans rather than raw caller SQL. Query values and JSON field paths are bound parameters. Sort directions and aggregate operators come only from fixed validated enums.

### Semantic safety

- filter fields must be declared schema fields;
- flexible unknown fields cannot become untyped query targets;
- value types must match schema field types;
- invalid field/operator pairs fail;
- enum values must be declared;
- JSON fields are restricted to null tests in v0.1;
- duplicate select fields, sort fields, and aggregate aliases fail;
- sum/avg require numeric fields;
- min/max require comparable fields;
- count is record count and omits a field;
- LIKE wildcard characters are escaped for contains/starts-with;
- SQL-looking values remain inert bound parameters.

### Pagination

Opaque base64url cursors contain a version, bounded offset, and SHA-256 fingerprint of the query shape. Cursors cannot be reused across different filter/sort/select/page-size/deleted-visibility shapes.

```text
default page size = 50
maximum page size = 200
maximum cursor offset = 100000
```

### Canonical read integrity

Query rows use the same historical-schema hydration path as normal record reads. Query does not bypass stored JSON/schema/timestamp/actor corruption checks.

### Verification evidence

```text
GitHub Actions run: 34516259373
Node 22:             PASS
Node 24:             PASS
Tests:               90 / 90 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

Detailed contract: `docs/QUERY-AND-AGGREGATES-V0.1.md`.

### Deliberately not implemented

- relation traversal/existence enforcement;
- cross-entity joins;
- bounded multi-record transaction execution;
- intra-transaction references;
- full-text search;
- arbitrary SQL;
- idempotency/events/receipts;
- permission/capability filtering.

### Task 1.7 gate

**PASSED.**

Acceptance requirements are satisfied:

- structured query AST executes;
- filters and boolean groups work;
- sorting and projection work;
- cursors are bounded and query-bound;
- server ceilings override callers;
- invalid field/type/operator combinations fail;
- SQL-looking values cannot become executable SQL;
- aggregates are type-checked and bounded;
- no Task 1.8 relation/transaction work was introduced early.

---

## Remaining Phase 1 tasks

| Overall task | Phase task | Status | Purpose |
|---|---|---|---|
| 8 / 41 | 1.8 | NEXT | Relations + bounded transactions |
| 9 / 41 | 1.9 | NOT STARTED | Phase 1 integration gate |

## Current boundary

Do not begin Task 1.9 or later work while implementing Task 1.8. Task 1.8 introduces relations and bounded transactions only; the Phase 1 integration gate remains Task 1.9.
