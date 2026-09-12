# AI-Verse Multiple Bots Data Adapter v0.1

**Task:** 28 / 41
**Phase:** 4.2 - Multiple Bots Data adapter
**Status:** IMPLEMENTED
**Public package surface:** `@ai-verse/data/bots`

This document defines the Data-side leased Bot/Worker access over the
Task 27 typed client. Data owns only its records; leases, approvals,
Rooms, Team Runs, and execution traces stay Bots-owned.

## Design

`createBotsDataAdapter(client, lease)` wraps a Task 27 client whose
actor is the leased Bot/Worker. The lease is a host-passed trusted
object:

```text
{
  workspaceId,
  principal: { kind: bot|worker, id },
  taskId,
  capabilities: ["data:<space>:<entity>:<read|create|update|delete>"],
  expiresAt?,
  artifactRef?
}
```

Every call re-checks: lease workspace equals client scope workspace,
lease principal equals bound client actor, the requested
space/entity/action is covered by a lease capability, and the lease is
unexpired. Anything else fails closed. Delegation reduces authority
and never increases it, per `ECOSYSTEM-INTEGRATION.md` section 6 and
the `SECURITY-AND-AUTHORITY.md` intersection law.

The adapter also requires every lease capability to be present in the
client `authorization.capabilityRefs`. Model-written capability
strings in prompts never grant access; only host-granted refs count.

## Provenance and receipts

Bot/Worker actors are recorded in `createdBy`/`updatedBy` plus event
actors through the reused engines. Mutations return a task-linked
receipt wrapper:

```text
{ receipt, taskId, artifactRef?, principal }
```

Multiple Bots can reference that receipt in its execution
Artifact/trace without duplicating the canonical record.

## Preserved behavior

The adapter composes the Task 27 client verbatim: schema validation,
optimistic concurrency, idempotency with replay, receipts and events,
50-operation transaction cap, 50-operation and 256 KiB bulk cap with
digest gate, bounded query AST, and stable protocol envelopes and
error codes. No new engine, no new storage, no new authority model.

## Boundaries

- No Multiple Bots repository edits.
- No lease issuance or Bots-signature verification inside Data; the
  host/Bots boundary verifies, Data requires the trusted object and
  still applies structural rules.
- No approval, Room, Thread, or Team Run writes.
- No Memory auto-write, no Dashboard `systemId` identity.
- No raw SQL or path extras, no registry or OS mutation.
- No cross-workspace access or transactions.
- No purge automation.
- No Task 29+ adapters early.

Consumer-side adoption happens through separately approved tasks.

## Verification

`test/bots-adapter.test.ts` covers allowed operations with
task-linked receipts and bot provenance, read-lease write denial and
wrong-entity denial, expiry plus workspace plus principal fail-closed,
model-written capability denial, worker transactions plus bulk plus
artifact refs, malformed lease shapes, and stable error codes on real
temporary SQLite databases.
