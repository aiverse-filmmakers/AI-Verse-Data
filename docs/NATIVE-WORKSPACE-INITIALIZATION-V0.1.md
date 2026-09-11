# Native Workspace Resolution and Data Initialization v0.1

**Task:** 21 / 41  
**Phase:** 3.3 - Native workspace resolver + Data initialization  
**Status:** IMPLEMENTED  
**Public package surface:** `@ai-verse/data/native`

This document defines how AI-Verse Data resolves one native AI-Verse OS workspace, discovers its exact canonical Data state, and explicitly initializes one active workspace without accepting raw workspace/database paths.

## 1. Purpose

Task 21 establishes the native workspace-to-Data boundary:

```text
trusted AI-Verse OS root
  + requested workspace ID
    -> validated WORKSPACE.yaml
      -> internally derived Data scope
        -> exact canonical Data path
```

The caller supplies:

```text
rootPath
workspaceId
```

The caller does not supply:

```text
workspace directory path
data directory path
SQLite database path
binding metadata
```

## 2. Public API

```ts
const workspaces = new AiVerseDataWorkspaceManager()

const resolved = workspaces.resolve({
  rootPath: "/path/to/AI-Verse-OS",
  workspaceId: "client-a",
})

const discovery = await workspaces.discover({
  rootPath: "/path/to/AI-Verse-OS",
  workspaceId: "client-a",
})

const initialized = await workspaces.initialize({
  rootPath: "/path/to/AI-Verse-OS",
  workspaceId: "client-a",
})
```

`resolve()` is read-only.

`discover()` does not initialize, migrate, repair, replace, or rebind a database. It reuses the existing recovery/diagnostic layer, so confirmed corruption may persist the normal engine-owned quarantine marker.

`initialize()` is the only Task 21 operation that may create a new canonical workspace database.

## 3. AI-Verse OS host prerequisite

Native workspace operations require a Task 19-compatible AI-Verse OS v2 host.

```text
no-os        -> rejected
incompatible -> rejected
compatible   -> workspace resolution may continue
```

Task 21 does not silently fall back to standalone Data.

## 4. Workspace ID contract

The requested native workspace ID must satisfy:

```text
^[a-z0-9][a-z0-9-]*$
```

and is capped at 128 characters by Data's cross-platform scope boundary.

Examples accepted:

```text
client-a
production-2026
research
```

Examples rejected:

```text
../other
Client-A
client_a
client.a
-client
client/name
client\name
```

The requested ID is one filesystem segment only.

## 5. Exact workspace lookup

Task 21 inspects only:

```text
workspaces/<requested-id>/
```

It does not enumerate every workspace to guess the target.

The directory must:

- exist;
- be a real directory;
- not be a symbolic link;
- remain beneath the trusted OS root.

## 6. WORKSPACE.yaml contract

The required native manifest is:

```text
workspaces/<id>/WORKSPACE.yaml
```

The file must:

- exist;
- be a regular non-symlink file;
- remain inside the trusted workspace path;
- be at most 1 MiB.

Task 21 validates these required top-level AI-Verse OS fields:

```yaml
schema_version: "2.0"
id: "<workspace-slug>"
name: "<non-empty string>"
type: "<non-empty string>"
status: "active" | "paused" | "archived"
purpose: "<string>"
```

Unknown/additive manifest fields are tolerated.

## 7. Workspace manifest parser boundary

Task 21 reads only the required top-level scalar identity fields.

Supported string forms include:

- double-quoted scalars;
- single-quoted scalars;
- valid plain YAML strings;
- block string values using `|` or `>`.

The required fields remain type-sensitive.

For example:

```yaml
schema_version: 2.0
```

is rejected because the host schema requires a string.

Duplicate required top-level keys are rejected as ambiguous.

Task 21 does not turn unknown nested manifest metadata into Data authority.

## 8. Schema compatibility

