# AI-Verse Native Workspace Resolver and Data Initialization v0.1

**Task:** 21 / 41  
**Phase:** 3.3 - Native workspace resolver + Data initialization  
**Status:** IMPLEMENTED  
**Public package surface:** `@ai-verse/data/native`

This document defines how AI-Verse Data resolves one native AI-Verse OS
workspace by ID and explicitly initializes its canonical Data database
without touching any other workspace.

## 1. Purpose

Task 21 turns a Task 19 `compatible` host into one initialized workspace
database.

The operation owns only:

```text
workspaces/<requested-id>/data/ai-verse-data.sqlite
```

It does not own:

```text
AI-VERSE.yaml
AGENTS.md
operator/
other workspaces
.aiverse/extensions/
system/
canonical databases in other workspaces
```

## 2. Host prerequisite

Workspace resolution and initialization begin only after the Task 19
compatibility detector returns:

```text
compatible
```

These are rejected before any workspace state is inspected or created:

```text
no-os
incompatible
```

There is no silent standalone fallback from an incompatible host, and no
silent enumeration of every workspace to guess identity.

## 3. Public API

```ts
import {
  AiVerseWorkspaceDataInitializer,
  AiVerseWorkspaceDiscovery,
  AiVerseWorkspaceResolver,
} from "@ai-verse/data/native";

const resolved = new AiVerseWorkspaceResolver().resolve({
  rootPath: "/path/to/AI-Verse-OS",
  workspaceId: "sales",
});

const discovery = await new AiVerseWorkspaceDiscovery().discover({
  rootPath: "/path/to/AI-Verse-OS",
  workspaceId: "sales",
});

const initialized =
  await new AiVerseWorkspaceDataInitializer().initialize({
    rootPath: "/path/to/AI-Verse-OS",
    workspaceId: "sales",
  });
```

Functional aliases are also exported:

```text
resolveWorkspace
discoverWorkspaceData
initWorkspaceData
```

`resolve()` is synchronous and read-only.

`discover()` is read-only diagnosis. It never creates, migrates, repairs,
truncates, replaces, or rebounds a database.

`initialize()` creates a database only when the requested active workspace
has no existing database.

## 4. Caller-supplied identity

The caller supplies only:

```text
rootPath
workspaceId
```

The caller never supplies:

```text
workspace path
WORKSPACE.yaml path
SQLite path
data/ path
OS_ROOT override
systemId
raw SQL
```

The workspace ID must satisfy the live AI-Verse OS host contract:

```text
^[a-z0-9][a-z0-9-]*$
```

IDs are additionally bounded to 128 characters and rejected before any
filesystem inspection when they violate the host pattern.

## 5. Exact workspace resolution

Resolution inspects only:

```text
workspaces/<requested-id>/
workspaces/<requested-id>/WORKSPACE.yaml
```

It never lists all workspaces to infer identity.

The workspace directory must:

- exist under `workspaces/`;
- be a real non-symlink directory;
- remain beneath the trusted OS root.

`WORKSPACE.yaml` must:

- exist;
- be a regular non-symlink file;
- remain within the 1 MiB Task 21 manifest read ceiling;
- declare exactly one `schema_version`;
- declare a supported schema major `2`;
- declare exactly one `id`;
- declare a non-empty `name`;
- declare a non-empty `type`;
- declare exactly one `status` of `active`, `paused`, or `archived`;
- declare exactly one `purpose` string, which may be empty.

Unknown additive manifest fields are tolerated.

Manifest `id` must exactly equal both:

```text
requested workspace ID
workspace directory identity
```

A copied or misplaced workspace fails closed with
`WORKSPACE_ID_MISMATCH`.

## 6. Workspace status

Resolution may report any valid manifest status.

Fresh Data initialization requires:

```text
active
```

A `paused` or `archived` workspace resolves successfully but initialization
fails closed with `WORKSPACE_NOT_ACTIVE` and creates no database.

## 7. Canonical Data path

The only native canonical Data path is derived internally through the
existing trusted workspace scope helper:

```text
workspaces/<id>/data/ai-verse-data.sqlite
```

The resolver returns both the relative and absolute derived path, but the
caller cannot override it.

Existing `data/` parents must be real non-symlink directories. Fresh
initialization creates a missing `data/` parent with mode `0700`.
A symlinked or non-directory `data/` parent fails closed.

An existing database path must be a regular non-symlink file. A symlinked
database path fails closed and is never followed.

## 8. Explicit initialization

Initialization affects only the requested workspace.

Before creating anything, Task 21 runs existing-database discovery on the
exact resolved workspace path.

If discovery reports:

```text
compatible
```

initialization returns `unchanged` without replacing the database.

If discovery reports any other existing-database state, initialization
fails closed and preserves the existing file:

```text
migration_required      -> WORKSPACE_DATABASE_MIGRATION_REQUIRED
quarantined             -> WORKSPACE_DATABASE_QUARANTINED
scope_conflict          -> WORKSPACE_DATABASE_CONFLICT
unsupported             -> WORKSPACE_DATABASE_UNSUPPORTED
unavailable             -> WORKSPACE_DATA_UNAVAILABLE
```

There is no silent:

- truncation;
- replacement;
- migration;
- repair;
- rebinding;
- quarantine clearing.

