# AI-Verse Data Phase 4 Status

**Phase:** 4 - Ecosystem Adapters
**Phase status:** IN PROGRESS
**Implementation tasks completed:** 2 / 9
**Overall implementation tasks completed:** 28 / 41
**Next:** Task 29 / 41, Phase 4.3 - Brain structured-data adapter contract

This document records implementation evidence for Phase 4. `docs/BUILD-MAP.md` remains the canonical project-wide task order.

## Phase 4 goal

Phase 4 exposes the verified Data engine to ecosystem consumers through
explicit Data-side contracts without changing consumer repositories and
without duplicating canonical state.

Phase 4 must preserve:

- scope-first trusted access with no raw paths or SQL;
- host-bound actor and authorization on every operation;
- engine-verbatim ceilings, digests, receipts, and provenance;
- no cross-workspace transactions;
- no automatic Memory writes;
- no purge automation;
- consumer-side adoption through separately approved tasks.

---

## Task 27 / 41 - Phase 4.1 Typed Data client SDK

**Implementation status:** COMPLETE

Phase 4.1 adds a stable typed client over the `ai-verse-data/0.1`
protocol with no new engine and no new storage.

Core guarantees:

- `createDataClient({ scope, actor, authorization })` under
  `@ai-verse/data/client`;
- trusted `DataDatabaseScope` required; raw paths and SQL rejected;
- binding-verified open with `DATABASE_SCOPE_CONFLICT` fail-closed;
- typed spaces, schemas, records, query, aggregates, transactions,
  bulk preview plus execute, provenance events plus receipts,
  backup and export/import, schema-migration preview plus execute,
  and health;
- engine-verbatim validation, optimistic concurrency, idempotency,
  receipts, 50-operation transaction cap, 50-operation and 256 KiB
  bulk cap with digest gate, bounded query AST, and migration
  approval split;
- stable protocol envelopes and error codes;
- no Dashboard `systemId` identity, no Memory auto-write, no
  consumer-repo writes, no registry or OS mutation, no
  cross-workspace transactions, no purge automation.

Detailed contract: `docs/CLIENT-SDK-V0.1.md`.

### Deliberately not implemented

Task 4.1 does not implement:

- Multiple Bots, Brain, Memory, Dashboard, Apps, Connections, or
  automation adapters;
- consumer-side adoption in any sibling repository;
- new storage drivers or authority models.

Task 28 / 41 was next at that boundary (now COMPLETE).

### Task 4.1 gate

**PASSED.**

---

## Task 28 / 41 - Phase 4.2 Multiple Bots Data adapter

**Implementation status:** COMPLETE

Phase 4.2 adds leased Bot/Worker access over the Task 27 client with
no new engine and no new storage.

Core guarantees:

- `createBotsDataAdapter(client, lease)` under `@ai-verse/data/bots`;
- host-passed trusted lease with workspace, Bot/Worker principal,
  task ID, `data:<space>:<entity>:<action>` capabilities, optional
  expiry and artifact ref;
- every call re-checks lease workspace, principal, capability cover,
  and expiry, failing closed;
- every lease capability must also be present in the host-granted
  client `authorization.capabilityRefs`, so model-written strings
  never grant access;
- delegation reduces authority and never increases it;
- Bot/Worker provenance through reused engines with task-linked
  receipts referenceable in Artifacts;
- no lease issuance or Bots-signature verification inside Data, no
  approval/Room/Team-Run writes, no Memory auto-write, no systemId
  identity, no raw SQL/paths, no registry/OS mutation, no
  cross-workspace access, no purge automation.

Detailed contract: `docs/BOTS-DATA-ADAPTER-V0.1.md`.

### Deliberately not implemented

Task 4.2 does not implement:

- Brain, Memory, Dashboard, Apps, Connections, or automation
  adapters;
- lease issuance or Bots-side approval/Room/Team-Run behavior;
- consumer-side adoption in any sibling repository;
- new storage drivers or authority models.

Task 29 / 41 is next.

### Task 4.2 gate

**PASSED.**

---

## Remaining Phase 4 tasks

| Overall task | Phase task | Status | Purpose |
|---|---|---|---|
| 27 / 41 | 4.1 | COMPLETE | Typed Data client SDK |
| 28 / 41 | 4.2 | COMPLETE | Multiple Bots Data adapter |
| 29 / 41 | 4.3 | NEXT | Brain structured-data adapter contract |
| 30 / 41 | 4.4 | NOT STARTED | Memory provenance/candidate bridge |
| 31 / 41 | 4.5 | NOT STARTED | Dashboard projection adapter |
| 32 / 41 | 4.6 | NOT STARTED | Apps Data contract |
| 33 / 41 | 4.7 | NOT STARTED | Connections authority boundary |
| 34 / 41 | 4.8 | NOT STARTED | Automation event adapter |
| 35 / 41 | 4.9 | NOT STARTED | Phase 4 gate |

## Current boundary

Task 29 / 41 is next.

Do not begin Task 30 until Task 29 is implemented, verified, committed, logged in `docs/CONTINUATION-HANDOFF.md`, and reported complete.
