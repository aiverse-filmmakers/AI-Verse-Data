# AI-Verse Data Scope and Database Identity v0.1

**Status:** Implemented foundation contract  
**Phase:** 1.4  
**Date:** 2026-09-10

This document defines how AI-Verse Data binds canonical databases to trusted host roots and workspace identity without depending on Dashboard, raw client paths, or another AI-Verse layer.

## 1. Core rule

> **A canonical Data database belongs to exactly one logical scope binding, while the trusted filesystem root remains host-side authority.**

The binding stored inside the database is intentionally small:

```text
bindingVersion
scope kind
workspaceId
```

It does not persist:

- Dashboard `systemId`;
- arbitrary local filesystem paths;
- UI/session IDs;
- Brain/Memory/Bot identities;
- credentials;
- App ownership.

This keeps Data independently installable and prevents presentation-layer identity from becoming canonical Data identity.

## 2. Two supported scope modes

### Workspace mode

Native-ready AI-Verse placement:

```text
<trusted OS root>/
└── workspaces/
    └── <workspaceId>/
        └── data/
            └── ai-verse-data.sqlite
```

The Phase 1.4 resolver derives this path from:

```text
TrustedDataRoot
+ workspaceId
```

It does not accept a database path from a normal Data protocol request.

Phase 3 will add AI-Verse OS compatibility detection and verify `WORKSPACE.yaml` before native initialization. Phase 1.4 deliberately does not pretend to perform that host-level verification yet.

### Standalone mode

Host-neutral placement:

```text
<trusted project root>/
└── .ai-verse-data/
    └── data.sqlite
```

Standalone mode still receives a logical `workspaceId` so the protocol and database binding keep one consistent scope model.

## 3. Trusted root

A filesystem path is not considered trusted merely because a caller supplied a string.

`TrustedDataRoot.fromExistingDirectory(...)`:

1. requires a non-empty path;
2. requires the path to exist;
3. resolves it to its canonical real path;
4. requires the result to be a directory;
5. remembers that canonical root;
6. rechecks the root before every derived-path resolution.

The trusted-root object is a host-side capability. It is not part of the public request envelope.

## 4. Safe derived paths

Data resolves database locations only from known path segments.

Workspace IDs used as physical path components must be safe across supported platforms. Phase 1.4 rejects:

- `.` and `..`;
- slash and backslash;
- NUL;
- Windows-invalid path characters;
- reserved Windows device names such as `CON`, `NUL`, `COM1`, and `LPT1`;
- trailing dot/space;
- IDs outside the bounded safe filesystem form.

Existing child path components are inspected before opening a database. If a child component is a symbolic link, the scoped resolver fails closed rather than following it.

This is an early safety baseline. Phase 5 expands the adversarial filesystem suite across macOS, Linux, and Windows.

## 5. Persistent database binding

SQLite format v1 stores optional binding metadata in `_aiverse_meta`:

```text
binding_version = 1
scope_kind      = standalone | workspace
workspace_id    = <workspaceId>
```

A database created through the scoped API receives this binding on creation.

A valid older/unbound AI-Verse Data database from the Phase 1.3 foundation may be bound exactly once on its first scoped open. That enables forward compatibility without rewriting unrelated SQLite files.

After binding:

```text
expected binding == stored binding
    -> open

expected binding != stored binding
    -> DATABASE_SCOPE_CONFLICT
```

There is no silent rebinding.

Partially present or invalid stored binding metadata is corruption and must fail closed.

## 6. Why the root path is not stored as identity

The database is physically isolated by trusted-root resolution, but the absolute root path is not written into canonical metadata.

Reasons:

- local paths can contain private machine/user information;
- OS/project folders may be moved;
- Dashboard must not define canonical identity;
- a future host may not use a local filesystem path at all;
- the storage-driver contract must remain portable.

Normal cross-root isolation comes from the host choosing one trusted root and deriving all paths within it.

Two separate trusted roots can both contain a workspace called `main`; they resolve to different physical databases and do not collide.

## 7. Public protocol boundary

The public protocol continues to use logical scope:

```json
{
  "scope": {
    "workspaceId": "production"
  }
}
```

It does not accept:

```text
databasePath
sqlitePath
rootPath
OS_ROOT
systemId
raw SQL
```

The low-level storage driver still accepts a filesystem `location` because storage drivers need a host-supplied location. That API is infrastructure-level, not the normal agent/App record/query boundary.

Normal host code should prefer:

```text
TrustedDataRoot
    ↓
DataDatabaseScope
    ↓
openScopedDataDatabase(...)
    ↓
storage driver receives derived location + expected binding
```

## 8. Dashboard and multi-OS compatibility

Dashboard may have:

```text
systemId A -> /path/to/OS-A
systemId B -> /path/to/OS-B
```

Data never stores those Dashboard IDs.

Instead the Dashboard Gateway/OS adapter resolves the selected `systemId` to the correct approved root, creates/uses a trusted root, then supplies the workspace scope to Data.

Therefore:

```text
Dashboard systemId
    ↓ host-only routing
trusted OS root
    ↓
workspaceId
    ↓
AI-Verse Data
```

Changing Dashboard registration metadata cannot silently reassign an existing database.

## 9. Database format relationship

Scope binding version is deliberately distinct from:

- package version;
- protocol version;
- SQLite database format version;
- future entity-schema versions.

Current identities:

```text
protocol                ai-verse-data/0.1
database format         ai-verse-data/sqlite
database format version 1
scope binding version   1
SQLite application_id   0x41495644 (AIVD)
```

This allows each contract to evolve independently.

## 10. API surface

Public subpath:

```text
@ai-verse/data/scope
```

Primary foundation API:

```ts
TrustedDataRoot.fromExistingDirectory(rootPath)

createWorkspaceDataScope(root, workspaceId)
createStandaloneDataScope(root, workspaceId)

scope.databasePath()

openScopedDataDatabase(driver, scope, {
  mode: "create-or-open" | "open-existing"
})
```

The scope object exposes logical identity plus a derived database-path function for trusted host infrastructure. Public Data record/query operations remain path-free.

## 11. Explicitly deferred

Phase 1.4 does not implement:

- AI-Verse OS detection;
- `WORKSPACE.yaml` parsing or validation;
- workspace active/inactive checks;
- extension registration;
- directory initialization policy;
- Data Spaces;
- entity schemas;
- record CRUD;
- permission evaluation;
- Apps/Bots/Brain/Memory adapters.

Those belong to later Build Map tasks.

## 12. Non-negotiable invariants

1. A scoped database cannot be silently rebound.
2. Conflicting workspace identity fails closed.
3. Conflicting scope kind fails closed.
4. Dashboard `systemId` never becomes canonical Data identity.
5. Raw database paths stay outside normal record/query protocol requests.
6. Derived database paths remain inside one trusted root.
7. Existing child symlinks cannot redirect Data outside the trusted root.
8. Same workspace IDs under different trusted roots remain physically separate.
9. Binding metadata survives close/reopen.
10. Unbound legacy AI-Verse Data storage may be bound once, never repeatedly reassigned.
11. No Phase 1.4 code creates Data Spaces, schemas, records, or Memory.
