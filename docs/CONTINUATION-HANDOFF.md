# AI-Verse Data Continuation Handoff

**Updated:** 2026-09-12  
**Repository:** `aiverse-filmmakers/AI-Verse-Data`  
**Branch:** `main`  
**Purpose:** Fast, canonical resume point for a new chat or coding session.

## Current position

```text
Phase 0  Product + Architecture        COMPLETE
Phase 1  Core Data Engine              COMPLETE  9 / 9
Phase 2  Reliability + Agent Safety    COMPLETE  9 / 9
Phase 3  Native AI-Verse Integration   COMPLETE  8 / 8
Phase 4  Ecosystem Adapters            IN PROGRESS  7 / 9

Overall implementation: 33 / 41 tasks complete
```

## Latest completed task

**Task 33 / 41 - Phase 4.7: Connections authority boundary**

Implemented through Task 33:

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
- seeded databases byte-identical across lifecycle plus reinstall;
- complete Phase 3 native installation acceptance gate with all 20 checklist items;
- CRM story with receipts, OCC, query, aggregates, transactions, events, reopen, and isolation;
- negative branches fail closed without mutation;
- stable typed Data client SDK over the protocol with no new engine;
- scope-first trusted access with no raw paths or SQL;
- host-bound actor and authorization on every operation;
- engine-verbatim ceilings, digests, receipts, and provenance;
- no consumer-repository changes.
- leased Bot/Worker access over the Task 27 client with no new engine;
- host-passed trusted lease with workspace, principal, task,
  capabilities, expiry, and artifact ref;
- every call re-checks workspace, principal, capability cover, and
  expiry, failing closed;
- lease capabilities must also be host-granted refs, so model-written
  strings never grant access;
- delegation only reduces authority, with Bot/Worker provenance and
  task-linked receipts referenceable in Artifacts;
- no lease issuance, no Bots-side writes, no sibling edits.
- read-only Brain answers over the Task 27 client with no new engine;
- bounded query plus aggregates with question provenance and no goal
  copy;
- no mutations, no Brain-goal persistence, Brain objects stay
  Brain-owned;
- no Task 30+ adapters early, no sibling edits.
- stable `data://` references plus evidence lookup with no new
  engine;
- record, event, and aggregate-summary candidates as proposals
  only;
- no automatic Memory writes of any kind; Data events stay audit
  facts;
- no Task 31+ adapters early, no sibling edits.
- read-only Dashboard projections over the Task 27 client with no
  new engine;
- spaces, tables, details, relations, charts, events, health with
  provenance;
- no raw DB paths, `systemId` stays Dashboard-local, caches
  derived only;
- no Task 32+ adapters early, no sibling edits.
- manifest-shaped App declarations plus scoped kit with no new
  engine;
- host-granted refs only, model-written manifests never grant
  access;
- delete never granted, grants only reduce authority;
- schema-origin tracking without record ownership transfer;
- uninstall removes app only, canonical records preserved, no
  purge;
- no Task 33+ adapters early, no sibling edits.
- local-vs-external authority metadata plus explicit one-way
  imports with no new engine;
- `local_canonical` now, four future classes named but not
  built, no sync engine;
- external IDs plus provenance preserved, reads stay local, no
  silent copying, no implicit bidirectional sync;
- no Task 34+ behavior early, no sibling edits.

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

Detailed Task 26 contract:

`docs/PHASE-3-ACCEPTANCE.md`

Detailed Task 27 contract:

`docs/CLIENT-SDK-V0.1.md`

Detailed Task 28 contract:

`docs/BOTS-DATA-ADAPTER-V0.1.md`

Detailed Task 29 contract:

`docs/BRAIN-DATA-ADAPTER-V0.1.md`

Detailed Task 30 contract:

`docs/MEMORY-BRIDGE-V0.1.md`

Detailed Task 31 contract:

`docs/DASHBOARD-PROJECTION-V0.1.md`

Detailed Task 32 contract:

`docs/APPS-DATA-CONTRACT-V0.1.md`

Detailed Task 33 contract:

`docs/CONNECTIONS-AUTHORITY-V0.1.md`

Behavioral implementation verification (Task 33 local; exact-head CI cited on push):

```text
Node 22:             PASS (local)
Tests:               323 / 323 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

Prior Task 26 merged-main verification:

```text
Main head:           78d8fbb
GitHub Actions run:  34680605380
Node 22:             PASS
Node 24:             PASS
Tests:               288 / 288 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

