# AI-Verse Data Continuation Handoff

**Updated:** 2026-09-11  
**Repository:** `aiverse-filmmakers/AI-Verse-Data`  
**Branch:** `main`  
**Purpose:** Fast, canonical resume point for a new chat or coding session.

## Current position

```text
Phase 0  Product + Architecture        COMPLETE
Phase 1  Core Data Engine              COMPLETE  9 / 9
Phase 2  Reliability + Agent Safety    COMPLETE  9 / 9
Phase 3  Native AI-Verse Integration   IN PROGRESS  2 / 8

Overall implementation: 20 / 41 tasks complete
```

## Latest completed task

**Task 20 / 41 - Phase 3.2: Hardened extension materialization/registration**

Behavioral implementation verification:

```text
Behavioral commit:   1e88ba758dcc1151b4de6f60e8c3b2a9822afad7
GitHub Actions run:  34606467549
Node 22:             PASS
Node 24:             PASS
Tests:               229 / 229 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

Task 19 final merged-main verification:

```text
Main head:           e810a664847b39d4eae211b4da6bbf5d1baca46e
GitHub Actions run:  34605503828
Node 22:             PASS
Node 24:             PASS
Tests:               216 / 216 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

Implemented through Task 20:

- complete host-neutral Data engine and Phase 2 reliability surface;
- read-only AI-Verse OS v2 compatibility detection;
- explicit `compatible`, `no-os`, and `incompatible` native host states;
- public `AiVerseDataExtensionInstaller`;
- read-only native installation planning;
- exact AI-Verse OS registry schema `1.0` validation;
- Data-owned materialization under `.aiverse/extensions/ai-verse-data/`;
- deterministic `INSTRUCTIONS.md`, `engine.mjs`, and `extension.json`;
- registration owns only `extensions["ai-verse-data"]`;
- unknown registry top-level state preserved;
- unrelated extension registrations preserved;
- unknown existing Data-entry fields preserved;
- existing `enabled: false` preserved;
- unknown safe files in the Data-owned extension directory preserved;
- exclusive `registry.json.lock`;
- lock is never stolen automatically;
- compatibility and registry are re-read inside the lock;
- exact raw-registry lost-update protection;
- same-directory temporary-file + rename registry replacement;
- verified atomic Data-owned file replacement;
- pre-registry-commit rollback of changed Data-owned files;
- rollback refuses destructive guessing after external file changes;
- absolute/traversal/drive/UNC/NUL path rejection;
- extension-root/file symlink rejection;
- persistent-state idempotent reinstall;
- no tracked OS file mutation;
- no workspace Data initialization.

Detailed Task 20 contract:

`docs/EXTENSION-MATERIALIZATION-REGISTRATION-V0.1.md`

Phase status:

`docs/PHASE-3-STATUS.md`

Documentation closeout candidate verification:

