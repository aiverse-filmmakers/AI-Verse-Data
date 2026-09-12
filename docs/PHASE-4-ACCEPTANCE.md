# AI-Verse Phase 4 Acceptance

**Phase:** 4 - Ecosystem Adapters
**Gate task:** 35 / 41 - Phase 4.9
**Status:** PASSED
**Date:** 2026-09-12

This document records the Phase 4 acceptance proof. `docs/BUILD-MAP.md`
remains the canonical project-wide task order.

## 1. Gate composition

Phase 4.9 adds no new engine and no new surface. It composes the
existing Task 27-34 adapters verbatim through a dedicated end-to-end
gate:

```text
test/phase4-integration.test.ts
```

The gate covers the adapter acceptance sections of
`docs/TESTING-AND-ACCEPTANCE.md` (sections 10-15 for Memory, Bots,
Brain, Dashboard, Apps, and Connections), the client contract of
`docs/CLIENT-SDK-V0.1.md`, the automation contract of
`docs/AUTOMATION-EVENTS-V0.1.md`, plus dedicated negative branches.
Earlier Phase 1, Phase 2, and Phase 3 gates remain inherited through
the full repository suite.

## 2. Positive story

On one real temporary workspace the gate proves:

- typed client CRUD with receipts and idempotent replay;
- optimistic-concurrency conflict surfaced rather than overwritten;
- filtered query plus sorting plus pagination;
- count, sum, min, max, and avg aggregates;
- bounded multi-record transaction with declared references;
- immutable events plus durable receipts with receipt-to-event linkage;
- Bots adapter with leased Bot/Worker access and task-linked receipts;
- Bot with read lease reads and cannot write;
- Worker cannot exceed its Task and leader grant;
- delegation to a stronger Bot cannot launder privilege;
- Brain adapter with bounded structured answers and question
  provenance, with no goal copy into Brain state;
- Memory bridge with stable references, live re-open, and
  propose-only candidates with zero Memory writes;
- current Data state wins over older Memory for Data-owned fields;
- Dashboard projection with bounded views, no raw database paths,
  and system identity kept Dashboard-local;
- Apps kit with declared capabilities, schema origins without record
  transfer, and uninstall-preserves-data;
- Connections authority with local-canonical now, explicit one-way
  imports with external IDs and provenance, and no implied sync;
- automation events with bounded subscriptions, forward-only cursors,
  and facts only with no scheduler;
- receipts resolve from every surface against the same canonical fact;
- optionality: absent consumers never block the base.

## 3. Negative branches

On isolated fixtures the gate proves fail-closed behavior for:

- expired and revoked leases;
- workspace and principal mismatch;
- model-written capability strings with no host grant;
- malformed lease, manifest, reference, and subscription shapes;
- missing, incompatible, quarantined, migration-required,
  scope-conflict, and unsupported states;
- traversal, absolute, and symlink paths;
- oversized inputs;
- closed clients and adapters;
- cross-workspace access.

No negative branch mutates canonical state.

## 4. Suite result

The gate runs as part of the full repository suite on Node 22 and
Node 24 CI. Local verification: full suite green with the two gate
tests passing and zero failures.
