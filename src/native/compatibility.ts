import {
  existsSync,
  lstatSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";

import {
  DataScopeError,
  TrustedDataRoot,
} from "../scope/index.js";
import {
  AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
  AI_VERSE_OS_REQUIRED_ARCHITECTURE,
  AI_VERSE_OS_REQUIRED_SCHEMA_MAJOR,
  type AiVerseOsCompatibilityApi,
  type AiVerseOsCompatibilityInput,
  type AiVerseOsCompatibilityIssue,
  type AiVerseOsCompatibilityIssueCode,
  type AiVerseOsCompatibilityResult,
  type AiVerseOsManifestSummary,
} from "./types.js";

const MAX_CONTRACT_FILE_BYTES = 1024 * 1024;
const SCHEMA_KEYS = new Set([
  "schema",
  "schema-version",
  "schema_version",
  "schemaVersion",
]);

function compatibilityIssue(
  code: AiVerseOsCompatibilityIssueCode,
  message: string,
  relativePath?: string,
): AiVerseOsCompatibilityIssue {
  return relativePath === undefined
    ? { code, message }
    : { code, message, relativePath };
}

function result(
  status: AiVerseOsCompatibilityResult["status"],
  rootPath: string | null,
  manifest: AiVerseOsManifestSummary | null,
  issues: readonly AiVerseOsCompatibilityIssue[],
): AiVerseOsCompatibilityResult {
  return {
    status,
    rootPath,
    manifest,
    extensionRegistryRelativePath:
      status === "compatible"
        ? AI_VERSE_OS_EXTENSION_REGISTRY_PATH
        : null,
    issues,
  };
}

function scalarValue(rawValue: string): string | null {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) return null;

  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    const closing = trimmed.lastIndexOf(quote);
    if (closing <= 0) return null;
    const trailing = trimmed.slice(closing + 1).trim();
    if (trailing.length > 0 && !trailing.startsWith("#")) {
      return null;
    }
    return trimmed.slice(1, closing);
  }

  const comment = trimmed.search(/\s+#/);
  return (comment === -1 ? trimmed : trimmed.slice(0, comment)).trim();
}

function manifestRootScalars(
  contents: string,
): ReadonlyMap<string, readonly string[]> {
  const values = new Map<string, string[]>();

  for (const rawLine of contents.split(/\r?\n/)) {
    if (rawLine.length === 0 || /^\s/.test(rawLine)) continue;
    const line = rawLine.trim();
    if (
      line.length === 0 ||
      line.startsWith("#") ||
      line === "---" ||
      line === "..."
    ) {
      continue;
    }

    const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (match === null) continue;
    const key = match[1]!;
    const rawValue = match[2]!;
    if (!SCHEMA_KEYS.has(key) && key !== "architecture") continue;

    const value = scalarValue(rawValue);
    if (value === null) {
      const current = values.get(key) ?? [];
      current.push("");
      values.set(key, current);
      continue;
    }

    const current = values.get(key) ?? [];
    current.push(value);
    values.set(key, current);
  }

  return values;
}

function parseSchemaMajor(value: string): number | null {
  const match = /^(\d+)(?:\.\d+){0,2}$/.exec(value.trim());
  if (match === null) return null;
  const major = Number.parseInt(match[1]!, 10);
  return Number.isSafeInteger(major) ? major : null;
}

