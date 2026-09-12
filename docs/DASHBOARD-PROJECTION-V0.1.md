# AI-Verse Dashboard Projection Adapter v0.1

**Task:** 31 / 41
**Phase:** 4.5 - Dashboard projection adapter
**Status:** IMPLEMENTED
**Public package surface:** `@ai-verse/data/dashboard`

This document defines the Data-side read-only projection surface
for Dashboard gateways. Data serves bounded views with proof; the
browser never opens the database.

## Design

`createDashboardProjection(client)` wraps a Task 27 client and
exposes only reads: space get/list/card, schema get/list/form,
bounded table views, record detail plus list, aggregate charts,
event history, receipt views, and a health summary. There is
deliberately no create, update, delete, transaction, bulk-execute,
backup, restore, migration-execute, or recovery surface.

Tables bind schema plus page plus provenance in one envelope so a
gateway can render without a second round trip. Record detail
resolves declared reference fields to their live targets (null when
missing) with provenance. Forms expose field name/type/required/
default only. The health summary carries metadata without paths,
plus diagnostics, integrity, migration state, and provenance.
Every bounded answer carries generated-at time, scope, actor,
authorization, and record count. Engine ceilings, cursors,
validation, and stable envelopes are reused verbatim, with ceiling
fail-closed.

## Boundaries

- No Dashboard repository edits.
- `systemId` stays Dashboard-local. Data's durable identity uses
  the host/workspace scope; projection metadata carries no
  `systemId` and no `databasePath`.
- The browser never receives raw DB paths. Serialized projections
  contain no `ai-verse-data.sqlite` path and no trusted-root path;
  Dashboard caches stay derived and disposable.
- No mutations, no Memory auto-write.
- No raw SQL or path extras, no registry or OS mutation.
- No cross-workspace access or transactions.
- No purge automation.
- No Task 32+ adapters early.

Consumer-side adoption happens through separately approved tasks.

## Verification

`test/dashboard-projection.test.ts` covers spaces/schemas/tables/
forms without raw paths, record detail with resolved references
plus charts, read-only events/receipts/health with no systemId,
and ceiling plus isolation plus closed-client plus invalid-adapter
fail-closed on real temporary SQLite databases.
