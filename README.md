# AI-Verse Data

**The canonical structured-data layer for AI-Verse OS.**

Status: **Founding architecture / research seed**  
Implementation status: **Not started**  
Created: **September 2026**

AI-Verse Data is intended to give AI-Verse a first-class way to store, query, relate, update, and react to structured operational information such as customers, projects, deals, invoices, productions, content items, assets, inventory, tasks, metrics, and application records.

The long-term goal is:

> **Give humans, agents, apps, and automations one safe, explicit, structured data layer without turning Memory, Dashboard, or AI-Verse OS into a generic database product.**

This repository exists because structured operational data is a different category of truth from Markdown knowledge, historical memory, agent runtime state, or disposable search indexes.

---

# Why this repository exists

During research into Kylon and other AI-native workspaces, one capability stood out: structured data lives directly where humans and agents work.

That matters because many useful systems are naturally record-based:

```text
CRM
  -> Companies
  -> Contacts
  -> Deals
  -> Activities

Production manager
  -> Productions
  -> Shoot days
  -> Crew
  -> Locations
  -> Deliverables

Content system
  -> Ideas
  -> Assets
  -> Posts
  -> Channels
  -> Performance

Finance system
  -> Clients
  -> Invoices
  -> Payments
  -> Expenses
```

Trying to make every row of a CRM or every analytics event a Markdown document would be awkward and inefficient.

At the same time, letting every generated App create an unrelated private database would fragment truth and make the OS difficult to reason about.

AI-Verse Data is the proposed answer: a deliberate structured-data primitive with stable contracts, strong scope isolation, provenance, permissions, and events.

---

# North star

> **Structured data should be as native to AI-Verse as Markdown, while remaining clearly separated from Memory and derived indexes.**

Humans should be able to view it. Agents should be able to reason over it. Apps should be able to build on it. Automations should be able to react to it. The OS should be able to govern it.

---

# Role in the wider AI-Verse architecture

```text
AI-Verse OS
    -> system/workspace boundaries, policy, canonical routing and registration

AI-Verse Brain
    -> goals, planning, reasoning and evaluation over data when relevant

AI-Verse Memory
    -> historical recall, durable experiences, decisions and memory extraction

AI-Verse Skills
    -> reusable actions and workflows that query or mutate structured data

AI-Verse Multiple Bots
    -> Bots and Workers that operate on data through scoped capabilities

AI-Verse Data
    -> canonical structured schemas, records, relations, transactions, queries and events

AI-Verse Apps
    -> application experiences built on top of structured data

AI-Verse Connections
    -> access to external systems and external data sources

AI-Verse Dashboard
    -> tables, forms, charts, record inspectors and app surfaces
```

The key distinction is:

> **AI-Verse Data owns structured operational truth. It does not own the meaning of the whole OS.**

---

# This is NOT AI-Verse Memory

This distinction is fundamental.

AI-Verse Memory currently follows a local-first design where Markdown is canonical and SQLite is a rebuildable index. That should remain true for Memory.

AI-Verse Data would solve a different problem.

```text
AI-Verse Memory
"What happened before that may matter now?"

AI-Verse Data
"What are the current structured records and relationships the system operates on?"
```

Examples:

```text
Memory:
"The client previously rejected dark visual treatments."

Data:
Client.status = active
Client.owner = bogdan
Deal.value = 18000
Deal.stage = proposal
```

A Data database may be canonical by design. A Memory index remains derived by design.

The two must never be confused simply because both may use SQLite internally.

---

# This is NOT a replacement for Markdown

AI-Verse's existing file-based architecture remains valuable.

Markdown is excellent for:

- human-readable context
- plans
- decisions
- knowledge
- documentation
- narrative state
- policies
- instructions

Structured storage is better for:

- large record sets
- filtering
- sorting
- aggregation
- relationships
- transactions
- forms
- numeric analytics
- reactive events
- application state

AI-Verse should use the right form of truth for the right problem rather than forcing everything into one storage format.

---

