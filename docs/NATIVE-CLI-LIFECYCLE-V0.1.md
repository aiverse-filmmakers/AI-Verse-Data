# AI-Verse Native CLI Lifecycle v0.1

**Task:** 23 / 41
**Phase:** 3.5 - Native CLI install/update/disable/uninstall
**Status:** IMPLEMENTED
**Public package surface:** `ai-verse-data` CLI plus `@ai-verse/data/native` lifecycle engine

This document defines the thin native CLI lifecycle over the existing
Task 19-22 primitives. It installs, updates, disables, and uninstalls
the Data extension without ever touching canonical workspace databases.

## 1. Purpose

Task 23 composes what already exists:

```text
Task 19  compatible-root gate
Task 20  hardened install primitive (lock, atomic replace, rollback)
Task 21  workspace init/discovery (NOT invoked by lifecycle)
Task 22  read-only instruction discovery (NOT invoked by lifecycle)
```

Lifecycle commands mutate only:

```text
.aiverse/extensions/ai-verse-data/  (owned files)
.aiverse/extensions/registry.json -> extensions["ai-verse-data"]
.aiverse/extensions/registry.json.lock (transient, never stolen)
```

They never mutate:

```text
AI-VERSE.yaml
AGENTS.md
operator/
workspaces/
system/
sibling extension state
canonical workspace databases
```

## 2. Commands

All lifecycle commands require an explicit trusted host root:

```bash
ai-verse-data install --root <os-root> [--json]
ai-verse-data update --root <os-root> [--json]
ai-verse-data disable --root <os-root> [--json]
ai-verse-data uninstall --root <os-root> [--json]
```

`--root` is required. There is no CWD guess. A missing `--root`
exits 2 with usage. Unknown arguments exit 2. Fail-closed lifecycle
failures exit 1 with a stable `Error <CODE>:` line plus a next-step hint.

Human output prints command, status, root, registry-written,
enabled, and a workspace-databases-preserved line. `--json` prints the
exact lifecycle result object.

### install

Runs the Task 20 installer verbatim: compatibility gate, lock,
re-read, owned-file materialization with verification, atomic registry
replace with raw-text lost-update check, post-commit verification.
Idempotent: second run reports `unchanged`.

### update

Identical engine path to install at the current package version.
Preserves `enabled: false`, unknown entry fields, unknown top-level
registry fields, unrelated entries, and unknown safe files in the owned
directory. Never rewrites user records or schemas.

### disable

Flips only the Data entry's `enabled` to `false` under the registry
lock with re-read plus atomic replace. Already-`false` reports
`unchanged`. Missing entry reports `EXTENSION_NOT_INSTALLED` with no
write. Owned files and workspace databases are untouched.

### uninstall

Removes only Data-owned state: the three owned files
(`INSTRUCTIONS.md`, `engine.mjs`, `extension.json`), the owned root
directory when empty, and the `extensions["ai-verse-data"]` registry key.
Unrelated entries, unknown top-level fields, unknown safe files in the
owned directory beyond the three owned files, and every
`workspaces/*/data/ai-verse-data.sqlite` are preserved. Missing entry
reports `not-installed` with no write. Purge is out of scope.

## 3. Engine API

Programmatic surface under `@ai-verse/data/native`:

```ts
installDataExtension({ rootPath })
updateDataExtension({ rootPath })
disableDataExtension({ rootPath })
uninstallDataExtension({ rootPath })
new AiVerseDataExtensionLifecycle().install/update/disable/uninstall(...)
```

Results carry command, status (`installed`, `updated`, `unchanged`,
`disabled`, `uninstalled`, `not-installed`), canonical root, registry
written flag, materialized/removed paths, enabled state, and the
`preservesCanonicalWorkspaceData: true` plus `trackedOsFilesMutated: []`
invariants. Errors use `AiVerseDataLifecycleError`, remapping every
`AiVerseDataExtensionInstallError` code one-to-one plus
`EXTENSION_NOT_INSTALLED`.

## 4. Safety reuse

Lifecycle reuses rather than reimplements:

- Task 19 compatibility gate: `no-os` and `incompatible` fail closed,
  no standalone masking;
- Task 20 registry lock: exclusive create, never stolen, re-read inside
  the lock, raw-text lost-update check, same-directory temp plus rename;
- Task 20 path validators: absolute, drive, UNC, traversal, dot,
  empty, NUL rejection; symlink traversal rejection;
- Task 20 preservation: unknown top-level, unrelated entries, unknown
  own-entry fields, existing `enabled: false`, unknown safe owned-dir
  files left alone except the three owned files on uninstall.

Disable and uninstall perform their registry mutation under the same
lock with the same atomic replace and post-commit verification as Task 20.
Uninstall verifies the Data key is gone after commit; disable verifies
`enabled === false` after commit.

## 5. Database preservation

Lifecycle never creates, opens, migrates, repairs, or rebounds a
workspace database. Verified by the suite asserting zero `.sqlite`
files appear from lifecycle alone, and by byte comparison of seeded
databases across disable, update, and uninstall. Reinstall after
uninstall reopens preserved compatible databases through the normal
Task 21 path, which lifecycle never invokes implicitly.

## 6. Installation order and coexistence

OS owns the hook and contract; Data owns only its entry and files.
Missing siblings never block lifecycle. The registry writer preserves
unknown top-level and other-entry state byte-semantically across
OS-first, Memory-first, Brain-first, Bots-first, and Skills-first
orders. Big-machine workspace IDs follow the same host pattern and are
never enumerated by lifecycle.

## 7. Deliberately not implemented

Task 23 does not implement:

- purge of canonical Data (separate destructive operation);
- Task 24 doctor or status commands;
- workspace database initialization or discovery invocation;
- health or permission assertions from registration;
- permanent `AGENTS.md` blocks;
- sibling repository changes.

## 8. Acceptance

Task 23 proves install composes the Task 20 primitive idempotently,
update preserves `enabled: false` plus unknown state, disable flips
only `enabled` with files and databases byte-identical, uninstall
removes only owned state with databases and unrelated entries intact,
incompatible and missing hosts fail closed, CLI exit codes and next-step
hints hold, registry-busy and symlink states fail closed, lifecycle
creates zero databases, and install orders coexist.
