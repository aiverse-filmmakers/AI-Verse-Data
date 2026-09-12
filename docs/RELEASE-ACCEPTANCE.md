# AI-Verse Data Release Acceptance

**Status:** Canonical Task 41 / 41 acceptance proof
**Date:** 2026-09-12
**Gate task:** 41 / 41 - Phase 5.6

This document records the first-release acceptance proof.
`docs/BUILD-MAP.md` remains the canonical project-wide task order.

## 1. Gate composition

Task 41 adds no new engine and no new CLI. It composes the existing
Tasks 19-40 primitives verbatim through a dedicated end-to-end gate:

```text
test/release-acceptance.test.ts
```

The gate walks `docs/TESTING-AND-ACCEPTANCE.md` section 18 on one
real temporary OS fixture: fresh OS, install, workspace A init, CRM
space plus schemas, related records, query plus aggregates, safe
versioned update plus idempotent replay, simulated concurrent
conflict, backup with verify proof, restart plus exact reopen of
state/events/receipts, workspace B isolation, representative sibling
state surviving update, uninstall preserving the canonical database,
reinstall reopening verified records, tracked OS files byte-identical.

## 2. Preservation

Across the whole story:

- only `extensions["ai-verse-data"]` is created, changed, or removed;
- representative sibling state (`memory` with `custom_sibling`) preserved;
- seeded canonical bytes identical across update, uninstall, reinstall;
- tracked OS files byte-identical;
- no sibling repository modifications.

## 3. Verification

Full repository suite on the implementation host:

```text
351 / 351 PASS
0 failed
0 skipped
0 cancelled
```

Focused release file: 1 / 1 PASS.

Release gate: **PASSED.**
First release: **COMPLETE 41 / 41.**
Phase 5: **COMPLETE 6 / 6.**


## 4. Post-audit release hardening

A full source-level release audit on 2026-09-12 identified and repaired
adapter and delivery defects that were not covered by the original 344-test
gate. The hardening work preserves the 41-task implementation plan while
strengthening the shipped release.

Verified repairs:

- Apps cannot tunnel record deletion through transaction or bulk update grants;
- Apps, Bots, and Brain provenance reads stay inside their granted Data entities;
- Brain host-bound read capability references are enforced rather than treated as metadata;
- Memory resolves canonical events directly by event ID and no longer synthesizes placeholder evidence or depends on the first 200 events;
- Dashboard resolves cross-space references through the schema's `spaceId` and propagates unexpected lookup failures;
- `data.record.list` rejects unsupported cursors instead of silently ignoring them; cursor pagination remains on `data.query`;
- native uninstall validates owned files before mutation, removes registry state before files, and restores the previous installed state if post-commit file removal fails;
- installed extension instructions/metadata reflect the completed Phase 5.6 release;
- the materialized `engine.mjs` exposes a real `ai-verse-data-host/1.0` request handler over the public package rather than registration-only metadata;
- the installed engine acceptance test performs explicit workspace initialization and real create/query operations through the materialized extension boundary.

Cross-platform GitHub Actions proof at hardening head
`4d1c9ca899ecb55eba387d92e26c2e8a111ec8b9`:

```text
Run: 34700035814
Node 22: ubuntu PASS, macOS PASS, Windows PASS
Node 24: ubuntu PASS, macOS PASS, Windows PASS
351 / 351 PASS
0 failed
0 skipped
0 cancelled
```
