# AI-Verse Extension Instructions and Runtime Discovery v0.1

**Task:** 22 / 41  
**Phase:** 3.4 - Extension instructions/runtime discovery  
**Status:** IMPLEMENTED  
**Public package surface:** `@ai-verse/data/native`

This document defines how AI-Verse Data exposes its own installed
extension instructions to a native AI-Verse OS runtime without modifying
any host file, registry entry, workspace database, or sibling extension.

## 1. Purpose

Task 22 answers one question for a compatible native host:

```text
What Data instruction/runtime material should the OS runtime load for
this task, and where did it come from?
```

The operation is strictly read-only discovery. It loads only the
`ai-verse-data` extension's own already-materialized files through the
existing OS local extension hook:

```text
.aiverse/extensions/registry.json -> extensions["ai-verse-data"]
.aiverse/extensions/ai-verse-data/INSTRUCTIONS.md
.aiverse/extensions/ai-verse-data/engine.mjs
.aiverse/extensions/ai-verse-data/extension.json
```

It never discovers, loads, or returns another extension's files.

## 2. Host prerequisite

Discovery begins only after the Task 19 compatibility detector returns:

```text
compatible
```

These fail closed before any registry or extension file is read:

```text
no-os        -> AI_VERSE_OS_NOT_FOUND
incompatible -> INCOMPATIBLE_AI_VERSE_OS
```

A missing candidate path is `AI_VERSE_OS_NOT_FOUND`, not a silent
standalone result. A partial/broken host is `INCOMPATIBLE_AI_VERSE_OS`,
never masked by a standalone fallback.

## 3. Public API

```ts
import { AiVerseDataInstructionDiscovery } from "@ai-verse/data/native";

const result = new AiVerseDataInstructionDiscovery().discover({
  rootPath: "/path/to/AI-Verse-OS",
  taskHint: "structured customer records",
});
```

Functional alias:

```text
discoverExtensionInstructions
```

`taskHint` is optional, bounded to 512 characters, must not contain NUL,
and is used only for task-relevant ranking. It never becomes a path, a
registry key, or a database query.

Discovery never executes the engine file. It returns file contents plus
provenance so the caller or OS runtime can decide what is relevant.

## 4. Registry handling

Discovery parses the existing registry with the exact Task 20 contract:

- regular non-symlink file;
- valid UTF-8 JSON object;
- `schema_version` exactly `"1.0"`;
- object-valued `extensions`;
- 1 MiB read ceiling.

Malformed or unsupported registries fail closed and are left unchanged.
Discovery never writes the registry, never acquires the registry lock,
and never creates `.aiverse/` state.

Only this entry is read:

```text
extensions["ai-verse-data"]
```

A missing registry, or a registry without the Data entry, reports:

```text
not-installed
```

with no files loaded. Unknown top-level fields, unrelated extension
entries, and unknown fields on the Data entry are tolerated for parsing
but never loaded or returned.

The entry's `supported`, `installed`, and `enabled` fields must each be
boolean. A non-boolean value fails closed because operator intent cannot
be guessed. When any of the three is not `true`, discovery reports:

```text
disabled
```

loads no files, and returns the parsed provenance so the caller can see
why. An existing `enabled: false` is therefore respected, never
overridden.

## 5. File resolution

When the entry is supported, installed, and enabled, discovery resolves
these repo-relative references from the registry entry:

```text
instructions
engine
adapters[]
```

plus the engine-owned manifest constant:

```text
.aiverse/extensions/ai-verse-data/extension.json
```

Every path is validated with the existing Task 20 path validator and
must additionally resolve inside the Data-owned extension directory:

```text
.aiverse/extensions/ai-verse-data/
```

Rejected before any read:

- absolute POSIX paths;
- rooted Windows paths;
- drive-prefixed paths;
- UNC paths;
- `..` traversal;
- `.` segments;
- empty segments;
- NUL characters;
- any path resolving outside the owned directory;
- symlinked files;
- non-regular files;
- files over the 1 MiB Task 22 per-file ceiling;
- unreadable files;
- missing files.

