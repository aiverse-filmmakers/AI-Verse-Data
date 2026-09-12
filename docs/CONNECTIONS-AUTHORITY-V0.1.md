# AI-Verse Connections Authority Boundary v0.1

**Task:** 33 / 41
**Phase:** 4.7 - Connections authority boundary
**Status:** IMPLEMENTED
**Public package surface:** `@ai-verse/data/connections`

This document draws the line between local records and outside
records. Ours stay boss here. Outside stays outside unless an
explicit import proves who owns what.

## Design

`createConnectionsAuthority(client)` wraps a Task 27 client and
exposes only metadata plus explicit one-way imports:

- `policy.describe` reports `local: local_canonical`, the four
  named-but-unbuilt future classes (`external_canonical`,
  `replicated`, `snapshot`, `derived`), and the default
  `import-only` direction.
- `authority.classify` reports `local_canonical` for any live
  space/entity. Local records never claim external authority.
- `sources.ref/parse` builds and parses strict
  `connections://<connection>/<system>/<externalId>?authority=&sync=[&version=]`
  references. Unknown query keys, bad shapes, and
  `local_canonical`-as-external claims fail closed.
- `records.import` creates a local record with the external IDs
  plus authority plus sync plus URI preserved in a `sourceRef`
  field, with Data provenance plus direction. Idempotency keys
  make retries replay-safe. Schema validation, OCC, ceilings, and
  stable envelopes are reused verbatim with no new engine and no
  new storage.
- Reads and bounded queries stay local. `lifecycle.syncNotice`
  states `no-implicit-bidirectional-sync`.

Future classes are names only. No replicated/snapshot/derived
storage, no conflict engine, and no sync scheduler are built
until their semantics are specified.

## Boundaries

- No Connections repository edits.
- No implicit bidirectional sync of any kind. Every accepted
  direction is `none` or `import-only`.
- No sync engine: no conflict resolution, deletion propagation,
  offline queue, or external writes.
- Importing never rewrites external truth; external systems stay
  canonical for their own state.
- No Memory auto-write, no systemId identity.
- No raw SQL or path extras, no registry or OS mutation.
- No cross-workspace access or transactions.
- No purge automation.
- No Task 34+ behavior early.

Consumer-side adoption happens through separately approved tasks.

## Verification

`test/connections-authority.test.ts` covers local authority with
future classes named, explicit import with external IDs plus
provenance plus replay, source ref round-trip with local reads
and no implied sync, and malformed plus conflict plus
closed-client plus invalid-adapter fail-closed on real temporary
SQLite databases.
