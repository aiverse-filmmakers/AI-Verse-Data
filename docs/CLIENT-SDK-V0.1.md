# AI-Verse Typed Data Client SDK v0.1

**Task:** 27 / 41
**Phase:** 4.1 - Typed Data client SDK
**Status:** IMPLEMENTED
**Public package surface:** `@ai-verse/data/client`

This document defines the stable typed client over the
`ai-verse-data/0.1` protocol. The client is a thin typed wrapper with
no new engine, no new storage, and no new authority.

## Design

`createDataClient({ scope, actor, authorization })` returns typed
`spaces`, `schemas`, `records`, `query`, `aggregate`, `transactions`,
`bulk` (preview plus execute), `provenance` (events plus receipts),
`backup` and export/import, `schemaMigrations` (preview plus execute),
and `health` surfaces.

Scope-first: the caller passes a trusted `DataDatabaseScope` from
`TrustedDataRoot` plus a workspace ID. Raw SQLite paths and raw SQL
are never accepted. The scope is binding-verified on open and a
`DATABASE_SCOPE_CONFLICT` fails closed.

Actor and authorization are host-bound per `PROTOCOL-V0.1.md` section 5
and the `SECURITY-AND-AUTHORITY.md` hierarchy. Model-proposed values
never grant authority by themselves.

## Preserved behavior

The client reuses the existing engines verbatim:

- schema validation;
- `expectedVersion` optimistic concurrency;
- fingerprint idempotency with replay-before-check;
- receipts and events per mutation;
- 50-operation transaction cap;
- 50-operation and 256 KiB bulk cap with preview-digest gate;
- bounded query AST with cursors and ceilings;
- migration-required versus destructive-approval split;
- quarantine, incomplete, migration-required, and unsupported states
  kept distinct.

## Boundaries

- No raw SQL or path extras.
- No Dashboard `systemId` identity.
- No automatic Memory writes.
- No Brain, Bots, Skills, Apps, Connections, or Dashboard writes.
- No registry or OS mutation.
- No cross-workspace transactions.
- No purge automation.

Consumer repositories adopt the client later through their own
separately approved tasks. This task changes only `AI-Verse-Data`.

## Verification

`test/client.test.ts` covers full CRUD, optimistic concurrency,
idempotent replay, receipts, query, aggregates, transactions,
provenance, bulk digest plus ceilings plus stale rejection, migration
preview plus destructive approval, error-code stability, isolation,
reopen, backup and export, health, and raw-path rejection on real
temporary SQLite databases.
