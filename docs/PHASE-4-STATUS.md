# AI-Verse Data Phase 4 Status

**Phase:** 4 - Ecosystem Adapters
**Phase status:** IN PROGRESS
**Implementation tasks completed:** 7 / 9
**Overall implementation tasks completed:** 33 / 41
**Next:** Task 34 / 41, Phase 4.8 - Automation event adapter

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

Task 29 / 41 was next at that boundary (now COMPLETE).

### Task 4.2 gate

**PASSED.**

---

## Task 29 / 41 - Phase 4.3 Brain structured-data adapter contract

**Implementation status:** COMPLETE

Phase 4.3 adds read-only Brain answers over the Task 27 client with
no new engine and no new storage.

Core guarantees:

- `createBrainDataAdapter(client)` under `@ai-verse/data/brain`;
- space get/list/summarize, schema get/list/summarize, record
  get/list, bounded query (`ask`) plus aggregates (`summarize`),
  provenance events plus receipts, and health reads only;
- every answer carries question provenance with answered-at time,
  scope, actor, authorization, and record count;
- engine ceilings, cursors, validation, and stable envelopes reused
  verbatim, with ceiling fail-closed;
- no mutations of any kind, no Brain-goal persistence, Brain's
  canonical strategic object stays Brain-owned, no copying Data into
  Brain state;
- no Memory auto-write, no systemId identity, no raw SQL/paths, no
  registry/OS mutation, no cross-workspace access, no purge.

Detailed contract: `docs/BRAIN-DATA-ADAPTER-V0.1.md`.

### Deliberately not implemented

Task 4.3 does not implement:

- Memory, Dashboard, Apps, Connections, or automation adapters;
- Brain-side goal/reasoning behavior;
- consumer-side adoption in any sibling repository;
- new storage drivers or authority models.

Task 30 / 41 was next at that boundary (now COMPLETE).

### Task 4.3 gate

**PASSED.**

---

## Task 30 / 41 - Phase 4.4 Memory provenance/candidate bridge

**Implementation status:** COMPLETE

Phase 4.4 adds stable references, evidence lookup, and
candidate-memory proposals over the Task 27 client with no new
engine and no new storage.

Core guarantees:

- `createMemoryBridge(client)` under `@ai-verse/data/memory`;
- stable `data://` references plus strict parse with workspace,
  space, entity, record, version, event, and receipt;
- evidence re-opens live records, events, and receipts by
  reference or by exactly one of event, receipt, or idempotency
  key, with cross-workspace denial and fail-closed misses;
- record, event, and aggregate-summary candidates with title,
  summary, provenance, and expiry as proposals only;
- no automatic Memory writes of any kind; Data events stay audit
  facts;
- no Memory SQLite index use as Data authority, no Data database
  treated as disposable cache;
- no raw SQL/paths, no registry/OS mutation, no cross-workspace
  access, no purge.

Detailed contract: `docs/MEMORY-BRIDGE-V0.1.md`.

### Deliberately not implemented

Task 4.4 does not implement:

- Dashboard, Apps, Connections, or automation adapters;
- Memory-side entry creation or Memory behavior;
- consumer-side adoption in any sibling repository;
- new storage drivers or authority models.

Task 31 / 41 was next at that boundary (now COMPLETE).

### Task 4.4 gate

**PASSED.**

---

## Task 31 / 41 - Phase 4.5 Dashboard projection adapter

**Implementation status:** COMPLETE

Phase 4.5 adds read-only Dashboard projections over the Task 27
client with no new engine and no new storage.

Core guarantees:

- `createDashboardProjection(client)` under
  `@ai-verse/data/dashboard`;
- space get/list/card, schema get/list/form, bounded table views,
  record detail with resolved references plus list, aggregate
  charts, event history, receipt views, and health summaries, all
  with provenance;
- tables bind schema plus page plus provenance in one envelope;
  forms expose field name/type/required/default only;
- engine ceilings, cursors, validation, and stable envelopes
  reused verbatim, with ceiling fail-closed;
- no raw DB paths anywhere; `systemId` stays Dashboard-local and
  metadata carries no `databasePath`; Dashboard caches stay
  derived and disposable;
