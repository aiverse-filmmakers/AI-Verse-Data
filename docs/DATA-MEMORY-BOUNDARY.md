# AI-Verse Data and AI-Verse Memory Boundary

**Status:** Canonical cross-layer boundary  
**Date:** 2026-09-10

## 1. Purpose

AI-Verse Data and AI-Verse Memory may both use SQLite internally, but they solve different problems and must never be merged simply because their storage technology overlaps.

This document defines the boundary so future implementation does not create duplicate truth, accidental memory mirrors, or conflicting lifecycle rules.

## 2. One-sentence distinction

> **Data owns current structured operational records. Memory owns historical recall that may matter later.**

Examples:

```text
Data
Deal.stage = proposal
Deal.value = 18000
Invoice.status = unpaid
Post.publish_at = 2026-09-12T09:00:00Z

Memory
"The client disliked dark visual treatments last time."
"A previous proposal stalled until legal was included."
"This workflow failed when approval was requested too late."
```

## 3. Different canonicality rules

### AI-Verse Memory

In native OS mode:

- canonical historical memories are Markdown under operator/workspace memory paths;
- current context/profile/decisions stay canonical in their OS-owned paths;
- Memory's SQLite index is derived and rebuildable;
- deleting the Memory index must not destroy irreplaceable memory truth.

### AI-Verse Data

For `local_canonical` Data Spaces:

- the structured database itself is canonical;
- deleting the Data database destroys canonical structured truth and is therefore destructive;
- Data must provide real backup/export and migration semantics;
- the database cannot be treated like an index or cache.

This lifecycle difference alone is enough to require separate ownership.

## 4. What belongs in Data

Use Data when information is naturally a mutable structured collection that benefits from:

- filtering;
- sorting;
- relationships;
- aggregation;
- transactions;
- forms;
- status transitions;
- numeric operations;
- record-level concurrency;
- reactive events.

Examples:

- CRM contacts/deals;
- invoices and payment status;
- content publishing queue;
- production deliverables;
- inventory;
- campaign metrics;
- app records;
- structured project trackers.

## 5. What belongs in Memory

Use Memory when information represents meaningful history that may help future reasoning:

- experiences;
- stable facts learned over time;
- preferences;
- historical state transitions worth recalling;
- lessons;
- constraints discovered through experience;
- workflow history that may later become a Skill;
- important events with future semantic value.

Memory is selective. It should not become a change log for every row in Data.

## 6. Data event history is not Memory

AI-Verse Data should keep append-oriented events for its own integrity and audit needs.

Example:

```text
record.updated
record: deal_42
field: stage
before: proposal
after: won
actor: bot:sales-lead
```

This event belongs to Data because it proves how a canonical Data record changed.

It does **not** automatically become an atomic Memory entry.

If every Data change became Memory, a high-volume operational database would flood the memory layer with low-value history.

## 7. How Data can feed Memory safely

Memory integration should be explicit and selective.

Possible future pattern:

```text
Data events / records
        |
        v
Memory candidate selector
        |
        +-- transient/no future value -> ignore
        |
        +-- useful historical meaning -> propose Memory entry
                                         |
                                         v
                                 Memory write contract
```

Examples that may justify Memory:

```text
Data event:
Deal X remained blocked for 45 days.

Possible memory:
"Enterprise deals for Client X tend to stall during legal review."
```

or:

```text
Data event:
Three scheduled posts failed because a platform rejected the aspect ratio.

Possible memory:
"This platform repeatedly rejected 4:5 uploads in the current publishing workflow."
```

The meaning is extracted deliberately. The underlying Data records remain authoritative for their exact current state and audit history.

## 8. Provenance references instead of duplication

A Memory entry derived from Data should be able to reference the Data evidence without copying the entire record set.

Conceptual reference:

```text
data://workspace-id/crm/deals/deal_42
```

or a more explicit structured source reference:

