# AI-Verse Data Installation and Lifecycle

**Status:** Canonical install/lifecycle direction  
**Date:** 2026-09-10

## 1. Goal

Installing AI-Verse Data should feel native without modifying or taking ownership of AI-Verse OS itself.

The target experience is eventually:

```bash
npx github:aiverse-filmmakers/AI-Verse-Data install
```

or an equivalent published command later.

The installer should be safe to run:

- on a fresh AI-Verse OS;
- after Memory, Brain, Skills, Multiple Bots, Dashboard, Apps, or Connections;
- before those layers are installed;
- repeatedly for repair/update purposes;
- without overwriting canonical workspace Data.

## 2. Installation states

Keep these states distinct:

```text
package available
!= extension materialized
!= registered
!= enabled
!= healthy
!= workspace initialized
!= authorized for mutation
```

A registry entry is not evidence that a workspace database exists or is healthy.

## 3. Native AI-Verse OS compatibility gate

A native host is compatible only when the installer can verify the required AI-Verse OS v2 contract, including at minimum:

- `AI-VERSE.yaml` exists as a regular safe file;
- major schema version is 2;
- architecture is `unified-workspace`;
- `AGENTS.md` exists;
- `operator/` exists;
- `workspaces/` exists;
- `system/extensions/README.md` exposes the local extension registry contract;
- the runtime contract references `.aiverse/extensions/registry.json`.

Unsafe, malformed, unsupported, or incomplete AI-Verse layouts fail closed.

The installer must not silently fall back to standalone mode when it detects an AI-Verse host that is present but incompatible.

## 4. Native extension placement

Extension-owned runtime material should live under:

```text
.aiverse/extensions/ai-verse-data/
├── INSTRUCTIONS.md
├── engine.mjs
├── package metadata as needed
└── optional adapter/runtime files owned only by Data
```

The exact packaged file layout may evolve, but all normal extension material must remain under its owned local extension path unless a separate OS contract explicitly authorizes another location.

## 5. Local extension registration

Register only the `ai-verse-data` entry in:

```text
.aiverse/extensions/registry.json
```

Conceptual entry:

```json
{
  "id": "ai-verse-data",
  "supported": true,
  "installed": true,
  "enabled": true,
  "version": "0.1.0",
  "source": "AI-Verse-Data",
  "instructions": ".aiverse/extensions/ai-verse-data/INSTRUCTIONS.md",
  "engine": ".aiverse/extensions/ai-verse-data/engine.mjs",
  "adapters": []
}
```

Registration must:

- validate registry schema;
- preserve unknown top-level fields;
- preserve unrelated extension entries;
- preserve unknown fields on the existing Data entry where safe;
- preserve existing `enabled: false` on reinstall/update unless explicitly changed;
- use exclusive mutation protection compatible with the OS extension contract;
- re-read inside the lock before write;
- use atomic replacement;
- reject path traversal, absolute paths, unsafe symlinks, malformed files, and unsupported registry versions.

The safest implementation should mirror the hardened registration behavior already proven by AI-Verse Multiple Bots rather than inventing a looser registry writer.

## 6. Canonical workspace Data creation

Installing Data does **not** create databases in every workspace.

Installation makes the capability available.

A workspace database is created only when Data is explicitly initialized or first used through a deliberate creation path.

Preferred command shape:

```bash
ai-verse-data init --root /path/to/AI-Verse-OS --workspace <id>
```

or equivalent native runtime invocation.

The engine resolves the workspace from the trusted OS root, validates `WORKSPACE.yaml`, and creates:

```text
workspaces/<id>/data/ai-verse-data.sqlite
```

The database metadata binds itself to that workspace ID.

Reopening a database whose embedded workspace ID conflicts with the actual workspace must fail closed.

## 7. Existing database discovery

On reinstall/update, Data should discover existing canonical workspace databases only through validated workspace roots.

It must not recursively scan the user's entire home directory.

Discovery may inspect:

```text
<trusted OS root>/workspaces/<authorized-id>/data/ai-verse-data.sqlite
```

and validate:

- regular-file status;
- no symlink escape;
- database format metadata;
- workspace binding;
- engine compatibility;
- migration state;
- integrity status when requested.

## 8. Standalone mode

Standalone mode should remain possible for portability, but it is secondary to native AI-Verse use.

Conceptual standalone structure:

```text
project/
└── .ai-verse-data/
    ├── data.sqlite
    └── local metadata
```

Standalone mode must have its own explicit scope model and cannot pretend to provide AI-Verse workspace authorization.

If a compatible AI-Verse OS is detected, native mode is preferred.

If an incompatible AI-Verse OS is detected, fail instead of creating a competing standalone store.

## 9. Install behavior

A safe native install should approximately:

1. resolve the target root;
2. detect whether it is AI-Verse OS v2, standalone, incompatible, or absent;
3. fail on unsafe/incompatible AI-Verse host;
4. stage Data-owned extension files;
5. verify staged content/digests;
6. acquire extension-registry mutation lock;
7. re-read and validate latest registry;
8. materialize/activate extension-owned files safely;
9. merge only `ai-verse-data` registry entry;
10. atomically commit registration;
11. release lock;
12. run Data `doctor` without mutating canonical user records;
13. print exact mode/status and next steps.

