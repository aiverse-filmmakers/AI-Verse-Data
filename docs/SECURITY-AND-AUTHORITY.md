# AI-Verse Data Security and Authority Model

**Status:** Canonical security direction  
**Date:** 2026-09-10

## 1. Security objective

AI-Verse Data stores canonical operational records. A mistake can therefore corrupt real business/project state even when no external API is involved.

The primary security principle is:

> **The model may propose a Data operation, but trusted host state determines scope and authority, and the Data engine validates the exact effect before committing it.**

## 2. Threat model priorities

The first implementation must defend against:

1. cross-workspace data access;
2. model-supplied filesystem path escape;
3. arbitrary SQL execution by an agent;
4. silent last-write-wins corruption from concurrent agents;
5. duplicate mutations after retries/timeouts;
6. destructive bulk operations caused by ambiguous prompts;
7. schema changes that invalidate or destroy records;
8. forged actor/capability metadata from model output;
9. extension registration overwriting other extensions;
10. symlink/path traversal into another workspace or system;
11. corrupt/unsupported databases being treated as healthy;
12. canonical Data being mistaken for disposable runtime state;
13. Memory or Dashboard copies becoming competing truth;
14. future App code acquiring undeclared Data access;
15. future connection sync creating ambiguous authority.

## 3. Authority hierarchy

Native mode authority should conceptually intersect:

```text
AI-Verse OS host policy
INTERSECT
workspace policy
INTERSECT
principal grants
INTERSECT
Task/App/Automation capability grant
INTERSECT
Data operation policy
```

A denial anywhere blocks the operation.

Data itself should not attempt to replace the OS policy engine or Multiple Bots permission model. It should require a trustworthy authorization context at integration boundaries and still apply its own structural safety rules.

## 4. Trusted scope

The OS root is selected by trusted local configuration/host code.

The workspace is resolved beneath that root and verified through `WORKSPACE.yaml`.

The engine constructs the canonical Data path itself:

```text
<trusted-os-root>/workspaces/<validated-workspace>/data/ai-verse-data.sqlite
```

Normal API clients never provide this path.

A workspace database embeds its expected workspace ID. Mismatch fails closed.

## 5. Path safety

Before opening or creating native storage:

- resolve the trusted OS root;
- validate workspace ID syntax;
- locate the workspace using trusted host rules;
- reject traversal segments;
- reject absolute path injection;
- reject NULs;
- reject Windows drive/UNC injection where applicable;
- resolve real paths where safe;
- reject symlink/reparse-point escape from the authorized workspace;
- verify existing database is a regular file;
- avoid following user/model-controlled links outside the workspace.

No `../../other-workspace` escape is acceptable even if the requesting agent otherwise has Data write permission in its own workspace.

## 6. No arbitrary SQL by default

Agent-facing and App-facing APIs accept structured operations only.

The engine compiles validated query/mutation ASTs to parameterized SQL internally.

Do not expose a general endpoint like:

```text
data.sql("<model generated query>")
```

A future administrative SQL console, if ever added, must be explicitly privileged, human-facing, and separate from ordinary agent capabilities.

## 7. Schema validation

All records validate against the active entity schema before commit.

Validation covers:

- known fields;
- required fields;
- field types;
- enum membership;
- length/value bounds;
- reference target shape/existence when required;
- record size limits;
- attachment reference rules;
- unknown-field policy.

Do not rely only on SQLite dynamic typing.

Internal tables should use SQLite STRICT mode where practical, and application-level validation remains authoritative for the public type system.

## 8. Concurrency safety

Every mutable record has a version.

Update/delete requests carry `expectedVersion`.

Phase 2.1 enforces the decisive comparison at the canonical storage write. SQLite update/delete statements include the expected record version in the `WHERE` predicate, and record mutation paths use short immediate write transactions so competing local writers cannot both advance the same version.

A mutation succeeds only when the stored version matches the caller's expected version.

Conflict response exposes `expectedVersion` and the observed `currentVersion` when available so the caller can re-read and decide. The engine does not silently merge incompatible edits.

Automated retry after a version conflict is not universally safe. The caller must re-evaluate the operation against current state.

Real separate-process race tests prove that multiple writers released against version N produce exactly one N -> N+1 commit and stale conflicts for the losers.

## 9. Idempotency safety

Agent and automation writes can be retried due to uncertain transport outcomes.

An idempotency key is bound to a canonical request fingerprint.

Rules:

- same key + same fingerprint after successful commit -> return same result/receipt;
- same key + different fingerprint -> `IDEMPOTENCY_CONFLICT`;
- in-progress/uncertain states must not be converted into duplicate execution without recovery semantics;
- idempotency records belong to Data's canonical mutation-control history and follow a defined retention policy.

Idempotency does not allow bypassing current authorization or version checks on a genuinely new operation.

## 10. Transaction safety

Transactions are:

- limited to one workspace database in v0.1;
- bounded by operation count/size;
- fully validated before/while executing;
- rolled back on any failed required operation;
- assigned one transaction ID and per-effect receipts/events as appropriate.

Do not hold write transactions open while calling models, external APIs, or waiting for human approval.

Plan first. Authorize. Then open a short local transaction and commit.

## 11. Delete safety

Normal record delete is soft delete.

Bulk deletion requires stricter bounds and should support dry-run/preview before commit.

Hard purge is not a normal v0.1 agent capability.

Future purge must require explicit destructive authority and should support backup/export before irreversible deletion.

## 12. Schema-change safety

An AI-generated schema proposal is untrusted input.

The engine determines whether the change is:

```text
safe_additive
migration_required
denied
```

