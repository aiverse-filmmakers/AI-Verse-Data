# AI-Verse Apps Data Contract v0.1

**Task:** 32 / 41
**Phase:** 4.6 - Apps Data contract
**Status:** IMPLEMENTED
**Public package surface:** `@ai-verse/data/apps`

This document defines the Data-side contract that lets Apps use
Data instead of hidden competing databases. Apps declare needs in
a manifest; Data hands a scoped kit. Records stay Data-owned.

## Design

`createAppsDataKit(client, manifest, options?)` wraps a Task 27
client whose actor is the host-bound App. The manifest is a
host-passed trusted object:

```text
{
  app: "production-manager",
  scope: "workspace",
  data: {
    spaces: { production: { schemas: ["productions", "shoot-days"] } },
    capabilities: ["read", "create", "update"]
  }
}
```

Every manifest capability must also be present in the client
`authorization.capabilityRefs` as
`data:<space>:<entity>:<capability>`. Model-written manifests
never grant access. Every kit call re-checks space/entity/capability
cover and fails closed. Delete is never granted to Apps. Grants
reduce authority and never increase it.

The kit composes the Task 27 client verbatim: spaces, schemas,
records, bounded query plus aggregates, transactions, bulk preview
plus execute, provenance, permissions describe, and an uninstall
notice. Engine ceilings, digests, OCC, idempotency, receipts, and
stable envelopes are reused with no new engine and no new storage.

## Schema ownership without record ownership

An App may be recorded as the origin/maintainer of an entity
schema via `schemaOrigins` (`"<space>/<entity>" -> app`), surfaced
through `schemas.origin`. Origin metadata never transfers record
ownership: canonical records remain Data-owned and readable through
the normal kit and client paths.

## Uninstall preserves data

`lifecycle.uninstallNotice()` returns the durable rule:

```text
{ app, workspaceId, rule: "preserve-data", detail }
```

Removing the app removes only app UI/runtime. A separately
approved destructive purge is required to delete canonical
records; it is not part of this contract and not part of normal
uninstall.

## Boundaries

- No Apps repository edits.
- No hidden competing databases: kits scope Apps into Data.
- No delete grant, no cross-workspace kits, no raw SQL/paths.
- No Memory auto-write, no systemId identity.
- No registry or OS mutation, no purge automation.
- No Task 33+ adapters early.

Consumer-side adoption happens through separately approved tasks.

## Verification

`test/apps-contract.test.ts` covers scoped reads plus writes
inside the grant with replay, out-of-grant space/entity/delete
denial, model-written manifest denial, schema origins without
ownership transfer plus uninstall notice, transactions/bulk/
provenance inside the grant, and malformed plus wrong-identity
plus closed-client fail-closed on real temporary SQLite
databases.