```json
{
  "sourceType": "ai-verse-data",
  "workspaceId": "sales",
  "spaceId": "crm",
  "entity": "deals",
  "recordId": "deal_42",
  "recordVersion": 8,
  "eventId": "evt_..."
}
```

The exact URI/reference format should be finalized with the integration protocol.

Memory should preserve enough provenance to re-open the relevant Data evidence when it still exists.

## 9. Data may consult Memory, but Memory does not validate Data

A Bot operating on Data may receive relevant historical Memory alongside current records.

Example:

```text
Current Data:
Deal.stage = proposal
Deal.value = 18000

Relevant Memory:
"This client prefers proposals under two pages."
```

The Memory can improve reasoning about the record.

It cannot override the current Data value merely because the memory is older or semantically similar.

Current canonical Data wins for Data-owned fields.

## 10. Current-context summaries

The OS may summarize Data into current context when useful, for example:

```text
Pipeline: €142k open, €37k won this month, 6 deals blocked.
```

That summary is a projection and should carry provenance to Data.

It must not become a second independently edited source for exact pipeline records.

## 11. Search and retrieval separation

Memory search answers questions about historical recall.

Data query answers questions about structured records.

Do not hide one behind the other.

Examples:

```text
"What did this client dislike before?"
-> Memory

"Which deals above €10k are currently in proposal?"
-> Data

"Which current blocked deals involve clients who previously complained about delivery delays?"
-> scoped combination of Data + Memory
```

A host/orchestrator can combine results without merging ownership.

## 12. Installation independence

AI-Verse Data and AI-Verse Memory are optional peers.

Required cases:

```text
OS + Data
works

OS + Memory
works

OS + Memory + Data
works

Data installed before Memory
works

Memory installed before Data
works

remove Memory
Data still works

remove Data engine
Memory still works and Data files remain preserved
```

Neither installer may rewrite or take ownership of the other's extension entry or files.

## 13. Uninstall behavior

Memory uninstall rules remain Memory-owned.

Data uninstall must:

- unregister/disable the Data extension according to its lifecycle contract;
- remove only extension-owned runtime/engine material when requested;
- preserve canonical workspace Data databases by default;
- never purge records merely because the Data package is removed.

A future explicit purge command must be clearly destructive and must not be part of normal uninstall.

## 14. Cross-layer authority examples

### Example A: deal status

Data says:

```text
stage = won
```

Old Memory says:

```text
"The deal was still in proposal last Tuesday."
```

Result: Data is current authority for the current stage. Memory remains valid history if its time context is correct.

### Example B: client preference

Data contains:

```text
preferred_contact_method = email
```

Memory contains a newer explicit user-confirmed preference:

```text
"Client asked us yesterday to use WhatsApp going forward."
```

This exposes a stale Data record. The system may propose updating Data, but Memory must not silently mutate it.

### Example C: deleted operational record

A deal is soft-deleted in Data.

Memory may still mention historical work related to that deal. Deleting the operational record does not rewrite historical Memory.

## 15. Non-negotiable invariants

1. Data CRUD never automatically writes one Memory item per mutation.
2. Memory recall never silently mutates Data.
3. Memory's derived SQLite index is never treated as Data authority.
4. Data's canonical SQLite database is never treated as disposable Memory cache.
5. A Data-derived Memory entry carries provenance when possible.
6. Exact current Data questions prefer Data over historical Memory.
7. Historical reasoning may combine Data events and Memory, but ownership remains explicit.
8. Installation order must not affect correctness.
9. Neither extension may overwrite the other's registration, files, or state.
10. Cross-workspace Memory/Data access remains explicitly scoped and never becomes the default.

## 16. Decision

Keeping AI-Verse Data separate from AI-Verse Memory is not duplication.

It preserves two different and necessary guarantees:

```text
Memory:
History remains inspectable and recallable even if its index is rebuilt.

Data:
Structured operational records remain authoritative, transactional, queryable, and safely mutable.
```

The layers should integrate through references, bounded queries, and explicit memory-candidate workflows, not through shared ownership.
