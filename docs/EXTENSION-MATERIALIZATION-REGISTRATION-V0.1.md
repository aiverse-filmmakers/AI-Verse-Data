# AI-Verse Extension Materialization and Registration v0.1

**Task:** 20 / 41  
**Phase:** 3.2 - Hardened extension materialization/registration  
**Status:** IMPLEMENTED  
**Public package surface:** `@ai-verse/data/native`

This document defines how AI-Verse Data installs its local extension runtime into a compatible AI-Verse OS host without modifying tracked OS files or initializing workspace Data.

## 1. Purpose

Task 20 turns a Task 19 `compatible` host into an installed local Data extension.

The operation owns only:

```text
.aiverse/extensions/ai-verse-data/
.aiverse/extensions/registry.json -> extensions["ai-verse-data"]
```

It does not own:

```text
AI-VERSE.yaml
AGENTS.md
CLAUDE.md
skills/registry.yaml
system/
operator/
workspaces/
other extension registrations
canonical workspace Data
```

## 2. Host prerequisite

Native installation begins only after the Task 19 compatibility detector returns:

```text
compatible
```

These are rejected before native install state is created:

```text
no-os
incompatible
```

There is no silent standalone fallback from an incompatible AI-Verse OS.

## 3. Public API

```ts
const installer = new AiVerseDataExtensionInstaller()

const plan = installer.plan({
  rootPath: "/path/to/AI-Verse-OS",
})

const result = installer.install({
  rootPath: "/path/to/AI-Verse-OS",
})
```

`plan()` is read-only.

`install()` performs only the Phase 3.2 local extension mutation.

## 4. Exact OS registry contract

Task 20 targets the AI-Verse OS local registry contract:

```json
{
  "schema_version": "1.0",
  "extensions": {}
}
```

The canonical registry path is:

```text
.aiverse/extensions/registry.json
```

The shared lock path is:

```text
.aiverse/extensions/registry.json.lock
```

Any existing registry must:

- be a regular non-symlink file;
- contain valid UTF-8 JSON;
- contain a top-level JSON object;
- have `schema_version` exactly `"1.0"`;
- have object-valued `extensions`;
- remain within the trusted OS root;
- remain at or below the 1 MiB Task 20 registry read ceiling.

Malformed or unsupported state is left unchanged.

## 5. Data registration identity

Data owns only the entry keyed by:

```text
ai-verse-data
```

Canonical fields are:

```json
{
  "id": "ai-verse-data",
  "supported": true,
  "installed": true,
  "enabled": true,
  "version": "0.1.0-alpha.0",
  "source": "AI-Verse-Data",
  "instructions": ".aiverse/extensions/ai-verse-data/INSTRUCTIONS.md",
  "engine": ".aiverse/extensions/ai-verse-data/engine.mjs",
  "adapters": []
}
```

The extension version is test-bound to the package version.

## 6. Preservation rules

Registration preserves:

- unknown top-level registry fields;
- unrelated extension entries;
- unknown fields on the existing `ai-verse-data` entry;
- existing `enabled: false`;
- existing `enabled: true`;
- unknown safe files already present inside the Data-owned extension directory.

Known canonical fields are updated to the current Task 20 contract.

A non-object existing Data entry fails closed.

An existing non-boolean `enabled` field fails closed because Task 20 cannot safely infer the operator's intended enabled state.

## 7. Data-owned materialized files

Task 20 owns exactly these files:

```text
.aiverse/extensions/ai-verse-data/
├── INSTRUCTIONS.md
├── engine.mjs
└── extension.json
```

### INSTRUCTIONS.md

The installed instructions establish only the current ownership/safety boundary.

They state that:

- AI-Verse Data owns structured operational truth;
- callers should use public Data package surfaces rather than open canonical SQLite directly;
- OS/workspace scope remains host-owned;
- installation does not initialize workspace databases;
- later Phase 3 tasks add richer task-relevant runtime discovery and workspace integration.

### engine.mjs

The Task 20 engine file is intentionally inert registration metadata.

It does not:

- resolve workspaces;
- open Data databases;
- execute Data operations;
- claim live health;
- grant authority.

### extension.json

The installed manifest records:

- extension identity/version/source;
- supported host schema major/architecture;
- registry and lock paths;
- installation root;
- instruction/engine paths;
- no tracked OS file mutations;
- no workspace initialization;
- registration does not grant permission;
- registration does not assert health;
- Data does not own OS canonical state.

## 8. Materialization safety

Data-owned files are updated by same-directory temporary-file staging plus rename replacement.

Before and after staging:

- the trusted root is revalidated;
- path segments remain repository-relative;
- symlink traversal is rejected;
- existing owned files must be regular non-symlink files;
- staged bytes are read back and verified;
- installed bytes are read back and verified.

Task 20 never deletes unknown files in the Data extension directory.

## 9. Path safety

The internal path validator rejects:

