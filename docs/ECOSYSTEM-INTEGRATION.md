# AI-Verse Data Ecosystem Integration

**Status:** Canonical integration direction  
**Date:** 2026-09-10

## 1. Purpose

AI-Verse Data must feel native when installed into AI-Verse OS, regardless of whether Memory, Brain, Skills, Multiple Bots, Dashboard, Apps, or Connections were installed before or after it.

The integration rule is:

> **Each layer keeps its own truth. Integration happens through explicit contracts, scoped requests, references, events, and receipts.**

No layer should need to copy another layer's canonical state merely to use it.

## 2. Integration map

```text
                        AI-Verse Dashboard
                      read models / controls
                               |
                               v
                         AI-Verse OS
                   scope / routing / policy
                               |
        +----------------------+----------------------+
        |                      |                      |
        v                      v                      v
     Brain                Multiple Bots             Skills
 direction/reasoning      coordination           methods/tools
        |                      |                      |
        +----------------------+----------------------+
                               |
                               v
                        AI-Verse Data
                 canonical structured records
                               |
               +---------------+---------------+
               |                               |
               v                               v
            Memory                         Connections
        historical recall                external systems
                               |
                               v
                             Apps
                  persistent software surfaces
```

The arrows represent use/integration, not ownership transfer.

## 3. AI-Verse OS integration

AI-Verse OS is the native host and owns:

- system structure;
- workspace identity;
- workspace boundaries;
- routing;
- outer action-permission floors;
- extension discovery;
- user-owned versus system-owned versus derived placement.

AI-Verse Data should integrate through the existing local extension contract:

```text
.aiverse/extensions/registry.json
```

Normal install must not modify tracked OS files such as:

- `AI-VERSE.yaml`;
- `AGENTS.md`;
- `CLAUDE.md`;
- `skills/registry.yaml`;
- `system/` files;
- other extension registrations.

Data owns only:

```text
.aiverse/extensions/ai-verse-data/
```

plus its registry entry and the canonical Data databases explicitly created in user workspaces.

### Native Data scope

The OS root is trusted configuration. Workspace identity comes from the actual workspace manifest.

A caller may request `workspaceId`, but the adapter resolves it under the trusted OS root and verifies the matching `WORKSPACE.yaml` before opening Data.

No model/user-supplied raw filesystem path becomes authority.

## 4. AI-Verse Memory integration

Memory remains optional.

Data does not require Memory to start, store records, query records, or preserve history.

Memory may later:

- consume selected Data events as evidence;
- create meaningful historical memories that reference Data records/events;
- return relevant historical recall alongside current Data context.

Data must not:

- mirror all records into Memory;
- write one Memory entry for every mutation;
- use the Memory SQLite index as canonical storage;
- let historical Memory silently override current Data values.

Canonical boundary details live in `DATA-MEMORY-BOUNDARY.md`.

## 5. AI-Verse Brain integration

Brain owns direction, goals, gap analysis, initiative, evaluation, and bounded strategic reasoning.

Data supplies structured state when Brain or its host adapter needs it.

Example:

```text
Brain objective:
Increase qualified pipeline to €200k.

Brain requests bounded current state.
        |
        v
Data query:
open qualified deals
        |
        v
Data result:
€142k across 11 records
        |
        v
Brain reasons about the €58k gap.
```

Data does not persist Brain goals into Data unless an explicit application schema chooses to model operational records related to them. Even then, Brain's canonical strategic object remains Brain-owned.

### Adapter direction

Brain already uses a host-adapter model for context/history/capabilities/connections. Data should eventually be exposed through an explicit structured-data host operation rather than making Brain open SQLite itself.

A future compatible host operation might be conceptually:

```text
query_structured_data(scope, query)
```

The exact Brain contract must be changed only in Brain's own repository when that integration is deliberately scheduled. Data should first provide a stable client/API that such an adapter can consume.

## 6. AI-Verse Multiple Bots integration

Multiple Bots owns coordination and already models:

- durable Bots;
- temporary Workers;
- Tasks;
- capability leases;
- environment leases;
- approvals;
- Rooms/Threads;
- Team Runs;
- execution provenance.