function parseManifest(contents: string): {
  readonly summary: AiVerseOsManifestSummary | null;
  readonly issues: readonly AiVerseOsCompatibilityIssue[];
} {
  const scalars = manifestRootScalars(contents);
  const issues: AiVerseOsCompatibilityIssue[] = [];

  const schemaEntries: Array<{ readonly key: string; readonly value: string }> =
    [];
  for (const key of SCHEMA_KEYS) {
    const values = scalars.get(key) ?? [];
    for (const value of values) schemaEntries.push({ key, value });
  }

  let schemaMajor: number | null = null;
  if (schemaEntries.length === 0) {
    issues.push(
      compatibilityIssue(
        "SCHEMA_VERSION_MISSING",
        "AI-VERSE.yaml does not declare a supported top-level schema version field.",
        "AI-VERSE.yaml",
      ),
    );
  } else if (schemaEntries.length > 1) {
    issues.push(
      compatibilityIssue(
        "MANIFEST_MALFORMED",
        "AI-VERSE.yaml declares more than one schema-version field and is ambiguous.",
        "AI-VERSE.yaml",
      ),
    );
  } else {
    schemaMajor = parseSchemaMajor(schemaEntries[0]!.value);
    if (schemaMajor === null) {
      issues.push(
        compatibilityIssue(
          "MANIFEST_MALFORMED",
          "AI-VERSE.yaml schema version is not a valid numeric major/version.",
          "AI-VERSE.yaml",
        ),
      );
    } else if (schemaMajor !== AI_VERSE_OS_REQUIRED_SCHEMA_MAJOR) {
      issues.push(
        compatibilityIssue(
          "SCHEMA_VERSION_UNSUPPORTED",
          `AI-Verse OS schema major ${schemaMajor} is unsupported; Data requires major ${AI_VERSE_OS_REQUIRED_SCHEMA_MAJOR}.`,
          "AI-VERSE.yaml",
        ),
      );
    }
  }

  const architectureValues = scalars.get("architecture") ?? [];
  let architecture: string | null = null;
  if (architectureValues.length === 0) {
    issues.push(
      compatibilityIssue(
        "ARCHITECTURE_MISSING",
        "AI-VERSE.yaml does not declare the required top-level architecture field.",
        "AI-VERSE.yaml",
      ),
    );
  } else if (architectureValues.length > 1) {
    issues.push(
      compatibilityIssue(
        "MANIFEST_MALFORMED",
        "AI-VERSE.yaml declares architecture more than once.",
        "AI-VERSE.yaml",
      ),
    );
  } else {
    architecture = architectureValues[0]!;
    if (architecture !== AI_VERSE_OS_REQUIRED_ARCHITECTURE) {
      issues.push(
        compatibilityIssue(
          "ARCHITECTURE_UNSUPPORTED",
          `AI-Verse OS architecture '${architecture}' is unsupported; Data requires '${AI_VERSE_OS_REQUIRED_ARCHITECTURE}'.`,
          "AI-VERSE.yaml",
        ),
      );
    }
  }

  return {
    summary:
      schemaMajor === null || architecture === null
        ? null
        : { schemaMajor, architecture },
    issues,
  };
}

function partialHostMarkerCount(rootPath: string): number {
  const markers: readonly (readonly string[])[] = [
    ["AGENTS.md"],
    ["operator"],
    ["workspaces"],
    ["system", "extensions", "README.md"],
    [".aiverse", "extensions", "registry.json"],
  ];

  return markers.reduce(
    (count, segments) =>
      count + (existsSync(join(rootPath, ...segments)) ? 1 : 0),
    0,
  );
}

function resolveSafePath(
  root: TrustedDataRoot,
  segments: readonly string[],
  unsafeCode: AiVerseOsCompatibilityIssueCode,
  relativePath: string,
): { readonly path: string | null; readonly issue: AiVerseOsCompatibilityIssue | null } {
  try {
    return {
      path: root.resolve(...segments),
      issue: null,
    };
  } catch (error) {
    const message =
      error instanceof DataScopeError
        ? error.message
        : "Host path could not be validated safely.";
    return {
      path: null,
      issue: compatibilityIssue(unsafeCode, message, relativePath),
    };
  }
}

function inspectRequiredNode(
  root: TrustedDataRoot,
  segments: readonly string[],
  kind: "file" | "directory",
  missingCode: AiVerseOsCompatibilityIssueCode,
  unsafeCode: AiVerseOsCompatibilityIssueCode,
  relativePath: string,
): AiVerseOsCompatibilityIssue | null {
  const resolved = resolveSafePath(
    root,
    segments,
    unsafeCode,
    relativePath,
  );
  if (resolved.issue !== null) return resolved.issue;
  const path = resolved.path!;

  if (!existsSync(path)) {
    return compatibilityIssue(
      missingCode,
      `Required AI-Verse OS ${kind} '${relativePath}' is missing.`,
      relativePath,
    );
  }

  let info;
  try {
    info = lstatSync(path);
  } catch (error) {
    return compatibilityIssue(
      unsafeCode,
      `Required AI-Verse OS path '${relativePath}' could not be inspected: ${error instanceof Error ? error.message : "unknown filesystem error"}.`,
      relativePath,
    );
  }

  if (info.isSymbolicLink()) {
    return compatibilityIssue(
      unsafeCode,
      `Required AI-Verse OS path '${relativePath}' must not be a symbolic link.`,
      relativePath,
    );
  }

  if (
    (kind === "file" && !info.isFile()) ||
    (kind === "directory" && !info.isDirectory())
  ) {
    return compatibilityIssue(
      unsafeCode,
      `Required AI-Verse OS path '${relativePath}' has the wrong filesystem type.`,
      relativePath,
    );
  }

  return null;
}