- absolute POSIX paths;
- rooted Windows paths;
- drive-prefixed paths;
- UNC paths;
- `..` traversal;
- `.` segments;
- empty segments;
- NUL characters.

All native installation paths are engine-owned constants rather than caller-provided destination paths.

## 10. Shared registry lock

Registry mutation uses exclusive creation of:

```text
.aiverse/extensions/registry.json.lock
```

If the lock already exists:

```text
EXTENSION_REGISTRY_BUSY
```

Task 20:

- does not delete another installer's lock;
- does not guess whether a lock is stale;
- does not steal a stale-looking lock automatically.

Only the process that successfully created the lock removes it in normal completion/failure cleanup.

## 11. Re-read inside the lock

The install sequence is:

```text
Task 19 compatibility check
  -> acquire registry lock
    -> Task 19 compatibility recheck
      -> reread latest registry
        -> validate registry schema
          -> recompute Data entry
            -> inspect current Data-owned files
              -> materialize changed Data-owned files
                -> verify materialized bytes
                  -> compare registry against exact in-lock snapshot
                    -> atomic registry replacement
                      -> verify final Data entry
                        -> release lock
```

Planning outside the lock is never treated as commit authority.

## 12. Lost-update protection

The exact raw registry text read inside the lock becomes the expected precondition.

Before replacement Task 20 rereads the registry.

If bytes differ:

```text
EXTENSION_REGISTRY_CHANGED
```

The staged replacement is discarded and the newer registry is preserved.

This protects against a competing writer that ignores the cooperative lock.

## 13. Atomic registry replacement

The new registry document is written to a unique same-directory temporary file.

Only after:

- path revalidation;
- expected-raw comparison;
- regular-file checks;

does Task 20 rename the temporary file into the canonical registry path.

Temporary registry files are removed during cleanup.

## 14. Pre-commit owned-file rollback

If materialization succeeds but registry commit fails before the registry replacement commits, Task 20 rolls its changed owned files back.

Rollback rules:

- previously absent owned file -> remove only if it still contains Task 20's installed bytes;
- previously existing owned file -> restore the exact previous bytes;
- rollback never deletes unknown files;
- if an owned file changed externally after materialization, rollback refuses destructive guessing and reports `EXTENSION_ROLLBACK_FAILED`.

Once registry commit succeeds, Task 20 does not destructively roll files backward because doing so could make committed registry state point at stale files.

## 15. Idempotent reinstall

If:

- the Data registry entry is already canonical;
- all Data-owned files already match;

then a reinstall returns:

```text
unchanged
```

Persistent registry and owned-file bytes remain unchanged.

The transient cooperative lock is still acquired/released to preserve the installation serialization boundary.

## 16. Install result states

```text
installed
updated
unchanged
```

`installed` means no previous Data registry entry existed.

`updated` means an existing registration and/or owned files required Task 20 updates.

`unchanged` means the persistent state was already canonical.

These are installation states, not health states.

## 17. No workspace initialization

Task 20 does not:

- parse `WORKSPACE.yaml`;
- create `workspaces/<id>/data/`;
- create `ai-verse-data.sqlite`;
- discover existing workspace databases;
- bind database identity;
- migrate workspace databases.

Those are Task 21 responsibilities.

Tests prove the complete `workspaces/` fixture tree remains unchanged across Task 20 installation.

## 18. No tracked OS edits

Task 20 does not write:

- `AI-VERSE.yaml`;
- `AGENTS.md`;
- `CLAUDE.md`;
- `skills/registry.yaml`;
- `system/`;
- Memory/Brain/Multiple Bots/Skills state.

Tests compare tracked host contract bytes before/after installation.

## 19. Acceptance

Task 20 proves:

- read-only planning;
- fresh schema-1.0 registry creation;
- exact Data entry registration;
- Data-owned file materialization;
- package/extension version alignment;
- unknown top-level field preservation;
- unrelated extension preservation;
- unknown Data-entry field preservation;
- `enabled: false` preservation;
- unknown Data-directory file preservation;
- persistent-state idempotent reinstall;
- malformed/unsupported registry fail-closed behavior;
- invalid existing Data entry rejection;
- cooperative lock busy behavior without lock stealing;
- path traversal/absolute/UNC/NUL rejection;
- extension-root and owned-file symlink rejection;
- expected-raw competing-writer detection;
- pre-commit file rollback while preserving the competing registry;
- no-OS/incompatible-host rejection before install state;
- no workspace database initialization;
- Node 22 and Node 24 full-suite verification.

Behavioral verification:

```text
Behavioral commit:   1e88ba758dcc1151b4de6f60e8c3b2a9822afad7
GitHub Actions run:  34606467549
Node 22:             PASS
Node 24:             PASS
Tests:               229 / 229 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

## 20. Next

Task 21 / 41, Phase 3.3, owned native workspace resolution and Data initialization and has since completed.

Task 21 consumed the verified host/installation boundaries rather than allowing callers to supply arbitrary workspace database paths.