# Core concepts

The final naming and schemas require dedicated implementation research, but the conceptual model should include:

## Data Space

A scoped structured-data container associated with an AI-Verse system or workspace.

## Schema

A versioned definition of structured entities and their fields.

## Entity / Table

A collection of records of one type, such as `customers`, `productions`, or `invoices`.

## Field

A typed property such as text, number, date, enum, boolean, reference, JSON, attachment reference, computed value, or other supported type.

## Record

One canonical structured object.

## Relation

A declared connection between records or entities.

## Query

A safe request to read/filter/sort/aggregate records.

## Mutation

A validated create/update/delete operation.

## Transaction

A set of mutations that must commit or fail together.

## Event

A structured notification emitted after canonical change.

## View

A reusable presentation/query definition such as a filtered table, Kanban view, calendar, chart, or app-specific projection.

---

# Example model

Illustrative only:

```yaml
schema: crm
version: 1
entities:
  companies:
    fields:
      name: string
      website: string
      status: enum

  deals:
    fields:
      title: string
      company_id: ref:companies
      value: currency
      stage: enum
      next_action: string
      owner: actor_ref
```

An agent should not need arbitrary SQL access merely to update one deal.

It should normally work through a scoped contract such as:

```text
data.record.get
data.record.list
data.record.create
data.record.update
data.record.delete
data.query
data.aggregate
data.schema.get
```

Higher-risk operations can require stronger capability grants or approvals.

---

# Agent-safe data access

AI-Verse Data should be designed for agent use from the beginning.

Agents are not ordinary database clients. They can hallucinate fields, produce malformed filters, overreach permissions, or attempt broad destructive actions.

The API should therefore favor:

- typed schemas
- validated queries
- bounded result sizes
- explicit workspace/system scope
- capability-based mutation permissions
- transaction boundaries
- predictable errors
- provenance
- mutation receipts
- auditability
- dry-run/preview for consequential bulk changes

Bad default:

```text
Agent receives unrestricted database credentials and can execute arbitrary SQL.
```

Preferred default:

```text
Agent receives a scoped Data capability with only the entities/actions required by its current Task.
```

Expert/admin modes may expose deeper querying where appropriate, but unrestricted authority should never be the normal agent path.

---

# Relationship to AI-Verse Apps

AI-Verse Apps is one of the strongest reasons this layer exists.

The expected pattern is:

```text
User:
"Build me a production tracker."

AI-Verse Apps
     |
     +-- defines UI
     +-- declares required schema
     |
     v
AI-Verse Data
     |
     +-- productions
     +-- crew
     +-- shoot_days
     +-- locations
     +-- deliverables
```

The generated App does not hide canonical business records inside an opaque frontend bundle.

The same data may then be used by:

- the App UI
- Dashboard tables
- Bots
- Skills
- Automations
- Brain reasoning
- reporting

This prevents an AI-generated application from becoming a silo.

---

# Relationship to AI-Verse Dashboard

Dashboard should render Data, not own it.

Possible future Dashboard surfaces include:

```text
Table
Form
Record detail
Kanban
Calendar
Timeline
Chart
Pivot / aggregate
Relationship explorer
```

Dashboard may cache projections for performance, but deleting Dashboard cache must never delete canonical AI-Verse Data.

Dashboard commands should mutate through Data/OS-approved interfaces, not manipulate database files directly.

---

# Relationship to AI-Verse Multiple Bots

Bots should be able to use structured data as normal work material.

Examples:

```text
Sales Bot
 -> find deals with no next action
 -> draft next actions
 -> update approved records

Content Bot
 -> find posts awaiting publishing
 -> process them
 -> update status

Finance Bot
 -> identify overdue invoices
 -> draft reminders
 -> request approval before sending
```

Multiple Bots continues to own coordination, Task ownership, approvals, capability leases and Team Runs.

Data owns the records being acted upon.

---

# Relationship to AI-Verse Automations / Cadence

Structured changes should be capable of producing events.

Examples:

```text
record.created
record.updated
record.deleted
field.changed
schema.migrated
```

This enables workflows such as:

```text
Deal.stage changes to WON
    |
    v
Automation/event policy
    |
    +-- create onboarding task
    +-- alert account Bot
    +-- generate folder structure
```

AI-Verse Data should emit facts/events. It should not become a second scheduler.

Recurring schedules remain the responsibility of the canonical automation/cadence layer.

---

# Relationship to AI-Verse Connections

External SaaS applications often contain structured data too.

AI-Verse Data must not blindly duplicate every external system and claim the copy is canonical.

The architecture should distinguish:

```text
local canonical data
external canonical data
cached/derived synchronized data
imported snapshot
```

For example:

```text
HubSpot remains canonical CRM
AI-Verse Connection queries HubSpot
Dashboard displays a projection
```

versus:

```text
AI-Verse-native CRM App
AI-Verse Data is canonical
```

Any synchronization feature must explicitly define which side owns truth and how conflicts are handled.

---

# Storage engine direction

This repository should define a stable data contract before becoming tightly coupled to one database engine.

For the local-first AI-Verse use case, **SQLite is an obvious default candidate** because it is:

- local
- portable
- transactional
- mature
- queryable
- embeddable
- easy to back up and inspect
- cross-platform

However, the architecture should ideally leave room for larger deployments to use another sanctioned backend without changing every App, Bot, and Dashboard client.

Conceptually:

```text
Apps / Bots / Dashboard
          |
          v
AI-Verse Data API
          |
          +-- local SQLite backend
          +-- future server backend
          +-- optional remote/team backend
```

The contract should be primary. The storage driver should be replaceable within defined compatibility limits.

---

# Canonical vs derived data

Every dataset should declare its authority class.

Possible classes:

```text
canonical
external_canonical
replicated
snapshot
derived
cache
```

This prevents one of the most dangerous failure modes in AI systems: a convenient local copy silently becoming more authoritative than its actual source.

Provenance should make it possible to answer:

- where did this record come from?
- who or what last changed it?
- was the change human, agent, automation, import, or external sync?
- which system/workspace owns it?
- what schema version was active?
- what was the previous value for audited fields?

---

# System and workspace isolation

AI-Verse Data must inherit the isolation principles of the wider OS.

At minimum, every scoped operation should resolve through something equivalent to:

```text
systemId
  + workspaceId
  + dataSpace/schema/entity
```

Data from one separately registered AI-Verse OS must never appear in another simply because the same Dashboard or provider is open.

Within one OS, unrelated workspaces should remain isolated unless the OS explicitly grants cross-workspace access.

No agent prompt should be capable of inventing a different system root or bypassing those boundaries.

---

# Multi-user future

If AI-Verse becomes a shared platform, Data will need to support human identity and role-aware access.

Potential future requirements:

- row-level access
- entity-level permissions
- field-level restrictions for sensitive data
- workspace membership
- actor attribution
- concurrent writes
- optimistic concurrency/version checks
- audit trails
- team-level schemas
- private/user-specific views

These should integrate with the wider AI-Verse identity/authorization layer rather than creating a second user system inside Data.

---

# Attachments and large binary objects

The structured layer should generally store references and metadata rather than pushing large media assets directly into a database.

For example:

```text
Asset record
  id
  title
  type
  status
  storage_ref
  checksum
  metadata
```

The underlying file remains in an approved filesystem/object-storage location.

This is especially important for filmmaking, image, audio, and video workflows.

---

# Schema evolution

Apps and workflows evolve, so schema migration must be a first-class concern.

A mature Data system should support:

- schema versions
- migration plans
- compatibility checks
- safe additive changes
- preview/dry-run
- backups or transactional rollback where practical
- app-version dependency declarations
- rejection of incompatible destructive changes without explicit approval

Agent-generated schema changes should not silently destroy data.

---

# Events and reactive behavior

One Kylon lesson worth preserving is that structured data becomes more useful when agents and workflows can react to it immediately.