function readBoundedFile(
  path: string,
  relativePath: string,
  tooLargeCode: AiVerseOsCompatibilityIssueCode,
  unsafeCode: AiVerseOsCompatibilityIssueCode,
): { readonly contents: string | null; readonly issue: AiVerseOsCompatibilityIssue | null } {
  try {
    const info = statSync(path);
    if (info.size > MAX_CONTRACT_FILE_BYTES) {
      return {
        contents: null,
        issue: compatibilityIssue(
          tooLargeCode,
          `Host contract file '${relativePath}' exceeds ${MAX_CONTRACT_FILE_BYTES} bytes.`,
          relativePath,
        ),
      };
    }
    return {
      contents: readFileSync(path, "utf8"),
      issue: null,
    };
  } catch (error) {
    return {
      contents: null,
      issue: compatibilityIssue(
        unsafeCode,
        `Host contract file '${relativePath}' could not be read: ${error instanceof Error ? error.message : "unknown filesystem error"}.`,
        relativePath,
      ),
    };
  }
}

export class AiVerseOsCompatibilityDetector
  implements AiVerseOsCompatibilityApi
{
  inspect(
    input: AiVerseOsCompatibilityInput,
  ): AiVerseOsCompatibilityResult {
    if (
      input.rootPath.length === 0 ||
      input.rootPath.includes("\u0000")
    ) {
      return result("incompatible", null, null, [
        compatibilityIssue(
          "ROOT_INVALID",
          "AI-Verse OS root must be a non-empty filesystem path without NUL.",
        ),
      ]);
    }

    const absoluteRoot = resolve(input.rootPath);
    if (!existsSync(absoluteRoot)) {
      return result("no-os", absoluteRoot, null, [
        compatibilityIssue(
          "AI_VERSE_NOT_DETECTED",
          "No AI-Verse OS root exists at the candidate path.",
        ),
      ]);
    }

    let rootInfo;
    try {
      rootInfo = lstatSync(absoluteRoot);
    } catch (error) {
      return result("incompatible", absoluteRoot, null, [
        compatibilityIssue(
          "ROOT_INVALID",
          `Candidate AI-Verse OS root could not be inspected: ${error instanceof Error ? error.message : "unknown filesystem error"}.`,
        ),
      ]);
    }

    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
      return result("incompatible", absoluteRoot, null, [
        compatibilityIssue(
          "ROOT_UNSAFE",
          "Candidate AI-Verse OS root must be a real directory and must not be a symbolic link.",
        ),
      ]);
    }

    let root: TrustedDataRoot;
    try {
      root = TrustedDataRoot.fromExistingDirectory(absoluteRoot);
    } catch (error) {
      return result("incompatible", absoluteRoot, null, [
        compatibilityIssue(
          "ROOT_UNSAFE",
          error instanceof Error
            ? error.message
            : "Candidate AI-Verse OS root is unsafe.",
        ),
      ]);
    }

    const manifestResolved = resolveSafePath(
      root,
      ["AI-VERSE.yaml"],
      "MANIFEST_UNSAFE",
      "AI-VERSE.yaml",
    );
    if (manifestResolved.issue !== null) {
      return result("incompatible", root.canonicalPath, null, [
        manifestResolved.issue,
      ]);
    }
    const manifestPath = manifestResolved.path!;

    if (!existsSync(manifestPath)) {
      if (partialHostMarkerCount(root.canonicalPath) >= 2) {
        return result("incompatible", root.canonicalPath, null, [
          compatibilityIssue(
            "MANIFEST_MISSING",
            "AI-Verse-like host structure is present but AI-VERSE.yaml is missing.",
            "AI-VERSE.yaml",
          ),
        ]);
      }
      return result("no-os", root.canonicalPath, null, [
        compatibilityIssue(
          "AI_VERSE_NOT_DETECTED",
          "AI-VERSE.yaml is absent and no complete AI-Verse OS host was detected.",
        ),
      ]);
    }

    const manifestNodeIssue = inspectRequiredNode(
      root,
      ["AI-VERSE.yaml"],
      "file",
      "MANIFEST_MISSING",
      "MANIFEST_UNSAFE",
      "AI-VERSE.yaml",
    );
    if (manifestNodeIssue !== null) {
      return result("incompatible", root.canonicalPath, null, [
        manifestNodeIssue,
      ]);
    }

    const manifestRead = readBoundedFile(
      manifestPath,
      "AI-VERSE.yaml",
      "MANIFEST_TOO_LARGE",
      "MANIFEST_UNSAFE",
    );
    if (manifestRead.issue !== null) {
      return result("incompatible", root.canonicalPath, null, [
        manifestRead.issue,
      ]);
    }

    const parsed = parseManifest(manifestRead.contents!);
    const issues: AiVerseOsCompatibilityIssue[] = [...parsed.issues];

    for (const requirement of [
      {
        segments: ["AGENTS.md"] as const,
        kind: "file" as const,
        missing: "AGENTS_MISSING" as const,
        unsafe: "AGENTS_UNSAFE" as const,
        relativePath: "AGENTS.md",
      },
      {
        segments: ["operator"] as const,
        kind: "directory" as const,
        missing: "OPERATOR_MISSING" as const,
        unsafe: "OPERATOR_UNSAFE" as const,
        relativePath: "operator/",
      },
      {
        segments: ["workspaces"] as const,
        kind: "directory" as const,
        missing: "WORKSPACES_MISSING" as const,
        unsafe: "WORKSPACES_UNSAFE" as const,
        relativePath: "workspaces/",
      },
      {
        segments: ["system", "extensions", "README.md"] as const,
        kind: "file" as const,
        missing: "EXTENSION_CONTRACT_MISSING" as const,
        unsafe: "EXTENSION_CONTRACT_UNSAFE" as const,
        relativePath: "system/extensions/README.md",
      },
    ]) {
      const issue = inspectRequiredNode(
        root,
        requirement.segments,
        requirement.kind,
        requirement.missing,
        requirement.unsafe,
        requirement.relativePath,
      );
      if (issue !== null) issues.push(issue);
    }

    const extensionContractResolved = resolveSafePath(
      root,
      ["system", "extensions", "README.md"],
      "EXTENSION_CONTRACT_UNSAFE",
      "system/extensions/README.md",
    );
    if (
      extensionContractResolved.issue === null &&
      extensionContractResolved.path !== null &&
      existsSync(extensionContractResolved.path)
    ) {
      const extensionRead = readBoundedFile(
        extensionContractResolved.path,
        "system/extensions/README.md",
        "EXTENSION_CONTRACT_UNSAFE",
        "EXTENSION_CONTRACT_UNSAFE",
      );
      if (extensionRead.issue !== null) {
        issues.push(extensionRead.issue);
      } else if (
        !extensionRead.contents!.includes(
          AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
        )
      ) {
        issues.push(
          compatibilityIssue(
            "EXTENSION_CONTRACT_UNSUPPORTED",
            `AI-Verse extension contract must reference '${AI_VERSE_OS_EXTENSION_REGISTRY_PATH}'.`,
            "system/extensions/README.md",
          ),
        );
      }
    }

    const registryResolved = resolveSafePath(
      root,
      [".aiverse", "extensions", "registry.json"],
      "EXTENSION_REGISTRY_PATH_UNSAFE",
      AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
    );
    if (registryResolved.issue !== null) {
      issues.push(registryResolved.issue);
    } else if (
      registryResolved.path !== null &&
      existsSync(registryResolved.path)
    ) {
      try {
        const info = lstatSync(registryResolved.path);
        if (info.isSymbolicLink() || !info.isFile()) {
          issues.push(
            compatibilityIssue(
              "EXTENSION_REGISTRY_PATH_UNSAFE",
              "Existing AI-Verse extension registry path must be a regular non-symlink file.",
              AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
            ),
          );
        }
      } catch (error) {
        issues.push(
          compatibilityIssue(
            "EXTENSION_REGISTRY_PATH_UNSAFE",
            `Existing AI-Verse extension registry path could not be inspected: ${error instanceof Error ? error.message : "unknown filesystem error"}.`,
            AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
          ),
        );
      }
    }

    if (issues.length > 0) {
      return result(
        "incompatible",
        root.canonicalPath,
        parsed.summary,
        issues,
      );
    }

    return result(
      "compatible",
      root.canonicalPath,
      parsed.summary,
      [],
    );
  }
}
