# Canonical Canvas documents v1 (Data owner)

**Status:** owner-source implementation and disposable CI proof in [Data draft PR #22](https://github.com/aiverse-filmmakers/AI-Verse-Data/pull/22), not a member release or connected Dashboard UI.

## Why this is Data-owned

The OS owns system/workspace topology. Gateway owns conversation sessions and authenticated runtime runs. **Data owns canonical structured document records.** The Dashboard and the future Canvas view remain readers/presenters and send operations only through a separately approved trusted host/OS-to-Data authority route. This feature adds no Dashboard database, browser-local canonical state, provider login or direct privileged browser endpoint.

The new `@ai-verse/data/canvas` subpath exports `CanvasDocuments` for an already-open **trusted scoped DataStorageDatabase**. Both workspace-scoped databases (`workspaces/<workspace>/data/ai-verse-data.sqlite`) and standalone Personal scopes are supported. The constructor checks the Data binding and initializes its own `creative-canvas` Data Space and `documents` schema, refusing an incompatible prior schema rather than silently migrating it. Caller identity, actor and permission checks remain the responsibility of the trusted owner path; **this class must not be constructed from an untrusted browser frame or arbitrary filesystem path**.

## Implemented operation semantics

- `create({title,actor,idempotencyKey})` creates a new empty board.
- `list(limit)` and `get(documentId)` read documents from their own canonical Data scope.
- `rename({id,title,expectedVersion,actor,idempotencyKey})` replaces a title via Data's optimistic version check.
- `edit({id,edit,expectedVersion,actor,idempotencyKey})` applies one bounded node/edge edit: add, move, change note text, remove note, connect/disconnect notes. Removing a note removes its dangling edges.
- `delete({id,expectedVersion,actor,idempotencyKey})` performs Data's standard soft-delete (no arbitrary filesystem deletion).
- User note text is limited to 5,000 characters, max 150 notes and 300 connections, bounded coordinates and strict stable IDs. Invalid edits are rejected before any write. Each accepted operation passes through Data's existing version/idempotency/provenance machinery.

The stored document is a canonical Data record with a title and a JSON board (`nodes` and `edges`). This is an initial bounded editing format, **not** an asset/attachment storage owner, collaborative infinite-canvas protocol, or substitute for OS permission checks. Existing canonical Data schema, record, SQLite and provenance machinery remain unchanged.

## Verification and known limits

`test/canvas.test.ts` opens actual Data scoped SQLite databases; creates notes and links, closes and reopens the database, checks persistent content and versions, then moves/renames/removes/soft-deletes. It tests workspace-to-workspace and workspace-to-Personal isolation, repeated create idempotency, stale edit rejection, invalid IDs and numeric positions. The normal Data CI workflow runs this on Node 22/24 and Windows/macOS/Linux.

Uncertain non-create edit retries remain **conflict-aware**, not silently replayed into a newer document revision: if a UI loses its receipt, it should reread the canonical record, reconcile and require explicit retry/undo handling. A UI-facing authenticated host action interface, approved actor provenance, automatic workspace creation/reuse, Canvas library with duplicate/undo and agent/manual action parity are **separate future gates**. Do not claim any of those are available merely because this storage owner is in place.

**Next Dashboard integration:** inspect OS host authorization and Data owner attachment/permission contracts; add a narrow authenticated Canvas document projection and explicit action facade that binds system/workspace/document/version and idempotency to the trusted principal. Then build the clean Personal Canvas library and node editor against that facade, preserving the separate disconnected design preview.


## Task 16: atomic Canvas duplicate

`CanvasDocuments.duplicate({id,expectedVersion,title?,actor,idempotencyKey})`
is an actual Data-owned, **single SQLite transaction** over the existing
`creative-canvas.documents` Data record engine. The owner loads the
source board and expected source version under an immediate transaction,
validates its complete graph, and creates one new Data document containing
all notes and edges. The clone starts at Data version 1, with independent
Data actor provenance. No UI or Dashboard record cache is authoritative.

The public idempotency key has its own `canvas.duplicate` request
fingerprint binding source ID, expected source version, actor and optional
title. A deterministic internal Data create key ensures the one-record
effect and outer operation idempotency receipt commit together.
An identical retry returns the same saved clone **even if the source
subsequently changes**. A changed payload with the same key is rejected;
a new key against an outdated version is rejected with
`RECORD_VERSION_CONFLICT`. SQLite rollback prevents empty or partially
populated clones after failures.

`test/canvas.test.ts` tests actual scoped SQLite, two notes, connection
integrity, one-record version, retry after source mutation, stale rejection
and idempotency conflict. Data CI uses Node 22/24 on Linux, macOS and
Windows. Source revision `5caa5d08151f85e503e8ceace494458736b76886`
passed release smoke and all six CI matrix jobs. This does not imply
owner acceptance/merge or a production local installation.

**Undo remains a separately qualified blocker.** Current Data
provenance stores version IDs, actor/time and event/receipt metadata but
not immutable before-state board snapshots. It is unsafe to advertise
historical undo or restore a browser-provided prior board as canonical.
A future Data-owned revision archive/reversal operation must guarantee
authentic before-state, version fencing, idempotency, bounded retention,
scope and permission policy before an Undo control can be exposed.


## Tasks 19-20: authoritative Canvas revision archive and revert

`CanvasDocuments` now initializes a second **canonical Data entity** under
the same trusted `creative-canvas` Space: `revisions`. No new database,
filesystem path, Dashboard document store or format migration is introduced.

The owner archives full bounded board, title, original document ID,
version, original timestamps and a deterministic SHA-256 consistency digest
as a separate Data record in the **same SQLite transaction** as the source
create/edit/rename/clone/revert. An existing pre-history document is
first archived at its next authorized write; previous versions before
this feature became active are **not reconstructed or invented**. History
reads verify the consistency digest, strict board shape and duplicate
version prohibition. The archived actor is taken from the version's
canonical Data provenance, not the *next* human/bot writer. This matters
for cross-actor edits and stable idempotency.

`history(id, limit=20)` returns up to 30 latest verified snapshots for an
existing, nondeleted scoped document. The bounded scan currently refuses
scopes with 5,000 or more total revision records rather than returning
misleading incomplete history. This bound is a future pagination/index
qualification item, not an unlimited lifetime guarantee. A digest
detects accidental/internal inconsistency but is not a digital signature
or authorization grant; only trusted Data access can write the archive.

`revert({id,toVersion,expectedVersion,actor,idempotencyKey})` looks up
an *existing* verified Data revision under the same immediate SQLite
transaction. It rejects absent revisions, stale versions, foreign scope,
future/current target versions and deleted documents. The effect
creates a **new version** via Data's original optimistic record engine
and provenance. It never modifies an old revision, hard-deletes
content or accepts browser-supplied snapshot contents. Identical
idempotency retries return one committed version, even after the live
document advances. A changed retry conflicts. The former version
remains available so undo itself is reversible through a new version.

**Limits and release gates:** this is an owner-authorized reversible
mutation, **not** a complete recovery system for deleted documents,
cross-workspace migration, history retention policy, tamper-proof
signed archive, unlimited revision listing or real installed Mac
operation. Only the trusted host is entitled to open the scope, check
actor grants and evaluate OS permission before invoking these methods.
The human UI uses two-stage confirmation; agents may read authorized
history but cannot invoke revert absent independently reviewed human
approval receipts. Data PR #22 remains unmerged and draft.
