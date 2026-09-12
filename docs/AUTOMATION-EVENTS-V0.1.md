# AUTOMATION-EVENTS-V0.1

Task 34 / 41 — Phase 4.8 committed-event surface over existing Data events.

## Scope

- Data-side only. Facts only. No scheduler, no trigger engine.
- Verbatim primitives: client `events.*`, receipt lookup, envelopes/ceilings/cursors fail-closed.

## Contract

- `createAutomationEvents(client)` — scope-first over the Task 27 client.
- `subscriptions.declare` — names event types, optional space/entity/record/event filters,
  optional stable `cursorKey`. All fields fail-closed when malformed.
- `subscriptions.unsubscribe` — only removes local listener entries. No Data writes.
- `events.poll` — bounds types/limits, applies mismatch absences **locally**,
  never writes catch-ups into Data. Cursors only move forward. No deletes.
...[truncated]