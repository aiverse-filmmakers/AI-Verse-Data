# AI-Verse Data Storage v0.1

**Status:** Implemented in Phase 1.3, scope binding extended in Phase 1.4, catalog persistence extended in Phase 1.5, record persistence extended in Phase 1.6  
**Date:** 2026-09-10

This document records the first concrete storage-driver behavior for AI-Verse Data. It is intentionally narrower than the public Data protocol.

## Storage boundary

AI-Verse Data exposes a storage-driver contract so protocol, Apps, Bots, Dashboard, and future server backends do not depend directly on SQLite APIs.

The first driver is SQLite through `better-sqlite3`.

```text
Public Data protocol
        |
        v
Data engine
        |
        v
Storage-driver contract
        |
        +-- SQLite v0.1
        +-- future sanctioned drivers
```

SQLite details remain implementation details behind the storage boundary.

## Current dependency

Phase 1.3 pins:

```text
better-sqlite3       13.0.3
@types/better-sqlite3 9.6.0
```

The dependency is not re-exported as part of the Data protocol.

## Database format identity

The first local database format uses four independent identity signals:

```text
format string:      ai-verse-data/sqlite
format version:     1
SQLite application_id: 0x41495644  ("AIVD")
SQLite user_version:   1
```

These are intentionally separate from:

- package version;
- public protocol version;
- entity schema versions;
- future migration versions.

A file is not trusted merely because it has a `.sqlite` extension.

## Internal metadata table

Every initialized AI-Verse Data SQLite database contains:

```sql
CREATE TABLE _aiverse_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT, WITHOUT ROWID;
```

Required core keys in format version 1:

```text
format
format_version
created_at
driver
```

Phase 1.4 adds optional scope-binding keys:

```text
binding_version
scope_kind
workspace_id
```

An unbound Phase 1.3 database remains valid. The first scoped open may bind it exactly once. Once present, all binding keys are required together; partial binding metadata is treated as corruption. Data Space and entity-schema catalog tables are added in Phase 1.5. Canonical record storage is added in Phase 1.6.

## Open modes

The driver supports two internal open modes:

```text
create-or-open
open-existing
```

`create-or-open` may initialize a new or truly empty SQLite file.

`open-existing` requires an already initialized AI-Verse Data database and never initializes an empty file.

## Fail-closed adoption rule

The driver must never silently convert an unrelated SQLite database into AI-Verse Data.

If a pre-existing file contains application tables, non-zero SQLite identity metadata, mismatched AI-Verse metadata, or an unsupported format, opening fails visibly.

No schema repair or identity rewrite occurs automatically.

## SQLite compatibility

The first driver requires SQLite 3.37.0 or newer because `STRICT` tables were introduced in SQLite 3.37.0.

The engine checks the runtime version before initialization.

## Connection configuration

After a database has been recognized or safely initialized, writable local connections enforce:

```text
PRAGMA foreign_keys = ON
PRAGMA journal_mode = WAL
PRAGMA synchronous = NORMAL
PRAGMA busy_timeout = 5000
```

The important guarantees in Phase 1.3 are:

- foreign-key enforcement is actually enabled;
- WAL mode is actually active;
- metadata storage uses a STRICT table;
- the database identity is stable across reopen.

## Integrity checking

The storage handle exposes a read-only integrity check backed by:

```text
PRAGMA integrity_check
```

A healthy database returns:

```json
{
  "ok": true,
  "messages": ["ok"]
}
```

Integrity checking does not attempt repair.

## Diagnostics

The storage handle can report:

```text
driver
SQLite runtime version
journal mode
foreign-key state
STRICT-table state
application_id
user_version
```

These diagnostics are intended for later `doctor`, installation, and health surfaces.

## Closed-handle behavior

Closing a storage handle is idempotent. Once closed, metadata, diagnostics, and integrity operations fail explicitly rather than reopening the database behind the caller's back.

## Phase 1.4 scope extension

The storage driver now accepts an optional host-supplied `expectedBinding`. Scoped opens use it to persist or validate:

```text
binding version 1
scope kind: standalone | workspace
workspaceId
```

A conflicting binding returns `DATABASE_SCOPE_CONFLICT`. The driver never silently rebinds a database. Absolute trusted-root paths and Dashboard `systemId` values are not persisted as database identity.

For the full path and scope contract, see `docs/SCOPE-AND-IDENTITY-V0.1.md`.

## Phase 1.5 catalog extension

The SQLite storage driver now exposes a storage-neutral `DataCatalogStorage` contract. The first SQLite implementation creates:

```text
_data_spaces
_entities
_entity_schema_versions
```

These are fixed engine-owned STRICT tables. User/agent entity definitions are stored as validated canonical JSON plus immutable version/digest metadata. Data does not create arbitrary SQL tables from agent-proposed schemas.

The catalog contract and semantics are documented in `docs/CATALOG-AND-SCHEMAS-V0.1.md`.

## Phase 1.6 record extension

The storage driver now also exposes a storage-neutral `DataRecordStorage` contract. SQLite creates one fixed engine-owned record table:

```text
_records
```

`_records` is a STRICT, WITHOUT ROWID table. It stores Data Space/entity identity, stable record ID, exact schema version, record version, canonical JSON payload, timestamps, actor attribution, and soft-delete metadata.

The stored `schema_version` is protected by a foreign key to the exact immutable row in `_entity_schema_versions`. User-defined entities still do not become arbitrary physical SQL tables.

Record reads and writes remain behind `DataRecordStorage`; consumers are not expected to use SQLite directly.

Detailed semantics: `docs/RECORD-CRUD-V0.1.md`.

## What storage still deliberately does not implement

No general query/aggregate execution.  
No relations.  
No idempotency/event/receipt persistence.  
No AI-Verse OS manifest/workspace validation.  
No OS extension registration.  
No Memory/Brain/Bot/Dashboard/App integration.

Those remain separate tasks in `docs/BUILD-MAP.md`.

## Invariants

1. SQLite is a driver, not the public Data contract.
2. An unrelated SQLite file is never adopted silently.
3. Newer/unsupported Data formats fail closed.
4. Metadata survives close and reopen unchanged.
5. Runtime SQLite capability is checked before initialization.
6. Integrity checks report; they do not repair.
7. No database path appears in normal public Data protocol requests.
8. Scope binding is persisted only when a trusted host supplies the expected binding.
9. A database cannot be silently rebound to a different workspace or scope kind.
10. Raw root paths and Dashboard `systemId` values are not canonical database identity.

11. Agent-defined schemas are persisted through fixed engine-owned catalog tables rather than arbitrary generated SQL.
12. Schema version snapshots are immutable and digest-verified.

13. Canonical records use one fixed engine-owned `_records` table rather than generated per-entity SQL tables.
14. Every record persists the exact entity schema version used for its canonical payload.
15. Soft deletion preserves the canonical row and deletion attribution.
