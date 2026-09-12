# AI-Verse Data Phase 5 Status

**Phase:** 5 - Release Hardening
**Phase status:** IN PROGRESS
**Implementation tasks completed:** 3 / 6
**Overall implementation tasks completed:** 38 / 41
**Next:** Task 39 / 41, Phase 5.4 - Documentation/examples

This document records implementation evidence for Phase 5. `docs/BUILD-MAP.md` remains the canonical project-wide task order.

## Phase 5 goal

Phase 5 hardens the verified Data engine plus native integration plus
ecosystem adapters for first release without changing canonical
ownership boundaries.

Phase 5 must preserve:

- scope-first trusted access with no raw paths or SQL;
- host-bound actor and authorization on every operation;
- engine-verbatim ceilings, digests, receipts, and provenance;
- no cross-workspace transactions;
- no automatic Memory writes;
- no purge automation;
- consumer-side adoption through separately approved tasks.

---

## Task 36 / 41 - Phase 5.1 Cross-platform CI matrix

**Implementation status:** COMPLETE

Phase 5.1 extends CI from Linux-only Node 22/24 to a full
operating-system by Node matrix with package plus install smoke
proof and no new engine.

Core guarantees:

- `.github/workflows/ci.yml` matrix covers
  `ubuntu-latest`, `macos-latest`, and `windows-latest`
  crossed with Node 22 and Node 24;
- every matrix leg runs `npm run check` (build plus full suite);
- every matrix leg runs `npm pack --dry-run` package proof;
- every matrix leg runs `node dist/src/cli.js --help` CLI smoke;
- every matrix leg runs `npm pack --pack-destination <runner-temp>`
  install-artifact smoke;
- no new engine, no new `src/` surface, no test changes;
- no sibling edits, no deletions.

Local smoke proof (this host, Node 22):

- `npm run build`: PASS;
- `npm pack --dry-run`: PASS, 490 files, 255.0 kB package,
  1.4 MB unpacked;
- `node dist/src/cli.js --help`: PASS, stable usage tokens;
- `npm pack --pack-destination <tmpdir>`: PASS (CI leg; local
  equivalent is the `npm pack --dry-run` tarball detail above).

### Deliberately not implemented

Task 5.1 does not implement:

- adversarial filesystem/security suites (Task 37);
- performance baselines (Task 38);
- documentation/examples (Task 39);
- packaging/install-command changes (Task 40);
- release acceptance (Task 41).

Task 37 / 41 was next at that boundary (now COMPLETE, see below).

### Task 5.1 gate

**PASSED.**

---

## Task 37 / 41 - Phase 5.2 Full adversarial filesystem/security suite

**Implementation status:** COMPLETE

Phase 5.2 adds `test/adversarial-security.test.ts` with 8 fail-closed
attack tests over existing primitives with no new engine.

Core guarantees:

- traversal segments rejected (`WORKSPACE_ID_UNSAFE`,
  `INVALID_EXTENSION_PATH`, NUL roots);
- symlink components refuse escape (`PATH_SYMLINK_UNSAFE`);
- Windows drive/UNC/reserved/trailing/unsafe paths rejected;
- 8 malformed registry shapes fail closed with no owned files;
- 30-day-aged stale locks never stolen, lock file preserved;
- oversized registry/record/bulk/key ceilings fail closed;
- 4 corrupt database shapes fail closed with bytes preserved;
- capability escalation, unknown actions, wildcard smuggling,
  unknown-field injection, and oversized auth refs all denied;
- every branch asserts no mutation: registries byte-identical,
  stale locks preserved, corrupt bytes preserved, events unchanged,
  no prototype pollution;
- no sibling edits, no deletions.

Local proof (this host, Node 22):

- focused file: 8 / 8 PASS;
- full `npm test`: 337 / 337 PASS.

### Deliberately not implemented

Task 5.2 does not implement:

- performance baselines (Task 38);
- documentation/examples (Task 39);
- packaging/install-command changes (Task 40);
- release acceptance (Task 41).

Task 38 / 41 was next at that boundary (now COMPLETE, see below).

### Task 5.2 gate

**PASSED.**

---

## Task 38 / 41 - Phase 5.3 Performance baseline

**Implementation status:** COMPLETE

Phase 5.3 adds `test/performance-baseline.test.ts` with 6 budget
tests over existing primitives with no new engine and no tuning.

Core guarantees:

- cold open, 50 creates plus single update, query plus aggregate
  on 200 records, 5-op transaction plus 20-op bulk preview/execute,
  bounded event pages on 100 records, native doctor plus status;
- budgets set from measured local numbers with 10-50x headroom
  (open 5000ms, creates50 30000ms, update 2000ms, query 5000ms,
  aggregate 5000ms, transaction 10000ms, bulk preview 15000ms,
  bulk execute 30000ms, events 10000ms, doctor 15000ms,
  status 10000ms);
- measure only: no optimization, no behavior change;
- no sibling edits, no deletions.

Local proof (this host, Node 22):

- focused file: 6 / 6 PASS;
- full `npm test`: 343 / 343 PASS.

### Deliberately not implemented

Task 5.3 does not implement:

- documentation/examples (Task 39);
- packaging/install-command changes (Task 40);
- release acceptance (Task 41).

Task 39 / 41 is next.

### Task 5.3 gate

**PASSED.**

---

## Remaining Phase 5 tasks

| Overall task | Phase task | Status | Purpose |
|---|---|---|---|
| 36 / 41 | 5.1 | COMPLETE | Cross-platform CI matrix |
| 37 / 41 | 5.2 | COMPLETE | Adversarial filesystem/security suite |
| 38 / 41 | 5.3 | COMPLETE | Performance baseline |
| 39 / 41 | 5.4 | NOT STARTED | Documentation/examples |
| 40 / 41 | 5.5 | NOT STARTED | Packaging and simple install command |
| 41 / 41 | 5.6 | NOT STARTED | Full release acceptance suite |

## Current boundary

Task 39 / 41 is next.

Do not begin Task 39 until Task 38 is implemented, verified, committed, logged in `docs/CONTINUATION-HANDOFF.md`, and reported complete.
