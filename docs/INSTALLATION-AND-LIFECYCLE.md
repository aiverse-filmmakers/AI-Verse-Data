# AI-Verse Data Installation and Lifecycle

**Status:** Release 0.1 / Phase 5.6 native lifecycle contract  
**Date:** 2026-09-10

## 1. Goal

Installing AI-Verse Data should feel native without modifying or taking ownership of AI-Verse OS itself.

For repository-authorized development installs, the package can be invoked from GitHub; public/member distribution is a separate release decision:

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

Release 0.1 implements this gate through the public `@ai-verse/data/native` compatibility detector.

A native host is compatible only when the detector verifies the required AI-Verse OS v2 contract:

- `AI-VERSE.yaml` exists as a regular safe file;
- major schema version is 2;
- architecture is `unified-workspace`;
- `AGENTS.md` exists as a regular safe file;
- `operator/` exists as a safe directory;
- `workspaces/` exists as a safe directory;
- `system/extensions/README.md` exposes the local extension registry contract;
- the runtime contract references `.aiverse/extensions/registry.json`.

Detection is read-only and returns one of:

```text
compatible
no-os
incompatible
```

Unsafe, malformed, unsupported, or incomplete AI-Verse layouts fail closed.

A missing/ordinary non-AI-Verse project remains `no-os`. Strong AI-Verse partial-host evidence without a valid manifest is `incompatible`, so later install logic must not silently fall back to standalone mode and mask a broken native host.

The release lifecycle uses the hardened local extension-registry validation/materialization contract described below.

Detailed contract: `docs/AI-VERSE-OS-COMPATIBILITY-V0.1.md`.

## 4. Native extension placement

Release 0.1 materializes Data-owned local extension files under:

```text
.aiverse/extensions/ai-verse-data/
├── INSTRUCTIONS.md
├── engine.mjs
└── extension.json
```

These are local extension files, not canonical workspace Data. Normal install/update touches only Data-owned files and preserves unknown safe files already present in the extension directory.

The general ownership rule remains:

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

Release 0.1 implements hardened programmatic registration through `AiVerseDataExtensionInstaller`.

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

The release implementation provides this safety class directly:

- exact registry `schema_version: "1.0"`;
- exclusive `registry.json.lock`;
- latest registry re-read inside the lock;
- unknown top-level/unrelated-entry/own-unknown-field preservation;
- existing `enabled: false` preservation;
- exact raw-text lost-update check before commit;
- same-directory temp-file staging and rename replacement;
- verified owned-file materialization;
- pre-registry-commit owned-file rollback;
- no stale-lock stealing;
- no tracked OS edits.

Detailed contract: `docs/EXTENSION-MATERIALIZATION-REGISTRATION-V0.1.md`.

## 6. Canonical workspace Data creation

Installing Data does **not** create databases in every workspace.

Installation makes the capability available.

A workspace database is created only when Data is explicitly initialized or first used through a deliberate creation path.

Workspace initialization is explicit and is not a side effect of package install. In the first beta it is performed by the trusted AI-Verse OS Data host (`operation: init`) or the public native API `initWorkspaceData()`; the lifecycle CLI deliberately does not guess a workspace or auto-create every database.

The engine resolves the exact workspace from the trusted OS root, validates `WORKSPACE.yaml`, and creates:

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

## 8. Package-before-OS and standalone behavior

The Data package/runtime may be installed or made available before AI-Verse OS exists. That package-level availability grants no OS authority and creates no native workspace database.

The first member beta does **not** silently create a competing standalone Data store when the native lifecycle is pointed at a non-OS or incompatible AI-Verse root. Native `install/update/enable/disable/uninstall/doctor/status` require a compatible AI-Verse OS root and fail closed otherwise.

A future portable standalone product may use a separate explicit scope model, but it must remain distinct from AI-Verse workspace authorization and must include an explicit migration/adoption contract before it is treated as part of the beta install-order guarantee.

Therefore "Data before OS" means **package available before OS, attach later**, not "write canonical Data into an arbitrary project and later guess how to merge it."

## 9. Install behavior

The release installer implements compatible native host detection, Data-owned materialization, shared registry locking/registration, lifecycle commands, doctor/status, rollback-safe uninstall, and explicit workspace initialization through the native/OS host contract.

The installer does not initialize every workspace automatically and does not create a standalone fallback when the native host is absent or incompatible.

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

## 12. Enable / disable behavior

Disabling the extension changes only its enabled state/availability.

Canonical Data remains untouched.

Expected disabled outcome:

```text
engine installed
registry enabled = false
workspace databases preserved
normal runtime does not select Data
```

Re-enable is explicit:

```bash
ai-verse-data enable --root <os-root>
```

`install` and `update` deliberately preserve an existing `enabled: false`; they do not reinterpret an update as operator intent to reactivate Data. `enable` flips only Data's own registry entry back to `enabled: true`, preserves unknown sibling/entry fields, and leaves canonical databases and extension files unchanged.

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

`ai-verse-data doctor --root <os-root> [--workspace <id>]` is implemented and is read-only with respect to canonical user records.

It reports:

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

`ai-verse-data status --root <os-root> [--workspace <id>]` is implemented as the lighter health/readiness surface without the full integrity check:

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

Install/update/enable/disable/uninstall operations should serialize their own lifecycle mutations.

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

Development can use GitHub-based installation when the caller has repository access. Member/public distribution must use whatever immutable access/package policy is chosen for the private repository; this document does not assume public GitHub access.

Future package publication may provide:

```bash
npx ai-verse-data install
```

The distribution format should not change canonical database paths or public protocol semantics.

## 23. Lifecycle invariants

1. Install never deletes canonical Data.
2. Update never silently changes user schemas.
3. Enable/disable never changes records or canonical databases.
4. Uninstall preserves canonical databases by default.
5. Purge is explicit and separate.
6. Other extension registrations are preserved.
7. Incompatible AI-Verse hosts fail closed.
8. Missing/incompatible native OS never triggers a silent standalone fallback.
9. Missing sibling extensions never block Data installation.
10. Reinstall can rediscover compatible preserved databases without rebuilding their contents.
