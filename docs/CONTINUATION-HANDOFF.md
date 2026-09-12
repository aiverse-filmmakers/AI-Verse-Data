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
Phase 3  Native AI-Verse Integration   IN PROGRESS  7 / 8

Overall implementation: 25 / 41 tasks complete
```

## Latest completed task

**Task 25 / 41 - Phase 3.7: Installation-order/registry coexistence suite**

Implemented through Task 25:

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
- ID-only native workspace resolution under `src/native`;
- exact `WORKSPACE.yaml` identity and status validation;
- active-only explicit workspace Data initialization;
- internally derived canonical workspace Data path;
- exact workspace binding on fresh databases;
- idempotent repeat initialization;
- seven-state existing-database discovery;
- no silent replace, migrate, repair, rebind, or quarantine clearing;
- read-only task-relevant extension instruction/runtime discovery;
- ready/disabled/not-installed instruction states with enabled:false respected;
- Data-owned instruction files only with byte-identical read-only proof;
- native CLI install/update/disable/uninstall with required `--root`;
- human plus `--json` output with exit 0/2/1 semantics;
- install/update reuse Task 20 lock plus atomic replace plus lost-update check;
- disable flips only the Data-owned `enabled` entry;
- uninstall removes only owned files plus the owned registry key;
- canonical databases byte-identical across lifecycle;
- zero `.sqlite` created by lifecycle alone;
- no purge, no Task 24 doctor/status.
- read-only native doctor plus status with deep integrity on doctor only;
- compatible, standalone, and incompatible modes with no masking;
- fixtures byte-identical with zero created databases;
- twelve order variants with Memory/Brain/Bots/Skills plus nested unknowns;
- full lifecycle per order with discovery plus health checks;
- only the owned registry key touched with siblings byte-identical;
- seeded databases byte-identical across lifecycle plus reinstall.

Detailed Task 21 contract:

`docs/WORKSPACE-RESOLVER-INITIALIZATION-V0.1.md`

Detailed Task 22 contract:

`docs/EXTENSION-INSTRUCTIONS-DISCOVERY-V0.1.md`

Detailed Task 23 contract:

`docs/NATIVE-CLI-LIFECYCLE-V0.1.md`

Detailed Task 24 contract:

`docs/NATIVE-DOCTOR-STATUS-V0.1.md`

Detailed Task 25 contract:

`docs/INSTALLATION-ORDER-COEXISTENCE-V0.1.md`

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

Implemented through Task 24:

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
- ID-only native workspace resolution under `src/native`;
- exact `WORKSPACE.yaml` identity and status validation;
- active-only explicit workspace Data initialization;
- internally derived canonical workspace Data path;
- exact workspace binding on fresh databases;
- idempotent repeat initialization;
- seven-state existing-database discovery;
- no silent replace, migrate, repair, rebind, or quarantine clearing.

Detailed Task 20 contract:

`docs/EXTENSION-MATERIALIZATION-REGISTRATION-V0.1.md`

Detailed Task 21 contract:

`docs/WORKSPACE-RESOLVER-INITIALIZATION-V0.1.md`

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

**Task 26 / 41 - Phase 3.8: Phase 3 gate**

Run the complete native installation acceptance story.

Do not start Phase 4 until Task 26 is fully implemented, tested, documented, merged, and the exact resulting `main` head has passing CI.

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

## Task 22 architectural laws

Task 22 must preserve:

1. Discovery starts from a Task 19-compatible trusted OS root; incompatible hosts fail closed with no standalone masking.
2. The schema-`1.0` registry is parsed read-only with no writes or locks.
3. Only `extensions["ai-verse-data"]` is read; unrelated entries are preserved and never loaded.
4. Boolean `supported` plus `installed` plus `enabled` gate; existing `enabled: false` is respected.
5. Instruction/engine/adapter paths resolve repo-relative inside the Data-owned extension directory only.
6. Traversal, absolute, drive, UNC, NUL, symlink, oversize, and unreadable states fail closed.
7. Contents plus provenance returned with task-hint relevance; engine file never executed.
8. No registry write, no tracked OS mutation, no workspace database created or opened.
9. Task 22 must not implement Task 23 CLI lifecycle or Task 24 doctor behavior early.
10. No sibling repository modifications are permitted.

## Task 23 architectural laws

Task 23 must preserve:

1. Lifecycle commands start from a Task 19-compatible trusted OS root; `no-os` and `incompatible` fail closed with no standalone masking.
2. `--root` is required with no working-directory guessing.
3. Install/update reuse the Task 20 installer verbatim (lock, in-lock re-read, raw-text lost-update check, atomic replacement).
4. Disable flips only the Data-owned `enabled` entry under lock; owned files plus canonical databases untouched.
5. Uninstall removes only Data-owned extension files plus the owned registry key; canonical databases, unrelated entries, and unknown state preserved.
6. Install orders with Memory, Brain, Multiple Bots, Skills metadata, and unrelated extensions preserved.
7. Lifecycle alone creates zero `.sqlite` files; no purge behavior.
8. No registry write beyond the owned entry; no tracked OS mutation.
9. Task 23 must not implement Task 24 doctor/status behavior early.
10. No sibling repository modifications are permitted.

## Task 24 architectural laws

Task 24 must preserve:

1. Health checks compose Tasks 19-23 verbatim with no new engine; read-only with respect to canonical records.
2. No registry write or lock, no tracked OS mutation, no database create, open-write, migrate, repair, promote, rebind, or quarantine clearing.
3. Compatible hosts report full facts; missing roots report standalone; incompatible hosts fail closed with no masking.
4. Only the owned registry entry is read; unrelated entries preserved and never loaded; siblings informational only.
5. Workspace identity is ID-only with Task 21 resolve plus seven-state discovery and Task 15 migration detail.
6. Doctor performs deep integrity plus WAL checks; status skips both.
7. Stable problem codes plus next steps; exit 0 healthy, 1 problems, 2 usage.
8. Fixtures byte-identical with zero created databases.
9. Task 24 must not implement the Task 25 coexistence suite early.
10. No sibling repository modifications are permitted.

## Task 25 architectural laws

Task 25 must preserve:

1. No new engine or CLI; the suite composes Tasks 19-24 verbatim.
2. Twelve order variants with Memory, Brain, Multiple Bots, Skills, enabled:false, nested unknowns, and the full order.
3. Full lifecycle per order with discovery plus health checks between steps.
4. Only the owned registry key created, changed, or removed; siblings byte-semantically identical.
5. Unknown top-level and per-entry fields including nested objects preserved.
6. Lifecycle alone creates zero `.sqlite` files; seeded databases byte-identical across lifecycle plus reinstall.
7. Compatible-root gate with no-os/incompatible fail-closed and no masking.
8. Lock contention fails closed with siblings present; no tracked OS mutation.
9. Task 25 must not implement the Task 26 Phase 3 gate early.
10. No sibling repository modifications are permitted.

## Canonical documents to read before Task 26

1. `docs/CONTINUATION-HANDOFF.md`
2. `docs/BUILD-MAP.md`
3. `docs/PHASE-3-STATUS.md`
4. `docs/INSTALLATION-AND-LIFECYCLE.md`
5. `docs/NATIVE-CLI-LIFECYCLE-V0.1.md`
6. `docs/NATIVE-DOCTOR-STATUS-V0.1.md`
7. `docs/INSTALLATION-ORDER-COEXISTENCE-V0.1.md`
8. `docs/WORKSPACE-RESOLVER-INITIALIZATION-V0.1.md`
9. `docs/EXTENSION-INSTRUCTIONS-DISCOVERY-V0.1.md`
10. `docs/CORRUPTION-AND-RECOVERY-V0.1.md`
11. `docs/SECURITY-AND-AUTHORITY.md`
12. `docs/TESTING-AND-ACCEPTANCE.md`

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
