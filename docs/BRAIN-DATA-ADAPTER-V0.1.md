# AI-Verse Brain Structured-Data Adapter Contract v0.1

**Task:** 29 / 41
**Phase:** 4.3 - Brain structured-data adapter contract
**Status:** IMPLEMENTED
**Public package surface:** `@ai-verse/data/brain`

This document defines the Data-side read-only structured-data
surface for Brain host adapters. Data answers bounded questions with
records plus proof; Brain goals, strategy, and reasoning stay
Brain-owned.

## Design

`createBrainDataAdapter(client)` wraps a Task 27 client and exposes
only reads: space get/list/summarize, schema get/list/summarize,
record get/list, bounded query (`ask`) plus aggregates (`summarize`),
provenance events plus receipts, and health metadata/diagnostics plus
migration status. There is deliberately no create, update, delete,
transaction, bulk-execute, backup, restore, migration-execute, or
recovery surface.

Every answer carries question provenance:

```text
{ answeredAt, scope, actor, authorization, recordCount }
```

Engine ceilings, cursors, validation, idempotent replay reads, and
stable protocol envelopes and error codes are reused verbatim from
the Task 27 client. Query ceilings fail closed.

## Boundaries

- No Brain repository edits.
- No Brain-goal persistence: Data never stores Brain objectives,
  gaps, initiatives, or evaluations. An explicit application schema
  may model operational records related to them, but Brain's
  canonical strategic object remains Brain-owned.
- No copying Data into Brain state; Brain requests bounded current
  state and reasons over the returned answer.
- No mutations, no Memory auto-write, no Dashboard `systemId`
  identity.
- No raw SQL or path extras, no registry or OS mutation.
- No cross-workspace access or transactions.
- No purge automation.
- No Task 30+ adapters early.

Consumer-side adoption happens through separately approved tasks.

## Verification

`test/brain-adapter.test.ts` covers bounded query plus aggregates
with provenance and no goal copy, read-only spaces/schemas/events/
receipts/health with provenance, ceiling fail-closed with stable
errors, and isolation plus closed-client plus invalid-adapter
fail-closed on real temporary SQLite databases.
