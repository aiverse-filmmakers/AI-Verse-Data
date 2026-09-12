# AI-Verse Native Doctor and Status v0.1

**Task:** 24 / 41
**Phase:** 3.6 - Native doctor + status
**Status:** IMPLEMENTED
**Public package surface:** `ai-verse-data` CLI plus `@ai-verse/data/native` health engine

This document defines read-only native health reporting over the
existing Task 19-23 primitives. Doctor and status never write the
registry, never touch tracked files, and never mutate canonical
workspace databases.

## 1. Purpose

Task 24 composes what already exists:

```text
Task 19  host compatibility (mode + issues)
Task 20  registry schema-1.0 read-only (own entry only)
Task 22  instruction presence (ready/disabled/not-installed)
Task 21  workspace resolve + seven-state discovery
Task 15  internal migration status (current/required/incomplete)
storage  diagnostics (format, binding, SQLite identity)
recovery quarantine + integrity semantics (read-only here)
Task 23  lifecycle state as reported facts (never invoked)
```

Health commands report only. They create zero `.sqlite` files, acquire
no locks, execute no engines, and change no schemas.

## 2. Commands

```bash
ai-verse-data doctor --root <os-root> [--workspace <id>] [--json]
ai-verse-data status --root <os-root> [--workspace <id>] [--json]
```

`--root` is required with no working-directory guessing. `--workspace`
is optional and ID-only. Missing `--root` exits 2. Unknown arguments
exit 2. A healthy report exits 0. A report with problems exits 1 with
stable problem codes plus next steps. `--json` prints the exact result
object.

`doctor` performs the deep check: SQLite runtime version, quick
`integrity_check(1)` for compatible databases, WAL directory
writability, unsafe path and readability checks. `status` is the light
check: same facts without opening the database for integrity or WAL
probes.

## 3. Engine API

```ts
doctorData({ rootPath, workspaceId? })
statusData({ rootPath, workspaceId? })
new AiVerseDataDoctor().doctor/status(...)
```

Results carry command, healthy flag, mode
(`ai-verse-os-v2`, `standalone`, `incompatible`), canonical root,
requested workspace id, host status plus issues, registration
(registry-exists, registered, installed, enabled, version),
instruction status, workspace identity plus database path, database
state plus detail plus format plus binding plus migration, SQLite
runtime version plus minimum check, integrity (doctor only), WAL
(doctor only), problems with next steps, notices, and the sibling
informational note.

## 4. Mode handling

Compatible hosts report `ai-verse-os-v2` with full facts. A missing or
ordinary root reports `standalone` as healthy with a notice; missing
siblings never block. An incompatible host reports `incompatible` as
unhealthy with no standalone masking and no further reads beyond the
SQLite runtime probe.

Untrusted roots, symlinked workspaces, unsafe manifests, ID mismatches,
and unknown workspace ids surface as problems with the same codes and
next steps as Tasks 19-21. Malformed registries, non-boolean entry
flags, oversized or symlinked extension files, and oversized hints
surface with the Task 20/22 codes. Discovery states map one-to-one:
compatible stays silent, missing and paused stay notices, migration,
quarantine, scope-conflict, unsupported, and unavailable become
problems. Recovery `migration_incomplete` stays migration-required and
`corrupt` stays quarantined, matching Task 21.

## 5. Read-only guarantees

Health checks never:

- write or lock the registry;
- create `.aiverse/` state;
- write tracked OS files;
- create, open for write, migrate, repair, promote, clear quarantine,
  rebind, or delete any database;
- execute the extension engine;
- enumerate all workspaces;
- load another extension's files;
- warn on missing optional siblings.

Fixtures are byte-identical after doctor and status. The suite asserts
zero new `.sqlite` files from health checks alone and byte-identical
seeded databases across every command.

## 6. Sibling and install-order behavior

OS owns the hook and contract; Data reports only. Unknown top-level
registry fields and unrelated entries are read past, never loaded, and
never modified. Any install order resolves through the same entry-state
check. Big-machine workspace ids follow the same host pattern and are
never enumerated.

## 7. Deliberately not implemented

Task 24 does not implement:

- Task 25 coexistence suite;
- Task 26 Phase 3 gate;
- purge or destructive removal;
- migration execution, repair, promotion, or quarantine clearing;
- permission or health assertions from registration;
- sibling repository changes.

## 8. Acceptance

Task 24 proves healthy full-stack reporting with deep integrity on
doctor only, disabled plus not-installed plus missing-registry states,
standalone versus incompatible modes, paused plus every discovery state,
corrupt quarantine with status skipping deep checks, symlink plus
unknown-id fail-closed behavior, CLI preservation with exit codes,
zero created databases, informational siblings, and the full suite.