Fresh initialization reuses the existing workspace-scoped storage binding
contract, so the new database embeds exactly:

```text
bindingVersion: 1
kind: workspace
workspaceId: <requested-id>
```

The new database is reopened through discovery and must verify
`compatible` before initialization reports `created`.

Repeated initialization of an already-compatible database is idempotent
and discovery-safe.

## 9. Existing-database discovery

Discovery uses the exact resolved workspace path only. It never scans
other workspaces and never enumerates the `workspaces/` directory.

Discovery distinguishes seven states:

```text
missing
compatible
migration_required
quarantined
scope_conflict
unsupported
unavailable
```

Discovery reuses the existing storage and recovery contracts:

- SQLite file existence, regular-file, and symlink checks;
- Task 17 recovery diagnosis for quarantine, corruption, migration,
  scope, unrecognized, unsupported, and unavailable states;
- Task 15 internal migration status for required versus incomplete
  migration;
- trusted workspace binding comparison for scope conflict.

Recovery `migration_incomplete` is reported as Task 21
`migration_required` with an `incomplete` native detail, because both
states mean the same Task 21 law: do not replace or migrate silently.

Recovery `corrupt` without a persisted quarantine marker is reported as
Task 21 `quarantined`, because normal use must remain blocked.

Recovery `unrecognized` and `unsupported` are both reported as Task 21
`unsupported`, because neither is a supported workspace database for this
engine.

Discovery preserves:

- original database bytes;
- quarantine markers;
- migration ledger state;
- scope binding;
- sibling workspace state;
- extension registry state.

## 10. Installation-order and coexistence

Task 21 owns no extension registry state and creates no extension files.

Initializing one workspace does not:

- create databases in other workspaces;
- modify `.aiverse/extensions/registry.json`;
- modify unrelated extension entries;
- modify tracked OS files;
- modify Memory, Brain, Bots, Skills, Apps, Connections, or Dashboard
  state.

Representative install orders remain supported because each workspace
database carries its own exact binding and installation never assumes a
particular sibling order.

The `big-machine` workspace remains an ordinary workspace ID under the
same host-contract pattern.

## 11. Path and symlink safety

Task 21 rejects:

- empty workspace IDs;
- NUL-containing IDs;
- IDs outside `^[a-z0-9][a-z0-9-]*$`;
- IDs longer than 128 characters;
- symlinked OS roots through the Task 19 compatibility boundary;
- symlinked workspace directories;
- symlinked `WORKSPACE.yaml` files;
- oversized manifests;
- symlinked `data/` parents;
- non-directory `data/` parents;
- symlinked database files.

All native workspace paths are engine-derived constants plus one
caller-supplied workspace ID, never caller-supplied destination paths.

## 12. Error surface

Workspace errors use:

```text
AiVerseWorkspaceError
```

Error codes:

```text
AI_VERSE_OS_NOT_FOUND
INCOMPATIBLE_AI_VERSE_OS
INVALID_WORKSPACE_ID
WORKSPACE_NOT_FOUND
WORKSPACE_UNSAFE
WORKSPACE_MANIFEST_MISSING
WORKSPACE_MANIFEST_UNSAFE
WORKSPACE_MANIFEST_TOO_LARGE
WORKSPACE_MANIFEST_MALFORMED
WORKSPACE_SCHEMA_UNSUPPORTED
WORKSPACE_ID_MISMATCH
WORKSPACE_STATUS_INVALID
WORKSPACE_NOT_ACTIVE
WORKSPACE_DATA_UNSAFE
WORKSPACE_DATA_UNAVAILABLE
WORKSPACE_DATABASE_CONFLICT
WORKSPACE_DATABASE_MIGRATION_REQUIRED
WORKSPACE_DATABASE_QUARANTINED
WORKSPACE_DATABASE_UNSUPPORTED
```

Discovery itself is read-only and reports states rather than throwing for
ordinary existing-database conditions. Resolution and initialization throw
for unsafe, mismatched, inactive, conflicting, or otherwise
non-initializable conditions.

## 13. Deliberately not implemented

Task 21 does not implement:

- Task 22 task-relevant extension instruction or runtime discovery;
- Task 23 native CLI lifecycle commands;
- Task 24 native doctor or status commands;
- automatic migration execution;
- automatic repair or promotion;
- multi-workspace initialization;
- workspace enumeration or search;
- sibling repository changes.

## 14. Acceptance

Task 21 proves:

- ID-only resolution derives the exact canonical Data path;
- host-contract-violating IDs fail before filesystem inspection;
- only the requested workspace is inspected;
- copied/misplaced workspaces fail on manifest ID mismatch;
- symlinked workspace directories and manifests fail closed;
- manifest schema, identity, status, and required fields are validated;
- unknown additive manifest fields are tolerated;
- paused and archived workspaces resolve but never receive fresh databases;
- explicit init creates only the requested active workspace database;
- fresh databases embed the exact workspace binding;
- repeated init is idempotent and byte-stable;
- discovery distinguishes missing, compatible, migration_required,
  quarantined, scope_conflict, unsupported, and unavailable;
- existing databases are never silently replaced, migrated, repaired, or
  rebound;
- wrong-workspace database copies fail closed on binding;
- symlinked database paths fail closed;
- registry and sibling workspace state survive init;
- `big-machine` and representative install orders continue to work;
- complete repository suite passes.
