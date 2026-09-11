# AI-Verse Data Product Requirements Document

**Status:** Canonical product direction for first implementation  
**Date:** 2026-09-10  
**Implementation:** Not started

## 1. Product definition

AI-Verse Data is the canonical structured-data layer for AI-Verse.

It gives humans, agents, Apps, Skills, Automations, Brain adapters, and Dashboard clients a safe way to create, query, update, relate, and observe structured operational records without turning AI-Verse Memory into a generic database and without letting every App create its own hidden source of truth.

The core product promise is:

> **AI-Verse should be able to operate on real structured records as naturally as it operates on Markdown, while preserving one source of truth, workspace isolation, provenance, and explicit authority.**

Examples of structured operational data include:

- customers, contacts, deals, and activities;
- productions, shoot days, crew, locations, and deliverables;
- content items, publishing queues, assets, and performance records;
- invoices, payments, expenses, and financial operational records;
- inventory, orders, projects, tasks, metrics, and application records;
- any future user-defined structured entity that is better represented as rows/records than narrative files.

## 2. Why this product exists

AI-Verse OS already distinguishes current context, historical memory, knowledge, decisions, connections, capabilities, automations, Apps, and runtime state. Structured operational records are another distinct class of information.

Markdown is excellent for narrative and inspectable truth. It is not an efficient representation for large mutable collections such as 20,000 customer records or thousands of content-performance rows.

AI-Verse Memory is intentionally optimized for historical recall. Its SQLite database is derived and rebuildable from canonical memory/context sources. A CRM, invoice ledger, or production database cannot use that lifecycle because deleting the database must not delete the canonical records.

AI-Verse Data exists to fill that gap cleanly.

## 3. Product goals

The first release must:

1. provide canonical structured storage for one AI-Verse workspace at a time;
2. remain optional and independently installable;
3. install into AI-Verse OS v2 without editing upstream-tracked OS files;
4. preserve all canonical Data when the engine is updated, disabled, or uninstalled;
5. provide a safe typed API rather than arbitrary agent SQL;
6. support schema definition, records, relations, validated queries, and validated mutations;
7. support transactions for related mutations;
8. provide optimistic concurrency so two agents do not silently overwrite each other;
9. provide idempotency for retryable agent/automation writes;
10. emit append-oriented mutation events and receipts with actor provenance;
11. enforce workspace scope and fail closed on path or identity mismatch;
12. support local-first operation with SQLite as the first storage driver;
13. keep the storage contract abstract enough for a future server/team driver;
14. integrate with the wider AI-Verse ecosystem through explicit adapters rather than duplicated state.

## 4. Non-goals for the first release

The first release will not attempt to become:

- a replacement for AI-Verse Memory;
- a knowledge graph database;
- a hosted multi-tenant SaaS database;
- a real-time collaborative spreadsheet;
- a warehouse or analytics lake;
- an unrestricted SQL service for models;
- an ORM for arbitrary third-party applications;
- a replication engine for every connected SaaS product;
- a new scheduler or workflow engine;
- a new identity provider;
- a secret manager;
- a Dashboard implementation;
- an App builder.

Those systems may consume Data later, but Data should remain focused on structured truth and safe structured operations.

## 5. Primary users and callers

### Local operator

The human can inspect and operate Data through a CLI and, later, Dashboard/App surfaces.

### AI agent / Bot / Worker

An agent receives bounded Data capabilities and performs validated operations. It should never receive raw database credentials or an unrestricted SQL prompt surface by default.

### AI-Verse App

An App declares required Data schemas/capabilities and uses a typed client to read or mutate canonical records.

### AI-Verse Dashboard

Dashboard displays tables, forms, records, charts, and change history. It never owns Data and never opens canonical databases from browser code.

### Automation

An automation can use Data operations and can react to Data events through the owning OS/automation layer.

### Brain adapter

Brain may request bounded structured state to evaluate goals or current conditions. Data remains the owner of records and Brain remains the owner of strategic reasoning.

## 6. Core user stories

### Create a structured system

> As an operator, I can create a Data Space called `crm`, define `companies`, `contacts`, and `deals`, then create records without writing SQL.

### Agent-safe mutation

> As a Sales Bot, I can update the `next_action` of a permitted deal without gaining the ability to alter unrelated tables, workspaces, or database files.

### Concurrency safety

> If two agents read version 7 of the same record and both attempt an update, the second conflicting write is rejected instead of silently overwriting the first.

### Retry safety

> If an automation retries the same mutation after a timeout, the same idempotency key returns the original result rather than creating a duplicate record.

### Provenance

> I can determine whether a record was last changed by a human, Bot, App, automation, import, or future connection sync.

### App foundation

> A future AI-Verse App can declare a CRM schema and use Data as the durable record layer instead of hiding business records inside the frontend.

### Clean installation order

> AI-Verse Data works when installed before or after Memory, Brain, Skills, Multiple Bots, Apps, Connections, or Dashboard.

## 7. Information ownership

AI-Verse Data owns only structured operational truth created or explicitly imported as Data-owned truth.

It does not automatically own:

- operator profile;
- current narrative workspace context;
- historical memory;
- strategic goals;
- knowledge documents;
- Bot coordination state;
- Skills;
- external SaaS truth;
- Dashboard caches;
- App source code.

Every stored dataset must have a declared authority class. First release support is intentionally narrow:

- `local_canonical` - AI-Verse Data is authoritative.

Future classes may include:

- `external_canonical`;
- `replicated`;
- `snapshot`;
- `derived`;
- `cache`.

The first release must not implement synchronization semantics for those future classes merely because their names exist.

## 8. Scope model