Discovery creates no directories and no files.

## 6. Task-relevant filtering

Discovery returns the instruction text, engine text, manifest text, and
any declared adapter texts for the caller or OS runtime to select from.
It additionally computes a lightweight relevance signal from the
optional task hint:

- hint tokenized on non-alphanumeric boundaries;
- tokens shorter than 3 characters ignored;
- case-insensitive substring match against the loaded corpus plus
  version, source, and relative paths;
- matched terms sorted and returned.

With no hint, `taskRelevant` is `true`. With a hint, `taskRelevant` is
`true` only when at least one term matches. Non-matching hints still
return the files; the flag tells the runtime the hint did not match, and
the runtime decides what to load. Discovery never eager-loads other
workspaces, never enumerates other extensions, and never opens any
database to decide relevance.

## 7. Result shape

A discovery result contains:

- `status`: `ready`, `disabled`, or `not-installed`;
- canonical `rootPath`;
- echoed `taskHint` or `null`;
- `taskRelevant` boolean;
- sorted `matchedTerms`;
- `provenance`: extension id, version, source, supported/installed/
  enabled booleans, registry existence, and the resolved
  instructions/engine/adapter relative paths;
- `instructions`, `engine`, `manifest` file records or `null`;
- `adapters` file records (possibly empty).

Each file record carries its registry-relative path, its trusted
absolute path, and its UTF-8 contents.

## 8. Ownership and coexistence

Task 22 owns no new files and mutates nothing:

- no tracked OS file is written (`AI-VERSE.yaml`, `AGENTS.md`,
  `skills/registry.yaml`, `system/`, `operator/`, `workspaces/`);
- the registry is never written and its bytes are never reordered;
- unrelated extension entries are preserved and never loaded;
- unknown safe files in the Data extension directory are untouched;
- no workspace database is created, opened, migrated, repaired, or
  rebound — verified by the suite asserting zero `.sqlite` files appear;
- Memory, Brain, Bots, Skills, Apps, Connections, and Dashboard state
  are untouched.

OS owns the hook and contract; Data owns only its entry and files. A
missing registry stays `not-installed` so standalone-safe and
any-install-order behavior is preserved: OS before Data, Data before
siblings, or siblings in any order all resolve through the same
entry-state check.

## 9. Error surface

Discovery errors use:

```text
AiVerseDataInstructionError
```

Error codes:

```text
AI_VERSE_OS_NOT_FOUND
INCOMPATIBLE_AI_VERSE_OS
INVALID_EXTENSION_PATH
SYMLINK_PATH_REJECTED
INVALID_EXTENSION_FILE
EXTENSION_FILE_TOO_LARGE
EXTENSION_FILE_UNREADABLE
INVALID_EXTENSION_REGISTRY
UNSUPPORTED_EXTENSION_REGISTRY_SCHEMA
INVALID_EXISTING_EXTENSION_ENTRY
INVALID_TASK_HINT
```

Ordinary `not-installed` and `disabled` states are returned as results,
not thrown. Unsafe, malformed, missing-file, oversized, and
incompatible-host conditions throw.

## 10. Deliberately not implemented

Task 22 does not implement:

- Task 23 native CLI lifecycle commands;
- Task 24 native doctor or status commands;
- workspace database initialization, migration, repair, or promotion;
- health assertions or permission grants from registration;
- permanent `AGENTS.md` blocks;
- sibling repository changes.

## 11. Acceptance

Task 22 proves:

- ready discovery returns only Data-owned files with provenance;
- fixture trees are byte-identical after discovery;
- related task hints match and unrelated hints report non-relevant;
- disabled entries load nothing;
- missing registries report not-installed;
- malformed/unsupported registries fail closed read-only;
- traversal, absolute, and symlink paths fail closed;
- unrelated extensions are preserved and never loaded;
- adapters and manifest load only from the owned directory;
- incompatible hosts fail closed with no standalone masking;
- invalid task hints fail closed before any file load;
- no `.sqlite` file is created by discovery;
- complete repository suite passes.