- no mutations, no Memory auto-write, no raw SQL/paths, no
  registry/OS mutation, no cross-workspace access, no purge.

Detailed contract: `docs/DASHBOARD-PROJECTION-V0.1.md`.

### Deliberately not implemented

Task 4.5 does not implement:

- Apps, Connections, or automation adapters;
- Dashboard-side gateway/UI behavior;
- consumer-side adoption in any sibling repository;
- new storage drivers or authority models.

Task 32 / 41 was next at that boundary (now COMPLETE).

### Task 4.5 gate

**PASSED.**

---

## Task 32 / 41 - Phase 4.6 Apps Data contract

**Implementation status:** COMPLETE

Phase 4.6 adds manifest-shaped App declarations plus a scoped kit
over the Task 27 client with no new engine and no new storage.

Core guarantees:

- `createAppsDataKit(client, manifest, options?)` under
  `@ai-verse/data/apps`;
- manifest declares app, workspace scope, spaces/schemas, and
  read/create/update capabilities;
- every manifest capability must also be host-granted as
  `data:<space>:<entity>:<cap>` refs, so model-written manifests
  never grant access;
- delete is never granted; grants reduce authority and never
  increase it;
- schema-origin tracking without record ownership transfer;
- uninstall removes app only with canonical records preserved
  and no purge;
- engine ceilings, digests, OCC, idempotency, receipts, and
  stable envelopes reused verbatim;
- no raw SQL/paths, no Memory auto-write, no systemId identity,
  no registry/OS mutation, no cross-workspace kits, no purge.

Detailed contract: `docs/APPS-DATA-CONTRACT-V0.1.md`.

### Deliberately not implemented

Task 4.6 does not implement:

- Connections or automation adapters;
- Apps-side runtime/UI behavior;
- consumer-side adoption in any sibling repository;
- new storage drivers or authority models.

Task 33 / 41 was next at that boundary (now COMPLETE).

### Task 4.6 gate

**PASSED.**

---

## Task 33 / 41 - Phase 4.7 Connections authority boundary

**Implementation status:** COMPLETE

Phase 4.7 draws the local-vs-external line over the Task 27
client with no new engine and no new storage.

Core guarantees:

- `createConnectionsAuthority(client)` under
  `@ai-verse/data/connections`;
- `local_canonical` now with `external_canonical`,
  `replicated`, `snapshot`, and `derived` named but not built;
- strict `connections://` source refs with round-trip parse;
- explicit one-way imports with external IDs plus authority
  plus direction plus URI preserved in record source refs;
- idempotent retries replay-safe; reads and bounded queries
  stay local;
- no silent copying, no implicit bidirectional sync, no sync
  engine of any kind;
- no raw SQL/paths, no Memory auto-write, no systemId
  identity, no registry/OS mutation, no cross-workspace
  access, no purge.

Detailed contract: `docs/CONNECTIONS-AUTHORITY-V0.1.md`.

### Deliberately not implemented

Task 4.7 does not implement:

- automation adapters or sync engines;
- Connections-side credential/transport behavior;
- consumer-side adoption in any sibling repository;
- new storage drivers or authority models.

Task 34 / 41 is next.

### Task 4.7 gate

**PASSED.**

---

## Remaining Phase 4 tasks

| Overall task | Phase task | Status | Purpose |
|---|---|---|---|
| 27 / 41 | 4.1 | COMPLETE | Typed Data client SDK |
| 28 / 41 | 4.2 | COMPLETE | Multiple Bots Data adapter |
| 29 / 41 | 4.3 | COMPLETE | Brain structured-data adapter contract |
| 30 / 41 | 4.4 | COMPLETE | Memory provenance/candidate bridge |
| 31 / 41 | 4.5 | COMPLETE | Dashboard projection adapter |
| 32 / 41 | 4.6 | COMPLETE | Apps Data contract |
| 33 / 41 | 4.7 | COMPLETE | Connections authority boundary |
| 34 / 41 | 4.8 | NEXT | Automation event adapter |
| 35 / 41 | 4.9 | NOT STARTED | Phase 4 gate |

## Current boundary

Task 34 / 41 is next.

Do not begin Task 35 until Task 34 is implemented, verified, committed, logged in `docs/CONTINUATION-HANDOFF.md`, and reported complete.