The first native AI-Verse release is workspace-first.

Each active workspace may have its own canonical Data database:

```text
workspaces/<workspace-id>/data/ai-verse-data.sqlite
```

This provides a strong physical boundary in addition to logical authorization.

The first release does not require operator-wide or shared cross-workspace databases. Those can be added later only after an explicit authority and privacy design.

Standalone mode may use:

```text
.ai-verse-data/data.sqlite
```

but standalone storage must never be silently selected when the target looks like an incompatible AI-Verse OS. Incompatible AI-Verse hosts fail closed.

## 9. Core product primitives

### Data Space

A logical namespace inside one workspace database, such as `crm`, `production`, or `content`.

### Entity Schema

A versioned definition of one record type and its fields.

### Record

One canonical structured object with a stable ID, schema version, record version, timestamps, provenance, and data payload.

### Relation

A typed reference between records.

### Query

A bounded structured filter/sort/page/aggregate request. Queries are compiled by the engine. Agents do not provide raw SQL.

### Mutation

A validated create/update/delete operation.

### Transaction

A group of mutations that succeeds or fails atomically within one workspace database.

### Event

An append-oriented description of a committed state transition.

### Receipt

A caller-facing proof of the committed operation, including stable IDs, versions, scope, and provenance.

## 10. Field types for first release

The initial public schema type system should stay small and predictable:

- `string`
- `integer`
- `number`
- `boolean`
- `date`
- `datetime`
- `enum`
- `reference`
- `json`
- `attachment_ref`

A money/currency helper may be added when its semantics are explicitly defined. It should not be a vague floating-point alias.

Fields may support constraints such as:

- required;
- unique within an entity where supported;
- enum choices;
- default value;
- min/max for numeric values;
- length limits;
- reference target.

## 11. First-release command surface

Exact wire shapes belong to the protocol document, but the product should expose operations equivalent to:

```text
data.space.list
data.space.create
data.space.get

data.schema.list
data.schema.get
data.schema.create
data.schema.update

data.record.create
data.record.get
data.record.list
data.record.update
data.record.delete

data.query
data.aggregate

data.transaction.execute

data.events.list
data.doctor
```

Hard purge, arbitrary SQL, cross-workspace query, remote synchronization, and destructive schema migration are not normal first-release operations.

## 12. UX principles

Even though this repository does not own Dashboard UI, its API should make a professional UI straightforward.

The system should enable future interfaces such as:

- tables;
- record forms;
- record inspector;
- Kanban;
- calendar;
- charts;
- filtered saved views;
- relation explorer;
- mutation history.

Errors should be structured and actionable. An agent should be able to distinguish:

- record not found;
- schema mismatch;
- invalid field;
- version conflict;
- permission denied;
- workspace mismatch;
- idempotency conflict;
- storage unavailable;
- migration required.

## 13. Reliability requirements

- Canonical writes must be transactional.
- Foreign-key enforcement must be enabled where the internal model uses it.
- Database integrity can be checked without modifying records.
- Writes must never silently continue after detected corruption.
- Record updates require version-aware semantics.
- Agent/automation writes use idempotency keys.
- Soft delete is the default delete behavior for first release.
- Hard purge is separate, explicit, and strongly restricted.
- Schema changes are versioned.
- Destructive schema changes require the explicit governed user-schema migration machinery rather than ad-hoc SQL; Phase 2.7 implements bounded preview, deterministic backfills, approval metadata, atomic active-record rewrite, and migration provenance.
- Backups/exports must produce deterministic metadata and verify completion.

## 14. Local-first storage requirements

SQLite is the first storage backend because it is local, portable, transactional, mature, cross-platform, and suitable for an embedded OS extension.

The first implementation should use WAL mode only on supported local filesystems. SQLite WAL permits concurrent readers while a writer is active, but still serializes writers and is not suitable for a database shared directly over a network filesystem.

The implementation should use SQLite STRICT internal tables where practical and validate JSON payloads at the application boundary.

The public Data API must not depend on SQLite-specific SQL syntax so a future server driver can implement the same higher-level contract.

## 15. Success criteria for first useful release

AI-Verse Data is useful when all of the following are true:

1. a clean AI-Verse OS v2 installation can install Data without tracked-file changes;
2. a user can create a Data Space and schema in one workspace;
3. records can be created, queried, updated, related, and soft-deleted safely;
4. conflicting writes are detected;
5. retried writes are idempotent;
6. every committed mutation produces provenance and a receipt/event;
7. another workspace cannot enumerate or mutate those records;
8. disabling/uninstalling Data leaves canonical workspace databases untouched;
9. reinstalling Data discovers and validates existing compatible Data databases;
10. Data operates without Memory, and Memory operates without Data;
11. optional adapters can query Data without copying canonical records into Brain, Bots, Dashboard, or Memory;
12. tests pass on macOS, Linux, and Windows.

## 16. Deferred product decisions

These are deliberately not locked in the first release:

- operator-wide/shared Data Spaces;
- hosted multi-user backend;
- row-level multi-human ACLs;
- full-text search strategy across records;
- semantic/embedding index;
- external source synchronization;
- materialized views;
- computed formulas;
- realtime remote collaboration;
- audit retention policies for enterprise use;
- App-specific schema ownership and migration orchestration;
- Postgres or other server backend.

## 17. Product boundary statement

> **Memory remembers history. Brain reasons about direction. OS owns scope and policy. Multiple Bots coordinates work. Skills define reusable methods. Connections reaches external systems. Apps creates persistent software experiences. Dashboard presents the system. Data owns structured operational records.**

If an implementation decision violates that sentence, it requires an explicit architecture review before code is merged.