Data operations fit naturally as leased capabilities.

Example:

```text
Task
  scope: workspace:sales
  principal: bot:sales-lead
  capabilities:
    - data:crm:deals:read
    - data:crm:deals:update
```

The Data adapter receives trusted effective authorization from the host/coordination boundary.

A model must not be able to increase its Data access by writing another capability string into a prompt.

### Permission law

Data access should respect the wider AI-Verse law:

```text
host policy
INTERSECT
workspace policy
INTERSECT
principal grants
INTERSECT
Task capability lease
INTERSECT
Data operation policy
```

Delegation may reduce authority but may not increase it.

### Receipts

A successful Bot mutation should return a Data mutation receipt that Multiple Bots can reference in its execution Artifact/trace without duplicating the whole canonical record.

## 7. AI-Verse Skills integration

Skills define reusable methods. They do not own Data access.

Examples of future Skills:

```text
prepare-client-followup
reconcile-content-calendar
review-overdue-invoices
produce-sales-report
```

A Skill may declare a requirement such as:

```text
requires:
  data:
    - crm.deals:read
    - crm.activities:create
```

The OS/host resolves whether the active workspace has AI-Verse Data, the required Data Space/schema, and permission for the operation.

Installed Skill metadata must never imply Data write authority.

## 8. AI-Verse Dashboard integration

Dashboard is a presentation/control client.

It should eventually display:

- Data Spaces;
- schemas;
- tables;
- forms;
- record details;
- relations;
- charts/aggregates;
- events/audit history;
- health/migration state.

The browser never opens `ai-verse-data.sqlite`.

Expected path:

```text
Browser
  -> Dashboard Gateway
  -> selected systemId maps to trusted OS root
  -> workspaceId
  -> Data API/client
  -> canonical workspace database
```

`systemId` remains Dashboard-local. Data's durable identity uses the host/workspace scope.

Dashboard caches are derived and disposable.

## 9. AI-Verse Apps integration

Apps is a primary future consumer of Data.

An App should declare its Data needs through its manifest rather than hiding them in code.

Conceptually:

```yaml
app: production-manager
scope: workspace
data:
  spaces:
    production:
      schemas:
        - productions
        - shoot-days
        - crew
      capabilities:
        - read
        - create
        - update
```

The App runtime receives a scoped Data client, not a raw SQLite path.

### App schema ownership

An App may be the origin/maintainer of an entity schema, but the canonical records remain Data-owned.

Uninstalling an App must not silently delete the canonical records it used.

Future App uninstall UX should distinguish:

```text
remove app UI/runtime
preserve data
```

from a separately approved destructive data purge.

## 10. AI-Verse Connections integration

Connections reaches external systems where AI-Verse may not own truth.

Examples:

```text
HubSpot CRM
Stripe
Google Sheets
Airtable
external SQL database
```

Data must distinguish local canonical records from external canonical records.

The v0.1 Data release only needs `local_canonical`.

Future integration may introduce explicit source authority classes such as:

```text
external_canonical
replicated
snapshot
derived
```

but no sync engine should be created until conflict/authority semantics are specified.

### Important rule

If HubSpot is the canonical CRM, querying HubSpot through Connections is not the same thing as importing every contact into AI-Verse Data and claiming the local copy is truth.

Synchronization must always answer:

- which side is authoritative;
- whether writes are one-way or two-way;
- how conflicts are resolved;
- how deletions propagate;
- what happens offline;
- what provenance is retained.

## 11. Automations / Cadence integration

AI-Verse Data emits state-change facts.

Example:

```text
record.updated
space: crm
entity: deals
changed_field: stage
new_value: won
```

The Data engine does not decide what recurring workflow to run.

The owning OS/automation layer may subscribe and apply policy:

```text
Data event
   -> Automation trigger policy
   -> Task/Bot/Skill invocation
```

Data must not become a second scheduler.

## 12. Installation-order independence

The integration test matrix must cover at least:

