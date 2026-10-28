# Canonical Canvas Groups v1: owner contract and migration safety

**29 October 2026.** Draft PR #23 stacked on Data Canvas owner draft PR #22.

Canvas note grouping is canonical **Data SQLite** state. There is
no second Dashboard-owned grouping table or localStorage state.
The grouped board extends `CanvasBoard` with **optional**
`groups: [{id,label,nodeIds}]`; original boards retain their exact
`{nodes,edges}` shape to preserve previously recorded immutable
revision digests. Old documents can still be opened, edited, copied,
reverted or inspected with no migration rewrite.

A group holds 2–150 existing unique note IDs. A note can belong
to at most one group. Groups cannot share identifiers with notes,
edges or other groups. No nested groups. Maximum 50 groups per
board and 150 notes total. Group label 1–80 characters.

The five `CanvasDocuments.edit` operations are:

- `group.create`: add group with exact ID, label and member notes.
- `group.rename`: update label only.
- `group.members`: replace member IDs atomically, no implicit cross-group stealing.
- `group.move`: shift all member note coordinates by finite bounded `dx`, `dy` in ONE Data transaction.
- `group.remove`: remove group membership only; **do not delete notes or edges**.

Deleting a note updates any group that contained it; a remaining
single-note group dissolves automatically. All group changes use
existing actor provenance, Data scoped storage binding, expected
revision CAS, durable revision history, undo, Data-owned duplicate,
and an intent-keyed idempotency replay **before** group uniqueness
checks. Otherwise repeating an already committed `group.create`
could incorrectly reject with `CANVAS_GROUP_CONFLICT`. Finite
coordinates are checked before Data idempotency canonicalization,
so unsafe values fail with the original Canvas error rather than
a generic fingerprint exception.

**Verification:** `test/canvas-groups.test.ts` contains 35
individual cases. The existing entire Data regression suite runs
alongside these. [Data grouping Linux/macOS/Windows CI
40781700269](https://github.com/aiverse-filmmakers/AI-Verse-Data/actions/runs/40781700269)
passed on all three platforms at code commit
`35ebd098fbd809d75ba3727c1c3ead61f2f2f8d3`.

Dashboard's `CanvasOwnerBridge` does strict typed RPC and projection;
its real canonical Data/Gateway composition must pin this exact
source and ensure owner OS grants and bot run status stay intact.

**Not authorized:** creating new Data scopes from Canvas RPC,
changing OS human/bot grants, unapproved destructive actions,
provider-connected assets, desktop installation, automatic
cross-workspace grouping, or production model-tool dispatch.
Source remains draft/unmerged pending independent review.
