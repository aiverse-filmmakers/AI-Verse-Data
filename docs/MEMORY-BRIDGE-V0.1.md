# AI-Verse Memory Provenance/Candidate Bridge v0.1

**Task:** 30 / 41
**Phase:** 4.4 - Memory provenance/candidate bridge
**Status:** IMPLEMENTED
**Public package surface:** `@ai-verse/data/memory`

This document defines the Data-side reference, evidence, and
candidate shape for Memory integration. Data stays boss of records.
Memory decides what to remember. Nothing is auto-copied.

## Design

`createMemoryBridge(client)` wraps a Task 27 client and exposes only
three read-only groups:

- `references`: stable `data://<workspace>/<space>/<entity>/<record>[@version][?event=&receipt=]`
  references plus strict parse. The structured
  `DataProvenanceReference` carries `sourceType: ai-verse-data`,
  workspace, space, entity, record, version, event, and receipt.
- `evidence`: re-open live records, events, and receipts by
  reference, by record identity, or by exactly one of event,
  receipt, or idempotency key. Cross-workspace evidence is denied.
  Deleted or missing state fails closed.
- `candidates`: propose record, event, and aggregate-summary
  candidates with title, summary, record count, scope, actor,
  authorization, proposed-at time, and optional expiry. Candidates
  are proposals only. They write no Memory entries and no Data
  events.

Engine validation, ceilings, receipts, events, and stable protocol
envelopes are reused verbatim from the Task 27 client.

## Boundaries

- No Memory repository edits.
- No automatic Memory writes of any kind: no per-mutation entries,
  no flood, no background sync.
- Data events stay audit facts; Memory candidacy is a separate
  explicit decision owned by Memory/host code.
- Memory recall never silently mutates Data; current Data wins for
  Data-owned fields.
- No Memory SQLite index use as Data authority; no Data database
  treated as disposable cache.
- No raw SQL or path extras, no registry or OS mutation.
- No cross-workspace access or transactions.
- No purge automation.
- No Task 31+ adapters early.

Consumer-side adoption happens through separately approved tasks.

## Verification

`test/memory-bridge.test.ts` covers stable reference round-trip and
live record re-open, event evidence by event/receipt/idempotency
key, candidate proposal without Memory or Data writes plus
provenance, and malformed plus cross-workspace plus closed-client
fail-closed on real temporary SQLite databases.