```text
OS -> Data
OS -> Memory -> Data
OS -> Data -> Memory
OS -> Brain -> Data
OS -> Data -> Brain
OS -> Multiple Bots -> Data
OS -> Data -> Multiple Bots
OS -> Skills -> Data
OS -> Data -> Skills
OS -> Dashboard -> Data
OS -> Data -> Dashboard
```

and mixed combinations.

Data installation must not depend on the physical presence of the other optional layers.

When another layer appears later, it discovers Data through the OS/extension/integration contract rather than requiring Data reinstall unless a new adapter version explicitly requires it.

## 13. Extension registration identity

The Data extension entry should be named:

```text
ai-verse-data
```

Conceptual registry entry:

```json
{
  "id": "ai-verse-data",
  "supported": true,
  "installed": true,
  "enabled": true,
  "version": "<version>",
  "source": "AI-Verse-Data",
  "instructions": ".aiverse/extensions/ai-verse-data/INSTRUCTIONS.md",
  "engine": ".aiverse/extensions/ai-verse-data/engine.mjs",
  "adapters": []
}
```

Unknown registry fields, other extension entries, and unknown fields on the existing Data entry must be preserved according to the OS extension contract.

Existing `enabled: false` must survive reinstall/update unless an explicit operator action changes it.

## 14. No tracked-runtime-adapter writes by default

In native OS mode, Data should prefer extension-local instructions and engine files.

It should not copy standing instructions into tracked `.claude/skills/`, `.agents/skills/`, `AGENTS.md`, or `skills/registry.yaml` merely to be discoverable.

If a future OS capability-provider contract creates a sanctioned external adapter path, Data can integrate through that contract deliberately.

This avoids recreating the legacy integration problem where optional extensions dirtied upstream OS files.

## 15. Health integration

Data should expose its own `doctor` result with enough structured information for OS/Dashboard health projection.

Health should distinguish:

```text
installed
registered
enabled
healthy
workspace_has_data
migration_required
corrupt
unsupported
```

Registration is not health.

An empty workspace with no Data database is not an error unless Data was explicitly requested for that workspace.

## 16. Discovery model

At runtime, AI-Verse should load Data only when relevant.

Examples:

```text
"Show me our active deals"
-> Data relevant

"What did I decide about the brand tone?"
-> Data not relevant, use context/decisions/memory
```

The Data extension instruction should teach the host how to recognize structured-data intent without forcing a Data scan on every request.

## 17. Cross-workspace rules

v0.1 operations target exactly one workspace.

A request cannot ask the Data engine to open another workspace using a path.

A future cross-workspace reporting feature must be explicit and OS-authorized. Prefer aggregation through scoped adapters rather than attaching several canonical SQLite files into one unrestricted query session.

## 18. Cross-system rules

If Dashboard manages several OS installations, Dashboard maps each `systemId` to a trusted OS root before invoking Data.

Data itself never infers or shares state across those roots.

Two OS installations may each contain:

```text
workspace: sales
space: crm
record: deal_42
```

and those objects remain unrelated because their host roots are different security/authority boundaries.

## 19. Future multi-user model

Data should not implement an independent human account system.

When AI-Verse gains multi-user identity, trusted actor/authorization context can be extended to include:

- tenant/system membership;
- workspace membership;
- user roles;
- entity-level permissions;
- row-level permissions;
- field-level restrictions;
- audit actor identity.

The v0.1 actor model should be extensible enough that a single `local-operator` is not hardcoded into every durable record schema.

## 20. Integration non-negotiables

1. Data can install and operate without any optional sibling repo.
2. No sibling installer is required to be rerun merely because Data appears later.
3. Data never modifies sibling canonical state directly.
4. Data writes only its own extension entry and its own canonical workspace databases.
5. Other layers use Data through stable interfaces/references, never by owning the database file.
6. Data events do not automatically become Memory.
7. Brain reasons over Data but does not become its owner.
8. Bots receive scoped capabilities, not SQL/database access.
9. Apps use Data rather than inventing hidden canonical databases where Data should own the records.
10. Connections remains authoritative for access to external systems.
11. Dashboard `systemId` never becomes Data's canonical system identity.
12. Installation order does not change source-of-truth semantics.