No model may directly execute DDL.

Destructive schema changes require an explicit migration plan and future approval/backup rules.

## 13. Actor provenance

Every mutation stores a structured actor reference.

Supported conceptual actor kinds:

```text
human
bot
worker
app
automation
system
import
connection
```

Actor identity must come from trusted host/integration context where available.

Do not let the model claim `human:owner` or another Bot identity inside its payload and treat that as authentication.

## 14. Capability boundaries

Capability grants should be narrow enough to express Data Space/entity/action scope.

Examples:

```text
data:crm:deals:read
data:crm:deals:update
data:content:posts:create
```

A Bot with `crm.deals:read` must not mutate records.

A Bot with update access to `crm.deals` must not automatically gain schema-management or purge authority.

A Task delegated to a stronger Bot cannot gain permissions the Task did not already hold.

## 15. Approval boundary

Some Data effects are more consequential than others.

Potential future risk classes:

```text
read
single_record_reversible_write
bulk_reversible_write
schema_change
delete
hard_purge
import_overwrite
permission_change
sync_authority_change
```

Data should expose effect/risk metadata so the OS/Brain/host approval policy can make the final decision.

The Data engine should not create a second independent human-approval system when the host already owns that concern.

## 16. Database integrity

`doctor` should use safe SQLite integrity facilities and Data metadata validation.

On detected corruption:

- stop writes;
- report `DATABASE_CORRUPT`;
- do not silently recreate an empty database at the same path;
- do not claim success with an empty query result;
- provide recovery/backup guidance through explicit commands.

Automatic destructive repair is not a safe default.

## 17. SQLite configuration safety

Expected local controls include:

- `PRAGMA foreign_keys=ON`;
- WAL only for local supported storage;
- bounded busy timeout;
- short write transactions;
- explicit migration transactions;
- prepared/parameterized statements;
- integrity checks;
- safe backup API or equivalent consistent backup path.

Do not open one canonical WAL database directly from multiple machines over a shared network filesystem.

## 18. Secrets

AI-Verse Data is not a secret manager.

Do not encourage storage of:

- passwords;
- OAuth refresh tokens;
- API keys;
- private keys;
- recovery codes;
- raw session cookies.

Store Connection handles or secret-store references instead where a structured record needs to reference external access.

If a user explicitly builds a specialized secrets product later, it requires a separate threat model and encrypted storage contract.

## 19. Sensitive structured data

Operational Data may legitimately contain sensitive business or personal records.

The first local-first release should:

- keep workspace data local by default;
- rely on OS/workspace privacy boundaries;
- avoid logging full record payloads unnecessarily;
- redact sensitive values from diagnostic traces;
- provide bounded query/result logging;
- avoid sending whole databases to models;
- retrieve only required fields/records for a task.

Future hosted/multi-user mode will require stronger tenant, row, and field access controls.

## 20. Logging

Operational logs should capture:

- request/receipt IDs;
- operation class;
- workspace/Data Space/entity;
- actor reference;
- duration;
- success/error code;
- record/event IDs;

but avoid logging full sensitive record payloads by default.

Debug modes that include values must be deliberate and clearly marked.

## 21. Event safety

Data events represent committed facts.

Events should be emitted only after successful commit, ideally appended within the same storage transaction.

Consumers cannot treat an attempted mutation as a committed event.

Events may trigger automations later, so they need stable IDs and idempotent downstream consumption semantics.

## 22. Backup safety

A backup is valid only when:

- it represents a consistent committed state;
- its source workspace/database is identified;
- format/schema metadata is recorded;
- the resulting artifact is verified/digested where practical;
- completion produces a receipt.

Copying a live WAL main `.sqlite` file alone is not automatically a valid backup if accompanying state is omitted.

## 23. Installation security

Installer threats include:

- overwriting other extensions;
- path escape during materialization;
- partially installed engine state;
- registry lost updates;
- stale/foreign lock handling;
- unsafe source files;
- unsupported host versions.

The installer should reuse the hardened principles already proven in the AI-Verse OS extension ecosystem: validate, lock, re-read, merge only owned state, write atomically, preserve unknown state, and fail closed.

## 24. Uninstall security

Default uninstall must not delete user-owned canonical Data.

If the engine is removed, preserved workspace databases remain user-owned files.

Any future purge command is separate, explicit, scope-bound, and destructive.

## 25. Future App security

Apps must receive a Data client whose effective permissions are derived from the App manifest plus host/user grants.

An App update requesting broader Data access requires permission review.

App frontend code must never receive a raw local database path just because it runs inside Dashboard.

## 26. Future Connections/sync security

Before external sync exists, Data supports `local_canonical` only.

Future sync must define authority and conflict behavior before any write path ships.

Never let a convenient local replica silently become canonical because the external API is temporarily unavailable.

## 27. Security acceptance laws

The following must become tests:

1. workspace A cannot open workspace B's Data through traversal or symlink tricks;
2. mismatched embedded workspace ID blocks access;
3. raw SQL is unavailable to ordinary agent operations;
4. malformed queries never reach string-concatenated SQL;
5. concurrent stale update is rejected;
6. same idempotency key cannot produce two effects;
7. different payload with reused idempotency key is rejected;
8. failed transaction leaves no partial required record changes;
9. corrupt/unsupported database fails closed;
10. reinstall/update preserves Data and other extension entries;
11. uninstall preserves canonical databases;
12. disabled extension cannot be invoked through normal host discovery;
13. forged model actor/capability fields do not grant authority;
14. Memory/Dashboard caches cannot be mistaken for canonical Data.