Implemented through Task 33:

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

`docs/PHASE-3-STATUS.md` (Phase 3 COMPLETE) and `docs/PHASE-4-STATUS.md` (Phase 4 IN PROGRESS)

Task 27 local verification: 295 / 295 PASS on Node 22; exact-head CI cited on push.

Task 28 local verification: 301 / 301 PASS on Node 22; exact-head CI cited on push.

Task 29 local verification: 305 / 305 PASS on Node 22; exact-head CI cited on push.

Task 30 local verification: 309 / 309 PASS on Node 22; exact-head CI cited on push.

Task 31 local verification: 313 / 313 PASS on Node 22; exact-head CI cited on push.

Task 32 local verification: 319 / 319 PASS on Node 22; exact-head CI cited on push.

Task 33 local verification: 323 / 323 PASS on Node 22; exact-head CI cited on push.

## NEXT

**Task 34 / 41 - Phase 4.8: Automation event adapter**

Committed Data event subscription for OS activation/automation without adding a scheduler to Data.

Do not start Task 35 until Task 34 is explicitly tasked.

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

## Task 26 architectural laws

Task 26 must preserve:

1. No new engine or CLI; the gate composes Tasks 19-25 verbatim.
2. All 20 installation checklist items on one real fixture.
3. CRM story with receipts, OCC, query, aggregates, transactions, events, reopen, and isolation.
4. Sibling preservation with unknown state and enabled:false respected.
5. Uninstall plus reinstall with identical bytes; tracked files identical.
6. Isolated negative branches fail closed without mutation.
7. Lock contention fails closed; no purge; no Phase 4 SDK.
8. Full suite green with inherited Phase 1 plus Phase 2 gates.
9. Exact-head CI cited before declaring complete.
10. No sibling repository modifications are permitted.

## Task 28 architectural laws

Task 28 must preserve:

1. Leased access composes the Task 27 client verbatim with no new engine or storage.
2. The lease is a host-passed trusted object; Data never issues leases or verifies Bots signatures.
3. Every call re-checks lease workspace, principal, capability cover, and expiry, failing closed.
4. Every lease capability must also be present in the host-granted client `authorization.capabilityRefs`; model-written strings never grant access.
5. Delegation reduces authority and never increases it; reads stay reads, writes need write cover, no cross-workspace access.
6. Bot/Worker and task IDs appear in actor plus provenance; mutation receipts are referenceable in Artifacts without duplicating records.
7. No approval/Room/Team-Run writes, no Memory auto-write, no systemId identity, no raw SQL/paths, no registry/OS mutation, no purge.
8. Full suite green with inherited Phase 1 plus Phase 2 plus Phase 3 gates.
9. Exact-head CI cited before declaring complete.
10. No sibling repository modifications are permitted.

## Task 29 architectural laws

Task 29 must preserve:

1. Read-only answers compose the Task 27 client verbatim with no new engine or storage.
2. Bounded query plus aggregates only; no create/update/delete/transaction/bulk-execute/backup/migration paths are exposed.
3. Every answer carries question provenance with answered-at time, scope, actor, authorization, and record count.
4. Engine ceilings, cursors, validation, and stable envelopes reused verbatim, with ceiling fail-closed.
5. No Brain-goal persistence of any kind; Brain's canonical strategic object stays Brain-owned.
6. No copying Data into Brain state; Brain requests bounded current state and reasons over the returned answer.
7. No Memory auto-write, no systemId identity, no raw SQL/paths, no registry/OS mutation, no cross-workspace access, no purge.
8. Full suite green with inherited Phase 1 plus Phase 2 plus Phase 3 gates.
9. Exact-head CI cited before declaring complete.
10. No sibling repository modifications are permitted.

## Task 30 architectural laws

Task 30 must preserve:

1. References, evidence, and candidates compose the Task 27 client verbatim with no new engine or storage.
2. Stable `data://` references with strict parse; unknown extras and malformed shapes fail closed.
3. Evidence re-opens live records, events, and receipts by reference or by exactly one key; misses fail closed.
4. Cross-workspace evidence is denied; isolation is enforced technically.
5. Candidates are proposals only with title, summary, provenance, and expiry; they write no Memory entries and no Data events.
6. No automatic Memory writes of any kind; Data events stay audit facts.
7. No Memory index use as Data authority; no Data database treated as disposable cache.
8. Full suite green with inherited Phase 1 plus Phase 2 plus Phase 3 gates.
9. Exact-head CI cited before declaring complete.
10. No sibling repository modifications are permitted.

