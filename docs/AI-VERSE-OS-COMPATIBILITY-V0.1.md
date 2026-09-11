# AI-Verse OS Compatibility v0.1

**Task:** 19 / 41  
**Phase:** 3.1 - AI-Verse OS compatibility detector  
**Status:** IMPLEMENTED  
**Public package surface:** `@ai-verse/data/native`

This document defines the first read-only native host compatibility contract for AI-Verse Data.

## 1. Purpose

Task 19 answers one question:

```text
Can this candidate root safely be treated as a supported AI-Verse OS v2 host?
```

It does not install, register, initialize, repair, or mutate anything.

## 2. Public API

```ts
const detector = new AiVerseOsCompatibilityDetector()

const result = detector.inspect({
  rootPath: "/path/to/candidate",
})
```

The result status is one of:

```text
compatible
no-os
incompatible
```

These states are deliberately distinct.

## 3. Required native host contract

A compatible host must satisfy all of these requirements:

```text
AI-VERSE.yaml
  -> regular safe file
  -> schema major 2
  -> architecture: unified-workspace

AGENTS.md
  -> regular safe file

operator/
  -> safe directory

workspaces/
  -> safe directory

system/extensions/README.md
  -> regular safe file
  -> references .aiverse/extensions/registry.json
```

An existing `.aiverse/extensions/registry.json` is path-safety checked but its contents are not parsed in Task 19.

Registry schema validation and mutation belong to Task 20.

## 4. Manifest compatibility

Task 19 requires one unambiguous top-level schema-version declaration with major version 2.

Because the architectural documents specify the semantic requirement "major schema version is 2" without locking one serialized key spelling, the v0.1 detector accepts these equivalent top-level spellings:

```text
schema
schema-version
schema_version
schemaVersion
```

Exactly one may be present.

Values may be:

```text
2
2.0
2.4
```

The major component must be 2.

The architecture field must be exactly:

```text
architecture: unified-workspace
```

Unknown manifest fields are ignored by Task 19 so additive future metadata does not break a still-compatible host.

## 5. Conservative parser boundary

Task 19 does not introduce a general YAML configuration engine.

It reads only bounded top-level scalar identity fields needed for compatibility detection.

The parser:

- ignores comments and unrelated keys;
- tolerates quoted scalar values;
- tolerates nested unrelated metadata;
- rejects ambiguous duplicate schema aliases;
- rejects duplicate architecture declarations;
- rejects missing/malformed required identity;
- caps host contract file reads at 1 MiB.

Task 19 does not use parsed manifest content to mutate the host.

## 6. No-OS versus incompatible

A missing candidate root is:

```text
no-os
```

An ordinary existing project with no AI-Verse evidence is also:

```text
no-os
```

A partial host is `incompatible` when the detector sees strong AI-Verse evidence without a valid manifest.

Strong evidence includes:

```text
system/extensions/README.md
.aiverse/extensions/registry.json
```

Two or more generic host markers also make a missing manifest incompatible:

```text
AGENTS.md
operator/
workspaces/
```

A single generic marker such as an unrelated project's `AGENTS.md` is not enough by itself to claim a broken AI-Verse OS.

This prevents standalone fallback from hiding a clearly partial AI-Verse host while avoiding false positives on generic projects.

## 7. Safe trusted-root behavior

The candidate root must:

- exist as a real directory when present;
- not itself be a symbolic link;
- resolve to a stable canonical path.

All required child paths are resolved through the existing `TrustedDataRoot` safety boundary.

Existing path components may not:

- traverse outside the trusted root;
- use unsafe path segments;
- pass through symbolic links;
- substitute the wrong filesystem type.

## 8. Symlink behavior

These fail closed:

- symlinked candidate OS root;
- symlinked `AI-VERSE.yaml`;
- symlinked `AGENTS.md`;
- symlinked `system/extensions/README.md`;
- symlinked components leading to the extension registry path;
- required directories replaced with unsafe path nodes.

Task 19 never follows those paths as compatibility authority.

## 9. Extension-contract verification

The OS extension contract file must explicitly reference:

```text
.aiverse/extensions/registry.json
```

Task 19 only proves that the documented native extension hook exists.

It does not:

- create `.aiverse/`;
- create an extension registry;
- parse registry schema;
- add `ai-verse-data`;
- change `enabled`;
- materialize extension files.

Those are Task 20 responsibilities.

## 10. Existing registry behavior

If `.aiverse/extensions/registry.json` already exists, Task 19 verifies only that the resolved path is safe and points to a regular non-symlink file.

Its contents remain untouched and unparsed.

This deliberately preserves future/unknown registry state until the hardened Task 20 registry contract handles it.

## 11. Read-only guarantee

Compatibility inspection performs no filesystem writes.

Tests snapshot a compatible fixture tree before and after inspection and require exact equality.

Task 19 does not create:

- Data databases;
- workspace directories;
- extension directories;
- extension registry state;
- lock files;
- temporary host files;
- tracked OS changes.

## 12. Structured result

A compatibility result contains:

- status;
- canonical root path when available;
- parsed schema major and architecture when available;
- extension registry relative path only when compatible;
- structured issue list.

Examples of issue classes:

```text
SCHEMA_VERSION_UNSUPPORTED
ARCHITECTURE_UNSUPPORTED
MANIFEST_MISSING
AGENTS_MISSING
WORKSPACES_UNSAFE
EXTENSION_CONTRACT_UNSUPPORTED
EXTENSION_REGISTRY_PATH_UNSAFE
```

Callers do not need to infer incompatibility from free-form text.

## 13. Standalone safety

Standalone Data remains possible when no AI-Verse OS is present.

However:

```text
detected incompatible host
  != no-os
  != permission to silently create standalone Data
```

The compatibility result preserves that distinction for later CLI/install logic.

## 14. Deliberate non-features

Task 19 does not implement:

- extension-owned file materialization;
- extension registry parsing/mutation;
- install locks;
- atomic registry replacement;
- native workspace manifest resolution;
- Data workspace initialization;
- install/update/disable/uninstall;
- native doctor/status;
- sibling repository changes.

## 15. Acceptance

Task 19 proves:

- compatible OS v2 unified-workspace fixture returns `compatible`;
- supported schema key variants remain unambiguous;
- unknown additive manifest fields are tolerated;
- missing root and ordinary empty project return `no-os`;
- strong partial-host evidence without manifest returns `incompatible`;
- unsupported schema major and architecture are distinct;
- malformed/ambiguous identity fails closed;
- required host structure is checked;
- extension contract must name the local registry hook;
- root/manifest/AGENTS/extension-contract/registry path symlinks fail closed;
- existing registry bytes are neither parsed nor modified;
- manifest read size is bounded;
- compatible-host inspection leaves the filesystem unchanged;
- complete repository suite passes Node 22 and Node 24.

Behavioral verification:

```text
Behavioral commit:   6b1f6757bd24492376754bdb0508b35233883193
GitHub Actions run:  34602056368
Node 22:             PASS
Node 24:             PASS
Tests:               216 / 216 PASS
Failures:            0
Skipped:             0
Cancelled:           0
```

## 16. Next

Task 20 / 41, Phase 3.2, owns hardened extension materialization and registration.

Task 20 must build on a `compatible` Task 19 result rather than weakening or duplicating compatibility detection.