```text
Closeout head:       6aa470d536369b23ca5887714da16ffd1ed89fca
GitHub Actions run:  34607179121
Node 22:             PASS
Node 24:             PASS
Tests:               229 / 229 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

The Task 20 behavioral implementation and documentation closeout candidate are verified. The final Task 20 report must still verify the resulting exact branch head and then the exact merged `main` head before declaring Task 20 fully closed.

## NEXT

**Task 21 / 41 - Phase 3.3: Native workspace resolver + Data initialization**

Canonical Build Map scope:

```text
Trusted OS root
Exact workspace identity/status checks
Safe workspace Data path
Explicit initialization
Existing-DB discovery
```

The actual AI-Verse OS workspace manifest contract requires:

```yaml
schema_version: "2.0"
id: "<workspace-slug>"
name: "<non-empty>"
type: "<non-empty>"
status: active | paused | archived
purpose: "<string>"
```

The workspace schema allows additional fields.

Do not start Task 22 until Task 21 is fully implemented, tested, documented, merged, and the exact resulting `main` head has passing CI.

## Task 21 architectural laws

Task 21 must preserve:

1. Native workspace resolution starts from a Task 19-compatible trusted OS root. A caller supplies a workspace ID, never a raw workspace path or SQLite path.
2. Workspace IDs must follow the host contract `^[a-z0-9][a-z0-9-]*$` and remain safe as one filesystem segment.
3. The resolver may inspect only `workspaces/<requested-id>/`; it must not silently enumerate every workspace to guess identity.
4. The workspace directory must be a real non-symlink directory beneath the trusted OS root.
5. `WORKSPACE.yaml` must be a regular non-symlink bounded file and must satisfy the required AI-Verse OS workspace identity fields.
6. Workspace manifest schema major must be supported v2. Unknown/additive manifest fields remain tolerated.
7. Manifest `id` must exactly equal both the requested workspace ID and the directory identity. A copied/misplaced workspace fails closed.
8. `name` and `type` must be non-empty strings; `purpose` must be a string; malformed required fields fail closed.
9. Workspace `status` is one of `active`, `paused`, or `archived`. Resolution may report all valid statuses, but fresh Data initialization must require `active`; paused/archived workspaces must not silently receive a new database.
10. The only native canonical Data path is `workspaces/<id>/data/ai-verse-data.sqlite`, derived internally through trusted scope helpers.
11. Existing `data/` and database paths must reject symlink traversal and wrong filesystem types.
12. Explicit initialization affects only the requested active workspace. Task 21 must never create a Data database in every workspace as a side effect of installation or discovery.
13. Fresh initialization must reuse the existing workspace-scoped storage binding contract so the database embeds the exact workspace identity.
14. Repeated initialization of an already-compatible exact-binding database must be idempotent/discovery-safe rather than replacing it.
15. Existing database discovery must use the exact resolved workspace path only and distinguish at least missing, compatible/current, migration-required/incomplete, quarantined/corrupt, scope-conflict, unsupported, and unavailable states by reusing existing Data storage/recovery contracts where appropriate.
16. Existing databases must never be silently truncated, replaced, migrated, repaired, or rebound to a different workspace during discovery.
17. Task 21 must not implement Task 22 task-relevant extension instruction/runtime discovery early.
18. Task 21 must not add Task 23 native CLI lifecycle commands early.
19. No sibling repository modifications are permitted.

## Canonical documents to read before Task 21

1. `docs/CONTINUATION-HANDOFF.md`
2. `docs/BUILD-MAP.md`
3. `docs/PHASE-3-STATUS.md`
4. `docs/AI-VERSE-OS-COMPATIBILITY-V0.1.md`
5. `docs/EXTENSION-MATERIALIZATION-REGISTRATION-V0.1.md`
6. `docs/INSTALLATION-AND-LIFECYCLE.md`
7. `docs/SCOPE-AND-IDENTITY-V0.1.md`
8. `docs/CORRUPTION-AND-RECOVERY-V0.1.md`
9. `docs/SECURITY-AND-AUTHORITY.md`
10. `docs/TESTING-AND-ACCEPTANCE.md`

Before implementation, inspect the current AI-Verse OS workspace schema/template read-only to confirm the host contract has not changed. Do not modify the OS repository.

## Closeout rule for every future task

A task is not complete until all of the following are updated and committed:

- implementation/tests;
- task-specific contract or acceptance document when appropriate;
- `README.md`;
- `docs/BUILD-MAP.md`;
- active phase status file, currently `docs/PHASE-3-STATUS.md`;
- `docs/CONTINUATION-HANDOFF.md`;
- any older docs that would otherwise contradict the new implementation state.

The final report must cite the exact repository head and exact-head CI result.

## Repo boundaries

Work only in `AI-Verse-Data` unless a later task explicitly requires and the user separately approves a sibling-repo modification.

Do not silently modify:

- AI-Verse-OS
- AI-Verse-Brain
- AI-Verse-Memory
- AI-Verse-Skills
- AI-Verse-Multiple-Bots
- AI-Verse-Dashboard
- AI-Verse-Apps
- AI-Verse-Connections
