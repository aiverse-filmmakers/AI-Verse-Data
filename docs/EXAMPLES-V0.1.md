# AI-Verse Data Examples

**Status:** Canonical Task 39 / 41 examples guide
**Date:** 2026-09-12

Runnable samples under `examples/`. Docs plus runnable samples only;
no new engine, no new `src/` surface.

## Running

Build first, then run any sample with plain Node:

```text
npm run build
node examples/crm-tracker.mjs
```

Every sample uses a temporary workspace root, asserts each step with
the same contracts the test suite proves, prints one `*-OK` line, and
removes its temp directories. Nothing touches a sibling repository or
the live OS template.

## Samples

- `examples/crm-tracker.mjs` — shop tracker: CRM Data Space with
  companies plus deals schemas, related records, receipt on create,
  filtered query, count plus sum aggregates.
- `examples/content-planner.mjs` — content planner: content Data Space
  with draft/scheduled posts plus a status-filtered query.
- `examples/production-tracker.mjs` — production tracker: Apps scoped
  kit over the Task 27 client with a manifest declaration, a scoped
  record create, schema-origin tracking, and the
  `preserve-data` uninstall notice (canonical records stay Data-owned).
- `examples/bot-safe-operations.mjs` — safe Bot use: leased Bot/Worker
  access over the Task 27 client with task-linked receipts, plus a
  delete-denial proof showing the lease floor holds (no privilege
  boost; model-written strings never grant access).
- `examples/backup-reinstall.mjs` — backup plus reinstall: SQLite
  backup create plus verify, portable export create, with artifact-ID
  equality proof. Restore plus reinstall semantics are the
  `backup.test.ts` suite's domain; the sample proves the
  create/verify path end to end.
- `examples/data-vs-memory.mjs` — Data-vs-Memory help: stable
  `data://` reference, round-trip parse, record candidate proposal
  with provenance, and event-count invariance (proposals only; zero
  Memory writes, zero Data events; events stay audit facts).

## Boundary

Samples compose Tasks 27-34 verbatim through the public package
surface. They never accept raw paths or SQL, never cross workspaces,
never purge, and never write sibling-layer state.