Workspace `schema_version` must have major version 2.

Examples:

```text
2
2.0
2.4
```

are semantically major 2 when represented as YAML strings.

Other major versions fail with:

```text
WORKSPACE_SCHEMA_UNSUPPORTED
```

## 9. Identity binding

Manifest `id` must exactly equal:

1. the requested workspace ID;
2. the workspace directory identity;
3. the Data scope workspace binding.

A copied or misplaced workspace manifest fails closed with:

```text
WORKSPACE_ID_MISMATCH
```

Task 21 never rewrites the manifest ID to make it fit the directory.

## 10. Workspace status semantics

Resolution and discovery support all valid host statuses:

```text
active
paused
archived
```

Fresh Data initialization is allowed only when:

```text
status: active
```

Paused and archived workspaces may be resolved and diagnosed, but Task 21 will not silently create a new canonical database in them.

## 11. Canonical native Data path

The only Task 21 native canonical path is:

```text
workspaces/<id>/data/ai-verse-data.sqlite
```

It is derived through the existing trusted scope helper:

```ts
createWorkspaceDataScope(root, workspaceId)
```

The resulting database embeds:

```text
bindingVersion: 1
kind: workspace
workspaceId: <exact manifest/requested id>
```

## 12. Data path safety

Existing `data/` path components must not:

- escape the trusted root;
- be symbolic links;
- be files where directories are required;
- redirect the canonical DB through a symlink.

An existing canonical database path may be a regular file only.

Unsafe state fails before discovery or initialization.

## 13. Discovery states

Task 21 preserves the existing reliability states rather than collapsing them.

Discovery may report:

```text
healthy
missing
unbound
residue
migration_required
migration_incomplete
quarantined
corrupt
unrecognized
unsupported
scope_conflict
unavailable
```

The inherited recovery layer normally converts confirmed corruption into durable `quarantined` state.

## 14. Exact-binding requirement

A database is native-ready only when its persisted binding exactly matches the resolved workspace.

A healthy-looking legacy AI-Verse Data database with no stored scope binding is classified:

```text
unbound
```

Task 21 does not silently adopt or bind it during initialization.

This is stricter than the lower-level host-neutral scope API, which still supports explicit one-time binding for older callers.

Native initialization requires an already-existing database to be exact-binding before treating it as initialized.

## 15. Missing versus residue

A missing canonical database is considered clean only when no suspicious sibling safety/runtime state remains.

When the main DB is missing, Task 21 checks for:

```text
ai-verse-data.sqlite-wal
ai-verse-data.sqlite-shm
ai-verse-data.sqlite.quarantine.json
```

If any remain, discovery reports:

```text
residue
```

and fresh initialization is refused.

This prevents an orphaned WAL/quarantine condition from being hidden by a new empty database.

Normal `-wal` and `-shm` files are allowed when the main canonical database exists.

## 16. Installation prerequisite

Fresh native database initialization additionally requires the Task 20 extension installation to be current and enabled.

Task 21 verifies:

- `ai-verse-data` is registered;
- the canonical Task 20 registry fields are current;
- existing unknown Data-entry fields remain allowed;
- `enabled` is not false;
- all Task 20 owned extension files are current.

Failures remain distinct:

```text
EXTENSION_NOT_INSTALLED
EXTENSION_DISABLED
EXTENSION_INSTALLATION_INCOMPLETE
```

Workspace resolution/discovery does not require the extension to be enabled because operators may need diagnosis while software state is disabled.

## 17. Fresh initialization sequence

For one active, clean-missing workspace:

```text
resolve host
  -> resolve exact workspace
    -> validate WORKSPACE.yaml
      -> verify current enabled Task 20 installation
        -> discover canonical DB state
          -> require clean missing
            -> create workspace data/ if needed
              -> create staged same-directory SQLite DB
                -> bind staged DB to exact workspace
                  -> integrity check
                    -> close + reopen exact-binding
                      -> require no staged WAL/SHM/quarantine residue
                        -> publish with atomic no-overwrite hard link
                          -> remove staging name
                            -> rediscover canonical DB
                              -> require healthy exact-binding
```

