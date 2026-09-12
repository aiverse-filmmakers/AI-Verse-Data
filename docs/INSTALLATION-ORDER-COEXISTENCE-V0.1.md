# AI-Verse Installation-Order and Registry Coexistence v0.1

**Task:** 25 / 41
**Phase:** 3.7 - Installation-order/registry coexistence suite
**Status:** IMPLEMENTED
**Public package surface:** none new (verification gate over Tasks 19-24)

This document defines the coexistence proof that the existing native
primitives survive representative installation orders with sibling
extensions, without any new engine, new CLI, or sibling modification.

## 1. Purpose

Task 25 answers one question for a compatible native host:

```text
Does Data install, update, disable, uninstall, and reinstall cleanly
no matter which sibling extensions arrived first, without touching
their state or canonical workspace databases?
```

The suite exercises the Task 20 installer, Task 23 lifecycle, Task 22
discovery, and Task 24 health checks verbatim against real temporary
OS fixtures carrying fake sibling registry entries. It asserts
preservation at every step. It implements no new behavior.

## 2. Orders covered

Per `docs/INSTALLATION-AND-LIFECYCLE.md` section 15, at minimum:

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

Plus adversarial variants:

```text
OS -> Memory(enabled:false) -> Data
OS -> unrelated-extension(custom nested unknown metadata, enabled:false) -> Data
OS -> Memory + Brain + Multiple Bots + Skills + unrelated -> Data (full order)
```

Sibling entries are fixtures only: unknown top-level registry fields,
unknown per-entry fields including deeply nested objects, and
`enabled: false` variants. No sibling repository is touched; the
fixtures live in temporary directories under the Data repo's test run.

## 3. Lifecycle exercised per order

For every order, the suite runs the full sequence through the existing
public APIs:

```text
install -> status/doctor -> update -> instruction discovery
  -> disable -> status -> uninstall -> reinstall -> doctor
```

Between steps it asserts:

- only `extensions["ai-verse-data"]` is created, changed, or removed;
- unrelated entries are byte-semantically identical
  (`JSON.stringify` comparison before and after);
- unknown top-level fields (for example `custom_top_level`) survive;
- unknown per-entry fields (including nested objects and arrays)
  survive install, update, disable, and reinstall;
- existing `enabled: false` on a sibling is preserved;
- Data-owned files are limited to the three Task 20 owned files;
- lifecycle alone creates zero `.sqlite` files;
- seeded canonical database bytes are byte-identical across update,
  disable, uninstall, and reinstall;
- a reinstalled host reopens the preserved database as `compatible`
  through the normal Task 21 path;
- no tracked OS file (`AI-VERSE.yaml`, `AGENTS.md`,
  `system/extensions/README.md`, `WORKSPACE.yaml`) changes;
- registry lock contention fails closed without stealing;
- fixtures contain no leftover lock files.

## 4. Laws preserved

The suite reuses rather than reimplements every safety rule:

- Task 19 compatible-root gate; `no-os` and `incompatible` fail closed
  with no standalone masking;
- Task 20 lock, in-lock re-read, raw-text lost-update check, and
  atomic same-directory replacement verbatim;
- Task 20 path and symlink validators verbatim;
- ID-only workspace identity; no workspace enumeration;
- no database init, migrate, repair, promote, rebind, quarantine
  clearing, or purge;
- no registry write beyond the owned entry;
- no tracked OS mutation;
- no Task 26 Phase 3 gate behavior;
- no sibling repository modifications.

## 5. Deliberately not implemented

Task 25 does not implement:

- any new engine, CLI command, or registry behavior;
- the Task 26 Phase 3 gate;
- purge or destructive removal;
- real multi-repository integration (covered later at ecosystem
  release);
- sibling repository changes.

## 6. Acceptance

Task 25 proves twelve order variants preserve siblings across the full
lifecycle, seeded databases survive lifecycle plus reinstall in every
sampled order, lock contention fails closed with siblings present,
tracked OS files are untouched, and the full repository suite passes.
