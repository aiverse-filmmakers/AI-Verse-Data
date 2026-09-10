# AI-Verse Data Catalog and Schemas v0.1

**Status:** Implemented in Phase 1.5  
**Date:** 2026-09-10

This document defines the implemented Data Space and entity-schema catalog. It is the first semantic layer above trusted storage/scope and deliberately stops before record CRUD.

## 1. Purpose

AI-Verse Data needs a safe way to describe structured operational domains before records can exist.

The hierarchy is:

```text
trusted workspace database
  -> Data Space
    -> Entity
      -> immutable schema versions
        -> records later, in Phase 1.6
```

Examples:

```text
space: crm
  entity: companies
  entity: contacts
  entity: deals

space: production
  entity: projects
  entity: shoots
  entity: assets
```

A Data Space is a logical namespace inside one workspace database. It does not create another database or another workspace.

## 2. Public catalog surface

Package subpath:

```text
@ai-verse/data/catalog
```

Primary API:

```ts
const catalog = new DataCatalog(database)

catalog.createSpace(...)
catalog.listSpaces()
catalog.getSpace(...)

catalog.createSchema(...)
catalog.listSchemas(...)
catalog.getSchema(...)
catalog.updateSchema(...)
```

The catalog consumes the storage-driver contract. Callers do not need SQLite APIs.

## 3. Fixed internal storage model

Agent-defined entities do not become arbitrary physical SQL tables.

Phase 1.5 adds three fixed engine-owned tables:

```text
_data_spaces
_entities
_entity_schema_versions
```

All are SQLite STRICT tables.

`_data_spaces` stores Data Space identity/metadata.

`_entities` stores stable entity identity and the pointer to its current schema version/digest.

`_entity_schema_versions` stores immutable schema snapshots.

No `_records` table is created in Phase 1.5.

This preserves the architectural rule:

> Agent-generated schema definitions are structured data, not executable SQL.

## 4. Data Spaces

First-release Data Spaces contain:

```text
spaceId
name
description?
authority
createdAt
updatedAt
schemaCount
```

The only accepted authority class in v0.1 is:

```text
local_canonical
```

Space IDs use the protocol's validated lowercase slug form.

Duplicate creation fails with:

```text
DATA_SPACE_ALREADY_EXISTS
```

It never silently replaces an existing Data Space.

## 5. Entity schemas

A schema definition includes:

```text
spaceId
entity
name
description?
fields
allowUnknownFields?
```

Supported v0.1 field types remain:

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

Each field can use its type-specific constraints plus common properties such as `required`, `nullable`, `description`, and `default`.

## 6. Default-value correctness

Phase 1.5 tightens protocol validation so a declared default must satisfy the declared field.

Examples:

```text
integer default 1.5                 -> reject
number min 10, default 5           -> reject
enum [lead, won], default lost      -> reject
date default 2026-02-31             -> reject
datetime without timezone           -> reject
null default without nullable:true  -> reject
```

Valid defaults are accepted only after the field constraints are satisfied.

This matters because Phase 1.6 will rely on schema defaults when creating records.

## 7. Schema versioning

The first schema for an entity is version 1.

Every accepted schema update creates a new immutable version:

```text
v1
  -> update
v2
  -> update
v3
```

Historical versions remain queryable.

The `_entities` table points to the current version while `_entity_schema_versions` preserves history.

A caller must provide:

```text
expectedSchemaVersion
```

If the current version differs, the update fails with:

```text
SCHEMA_VERSION_CONFLICT
```

No last-write-wins behavior is used.

## 8. Deterministic schema digests

Every schema version receives a SHA-256 digest over deterministic canonical JSON.

Object keys are recursively sorted before hashing. Array order remains meaningful.

Therefore equivalent schema objects with different JavaScript key insertion order receive the same digest.

The digest is persisted with the version. When a stored schema is read, Data validates the definition and recomputes the digest. A mismatch is treated as canonical storage corruption rather than trusted silently.

## 9. Safe additive updates

Phase 1.5 directly permits:

```text
add_field
set_name
set_description
```

Adding an optional field is safe.

Adding a required field is allowed only if a valid default exists. Without a default, existing future records could not be interpreted consistently, so Data returns:

```text
SCHEMA_MIGRATION_REQUIRED
```

The full user-schema migration framework belongs to Phase 2.7.

## 10. Destructive changes

The protocol can represent these changes so callers receive the correct semantic error:

```text
remove_field
replace_field
rename_field
```

Phase 1.5 does not execute them.

They return:

```text
SCHEMA_MIGRATION_REQUIRED
```

instead of generating ad-hoc SQL or partially changing canonical schema state.

## 11. Atomicity

Schema creation writes entity identity plus schema version in one SQLite transaction.

Schema update:

1. validates the expected current version;
2. constructs and validates the next complete schema;
3. computes the next digest;
4. conditionally advances the entity's current-version pointer;
5. inserts the immutable version snapshot;
6. commits both together.

If any required step fails, SQLite rolls the transaction back.

Invalid schemas and migration-required changes do not create partial versions.

## 12. Error contract

Catalog errors currently include:

```text
DATA_SPACE_NOT_FOUND
DATA_SPACE_ALREADY_EXISTS
ENTITY_NOT_FOUND
ENTITY_ALREADY_EXISTS
SCHEMA_VERSION_NOT_FOUND
SCHEMA_VERSION_CONFLICT
SCHEMA_MIGRATION_REQUIRED
SCHEMA_INVALID
DATABASE_CORRUPT
```

These are semantic catalog errors. Callers should not parse human error strings.

## 13. Storage neutrality

`DataCatalog` depends on `DataCatalogStorage`, not `better-sqlite3`.

SQLite provides the first implementation through `SqliteCatalogStorage`.

This preserves the path:

```text
DataCatalog
  -> DataCatalogStorage
    -> SQLite today
    -> sanctioned future driver later
```

Apps, Bots, Brain, Dashboard and other consumers should target the Data/catalog protocol rather than SQLite tables.

## 14. Deliberately not implemented

Phase 1.5 does not implement:

- record storage;
- create/read/update/delete records;
- record defaults application;
- record actor attribution;
- record optimistic concurrency;
- queries or aggregates;
- relations;
- bounded multi-record transactions;
- events or mutation receipts;
- OS extension installation;
- Memory/Brain/Bot/App/Dashboard adapters.

Record CRUD begins in Task 6 / 41, Phase 1.6.

## 15. Non-negotiable invariants

1. Data Spaces remain inside one trusted workspace database.
2. Agent-defined entities never become arbitrary SQL supplied by the agent.
3. Every persisted schema definition passes protocol validation.
4. Every accepted update creates a new immutable schema version.
5. Stored schema digests are deterministic and verified on read.
6. Stale expected schema versions fail visibly.
7. Unsupported destructive changes require migration.
8. Invalid or unsupported changes leave no partial schema version.
9. Data Space/entity identity is stable and cannot be silently replaced.
10. Record CRUD remains absent until Phase 1.6.