AI-Verse Data should therefore eventually expose a normalized change stream.

Example:

```json
{
  "event": "record.updated",
  "systemId": "...",
  "workspaceId": "...",
  "entity": "deals",
  "recordId": "deal-42",
  "changedFields": ["stage"],
  "actor": "bot:sales-lead",
  "observedAt": "..."
}
```

Exact protocol is future work.

The event stream should integrate with OS policy and automations without turning Data into a workflow engine.

---

# Research findings that motivated this layer

### Kylon

Kylon demonstrates a strong AI-native pattern: humans and agents operate on structured data inside the same workspace, and apps/workflows can react directly to those records instead of relying on disconnected spreadsheets or hidden application state.

Reference: https://kylon.io/

### Modern internal-app platforms

Products such as Retool and newer prompt-first app builders validate the usefulness of quickly creating operational interfaces over structured records.

### AI-Verse-specific opportunity

AI-Verse can combine this pattern with local-first storage, strict workspace/system isolation, persistent Bots, explicit Brain reasoning, reusable Skills, and generated Apps. That combination is broader than simply adding tables to Dashboard.

---

# What this repository should eventually own

AI-Verse Data should own:

- structured Data API
- schema specification
- entity/record model
- field type system
- relation model
- query model
- validated mutations
- transaction contract
- data-space registry
- provenance metadata
- canonical/derived authority classification
- event/changefeed contract
- schema migration framework
- storage-driver contract
- backup/export/import semantics for canonical local data
- concurrency/versioning semantics
- agent-safe access patterns
- security and permission hooks

---

# What this repository must NOT own

It should not become:

- the AI-Verse OS
- AI-Verse Memory
- the Dashboard
- the Bot coordination engine
- the scheduler
- the Skills catalog
- the external integration layer
- a secret store
- a universal copy of every connected SaaS database
- an unrestricted SQL endpoint for agents

---

# Possible future repository shape

Illustrative only:

```text
AI-Verse-Data/
├── packages/
│   ├── protocol/
│   ├── schema/
│   ├── query/
│   ├── engine/
│   ├── events/
│   ├── migrations/
│   └── client/
├── drivers/
│   ├── sqlite/
│   └── future/
├── docs/
├── examples/
└── tests/
```

No implementation is committed by this founding document.

---

# Initial capability milestones

A sensible future progression could be:

1. Research and define the canonical Data contract.
2. Implement one local SQLite-backed Data Space.
3. Implement schemas, records, typed fields and safe queries.
4. Add validated mutations and transactions.
5. Add system/workspace isolation tests.
6. Add provenance and audit/change events.
7. Add a typed client for Apps, Bots and Dashboard.
8. Build first Dashboard table/form/record views.
9. Integrate one AI-Verse App end to end.
10. Add schema migrations and event-driven automations.
11. Add multi-user authorization when the wider platform requires it.

The exact phases should be researched before implementation begins.

---

# Non-negotiable invariants

1. Data authority is explicit: canonical, external canonical, replicated, snapshot, derived, or cache.
2. AI-Verse Memory's derived SQLite index does not become AI-Verse Data by accident.
3. Every operation is scoped to an authorized system/workspace.
4. Agents do not receive unrestricted database authority by default.
5. Generated Apps cannot bypass Data permissions.
6. Schema changes are versioned and validated.
7. Destructive bulk changes require stronger controls than ordinary reads.
8. External data is not silently copied and reclassified as local truth.
9. Provenance survives agent and automation writes.
10. Dashboard remains a presentation/client layer, never the canonical database owner.

---

# Final vision

AI-Verse Data should become the **structured operational substrate** of the wider OS.

Markdown can continue to hold rich human-readable knowledge and context. Memory can continue to preserve history. Connections can continue to reach external systems. Apps can provide purpose-built interfaces.

AI-Verse Data fills the missing middle:

```text
human intent
      +
AI agents
      +
applications
      +
automations
      |
      v
safe shared structured truth
```

That is the purpose of this repository.