## 18. No-overwrite publication

Task 21 never publishes a fresh database with a rename that could overwrite an existing canonical file.

Instead it creates the staged database in the same `data/` directory and uses atomic hard-link creation for the canonical path.

If the canonical path already appeared:

```text
EEXIST
```

Task 21 does not overwrite it.

It deletes only its own staged file and rediscoveries the canonical state.

If the concurrent winner is healthy and exact-binding, the caller receives:

```text
already_initialized
```

Otherwise initialization fails closed.

## 19. Concurrent initialization

Tests run two simultaneous Task 21 initializers against one clean workspace.

The required result is:

```text
one -> initialized
one -> already_initialized
```

Both resolve the same healthy exact-binding canonical database.

No staging file may remain.

## 20. Idempotent repeated initialization

If a workspace already has a healthy exact-binding current Data database:

```text
initialize()
-> already_initialized
```

The canonical DB is not replaced.

The original database creation identity remains intact.

## 21. Existing database safety

Task 21 never implicitly:

- migrates a database;
- retries an incomplete migration;
- repairs corruption;
- clears quarantine;
- truncates an unrecognized file;
- replaces unsupported state;
- rebinds an unbound database;
- remaps a conflicting workspace binding.

Those states require the dedicated migration/recovery/admin paths.

## 22. One-workspace-only effect

Initialization affects only the requested active workspace.

Tests create multiple valid workspaces and initialize one.

The others receive no `data/` directory or database as a side effect.

Task 21 does not scan the whole workspace tree and does not initialize all workspaces during install.

## 23. Task 20 ownership preservation

Task 21 does not rewrite:

- `.aiverse/extensions/registry.json`;
- Data's installed `INSTRUCTIONS.md`;
- Data's installed `engine.mjs`;
- Data's installed `extension.json`.

Tests compare those bytes before/after workspace initialization.

## 24. Tracked OS ownership preservation

Task 21 does not modify:

- `AI-VERSE.yaml`;
- `AGENTS.md`;
- `CLAUDE.md`;
- `system/`;
- `skills/registry.yaml`;
- sibling extension state.

## 25. Acceptance

Task 21 proves:

- exact compatible-host workspace resolution;
- exact host workspace slug validation;
- missing/wrong-type/symlink workspace rejection;
- missing/symlink/oversized manifest rejection;
- required-field type validation;
- duplicate required-key rejection;
- schema-major mismatch rejection;
- manifest/directory ID mismatch rejection;
- status enum validation;
- unknown additive manifest tolerance;
- block string purpose support;
- paused/archived read/diagnostic resolution;
- paused/archived fresh initialization rejection;
- current enabled extension requirement;
- exact canonical DB path derivation;
- one-workspace-only initialization;
- exact persisted binding;
- idempotent repeated initialization;
- concurrent no-overwrite initialization;
- orphan WAL residue rejection;
- unbound legacy DB non-adoption;
- distinct scope-conflict/migration-required/migration-incomplete/unsupported/quarantined/unavailable discovery;
- Data-path symlink rejection;
- Task 20 registry/file byte preservation;
- complete Node 22 + Node 24 suite verification.

Behavioral verification:

```text
Behavioral commit:   eebe1c894de17b85334f4167456530cf60b61d6c
GitHub Actions run:  34612425250
Node 22:             PASS
Node 24:             PASS
Tests:               244 / 244 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

## 26. Next

Task 22 / 41, Phase 3.4, owns task-relevant native extension instruction/runtime discovery through the existing AI-Verse OS local extension hook.

Task 22 must consume the Task 19/20/21 boundaries without creating a second extension registry, second workspace identity source, or competing Data path.