The installer should not initialize every workspace automatically.

## 10. Update behavior

Updating the Data engine and migrating canonical Data are different operations.

### Engine/package update

May update:

- Data-owned extension engine files;
- instructions;
- package metadata;
- Data's own registry version metadata.

Must not automatically rewrite user records.

### Internal database-format migration

If a newer engine requires database-format migration:

1. detect database version;
2. verify compatibility;
3. produce/validate migration plan;
4. create a consistent safety backup where required;
5. run migration transactionally where possible;
6. record migration receipt;
7. run integrity checks;
8. fail visibly if migration cannot be proven complete.

Unknown/newer database formats must not be guessed or downgraded.

## 11. Schema migration behavior

User-defined entity-schema evolution is distinct from internal engine migration.

For first release, safe additive schema changes can be supported directly.

Destructive changes should require a separate explicit migration request with preview/validation.

The installer must never alter user entity schemas merely because the package version changed.

## 12. Disable behavior

Disabling the extension should change only its enabled state/availability.

Canonical Data remains untouched.

Expected outcome:

```text
engine installed
registry enabled = false
workspace databases preserved
normal runtime does not select Data
```

## 13. Uninstall behavior

Default uninstall removes/deactivates only software owned by AI-Verse Data.

It must preserve canonical Data by default.

Expected default:

```text
remove/unregister Data engine
remove Data-owned local extension runtime files
preserve:
  workspaces/*/data/ai-verse-data.sqlite
```

The user must be able to reinstall Data later and recover access to compatible preserved databases.

## 14. Purge behavior

Purging canonical Data is a separate destructive operation, not an uninstall side effect.

A future purge should require:

- explicit workspace selection;
- explicit confirmation/approval;
- clear record of what will be deleted;
- backup/export option;
- no wildcard cross-workspace purge by default;
- safe path resolution;
- post-operation receipt.

There should be no ambiguous `uninstall --all` that silently destroys canonical records.

## 15. Installation order requirements

The installer must be tested with optional sibling extensions present in different orders.

At minimum:

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
```

The registry writer must preserve all unrelated entries byte-semantically even when another extension has custom unknown metadata.

## 16. No sibling modifications

Data installation must not directly edit:

- AI-Verse Memory files;
- AI-Verse Brain state;
- Multiple Bots coordination DB;
- Skills installation generations;
- Dashboard config;
- Apps;
- Connections;
- Automations;
- workspace current-context Markdown;
- workspace Memory;
- workspace decisions/knowledge.

Integration is discovery/adapters, not installer-side rewriting.

## 17. `doctor`

`ai-verse-data doctor` should be read-only with respect to canonical user records.

It should report:

- mode;
- host compatibility;
- extension registration status;
- installed/enabled state;
- engine version;
- SQLite runtime version/features;
- workspace database presence for requested scope;
- database format version;
- workspace binding;
- schema migration requirement;
- integrity/quick-check result;
- WAL/local-filesystem suitability where detectable;
- unsafe paths/symlinks;
- permission/readability problems;
- sibling integration availability as informational only.

Missing optional sibling layers should not be warnings.

## 18. `status`

A lighter status command may report without deep integrity work:

```text
AI-Verse Data 0.1.x
Mode: ai-verse-os-v2
Registered: yes
Enabled: yes
Workspace: sales
Database: present
Database format: 1
Health: healthy
```

## 19. Lifecycle ownership ledger

The installer should keep enough Data-owned metadata to know which software files it owns and which canonical user files it must preserve.

Never infer that every file under a workspace `data/` folder is Data-owned software.

Canonical databases are user-owned even if Data created them.

## 20. Crash/concurrency safety

Install/update/uninstall operations should serialize their own lifecycle mutations.

Extension registry mutations must use the OS's safe lock/atomic replace rules.

Workspace Data writes use database transactions and are independent from package lifecycle locks.

A package update must not hold a database write transaction open while downloading/building software.

## 21. Cross-platform support

Target:

- macOS;
- Linux;
- Windows.

Path validation must explicitly handle:

- POSIX absolute paths;
- Windows drive-prefixed paths;
- UNC paths;
- separators/backslashes;
- `..` traversal;
- NULs;
- symlink/reparse-point behavior where practical.

## 22. Distribution direction

Development can initially support GitHub-based installation.

Future package publication may provide:

```bash
npx ai-verse-data install
```

The distribution format should not change canonical database paths or public protocol semantics.

## 23. Lifecycle invariants

1. Install never deletes canonical Data.
2. Update never silently changes user schemas.
3. Disable never changes records.
4. Uninstall preserves canonical databases by default.
5. Purge is explicit and separate.
6. Other extension registrations are preserved.
7. Incompatible AI-Verse hosts fail closed.
8. Standalone fallback never masks an incompatible AI-Verse installation.
9. Missing sibling extensions never block Data installation.
10. Reinstall can rediscover compatible preserved databases without rebuilding their contents.