## Task 31 architectural laws

Task 31 must preserve:

1. Read-only projections compose the Task 27 client verbatim with no new engine or storage.
2. Spaces, tables, details, relations, charts, events, receipts, and health only; no mutation paths are exposed.
3. Tables bind schema plus page plus provenance; forms expose field metadata only; details resolve declared references with null on miss.
4. Every bounded answer carries generated-at time, scope, actor, authorization, and record count.
5. Engine ceilings, cursors, validation, and stable envelopes reused verbatim, with ceiling fail-closed.
6. No raw DB paths anywhere; `systemId` stays Dashboard-local; metadata carries no `databasePath`; caches stay derived and disposable.
7. No Memory auto-write, no raw SQL/paths, no registry/OS mutation, no cross-workspace access, no purge.
8. Full suite green with inherited Phase 1 plus Phase 2 plus Phase 3 gates.
9. Exact-head CI cited before declaring complete.
10. No sibling repository modifications are permitted.

## Task 32 architectural laws

Task 32 must preserve:

1. Manifest-shaped declarations plus scoped kit compose the Task 27 client verbatim with no new engine or storage.
2. Every manifest capability must also be host-granted as `data:<space>:<entity>:<cap>` refs; model-written manifests never grant access.
3. Read/create/update only with delete never granted; grants reduce authority and never increase it.
4. Schema-origin tracking without record ownership transfer; canonical records stay Data-owned.
5. Uninstall removes app only with canonical records preserved and no purge automation.
6. Engine ceilings, digests, OCC, idempotency, receipts, and stable envelopes reused verbatim.
7. No raw SQL/paths, no Memory auto-write, no systemId identity, no registry/OS mutation, no cross-workspace kits, no purge.
8. Full suite green with inherited Phase 1 plus Phase 2 plus Phase 3 gates.
9. Exact-head CI cited before declaring complete.
10. No sibling repository modifications are permitted.

## Task 33 architectural laws

Task 33 must preserve:

1. Local-vs-external metadata plus explicit imports compose the Task 27 client verbatim with no new engine or storage.
2. `local_canonical` now with four future classes named but not built; no sync engine of any kind.
3. Strict `connections://` source refs with round-trip parse; malformed shapes fail closed.
4. Explicit one-way imports with external IDs plus authority plus direction plus URI preserved in record source refs with Data provenance.
5. Reads and bounded queries stay local; no silent copying and no implicit bidirectional sync.
6. Idempotent retries replay-safe; conflicts fail closed with stable codes.
7. No Connections-side credential/transport behavior, no Memory auto-write, no systemId identity, no raw SQL/paths, no registry/OS mutation, no cross-workspace access, no purge.
8. Full suite green with inherited Phase 1 plus Phase 2 plus Phase 3 gates.
9. Exact-head CI cited before declaring complete.
10. No sibling repository modifications are permitted.

## Task 27 architectural laws

Task 27 must preserve:

1. No new engine or storage; the client composes existing engines verbatim.
2. Scope-first trusted access with no raw paths or SQL.
3. Host-bound actor and authorization on every operation.
4. Engine-verbatim ceilings, digests, receipts, and provenance.
5. Stable protocol envelopes and error codes.
6. No Dashboard `systemId` identity and no Memory auto-write.
7. No consumer-repository changes and no registry or OS mutation.
8. No cross-workspace transactions and no purge automation.
9. Task 27 must not implement Task 28-34 adapters early.
10. No sibling repository modifications are permitted.

## Canonical documents to read before Task 28

1. `docs/CONTINUATION-HANDOFF.md`
2. `docs/BUILD-MAP.md`
3. `docs/PHASE-4-STATUS.md`
4. `docs/CLIENT-SDK-V0.1.md`
5. `docs/PROTOCOL-V0.1.md`
6. `docs/SECURITY-AND-AUTHORITY.md`
7. `docs/INSTALLATION-AND-LIFECYCLE.md`
8. `docs/ECOSYSTEM-INTEGRATION.md`
9. `docs/DATA-MEMORY-BOUNDARY.md`
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
