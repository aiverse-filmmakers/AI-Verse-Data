import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
  AI_VERSE_OS_REQUIRED_ARCHITECTURE,
  AI_VERSE_OS_REQUIRED_SCHEMA_MAJOR,
  AiVerseOsCompatibilityDetector,
} from "../src/native/index.js";

interface Fixture {
  readonly rootPath: string;
  cleanup(): void;
}

function fixture(): Fixture {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-native-compat-"));
  return {
    rootPath,
    cleanup(): void {
      rmSync(rootPath, { recursive: true, force: true });
    },
  };
}

function writeCompatibleHost(
  rootPath: string,
  manifest = [
    "schema: 2",
    "architecture: unified-workspace",
    "name: Test AI-Verse",
    "",
  ].join("\n"),
): void {
  writeFileSync(join(rootPath, "AI-VERSE.yaml"), manifest, "utf8");
  writeFileSync(join(rootPath, "AGENTS.md"), "# Agents\n", "utf8");
  mkdirSync(join(rootPath, "operator"), { recursive: true });
  mkdirSync(join(rootPath, "workspaces"), { recursive: true });
  mkdirSync(join(rootPath, "system", "extensions"), { recursive: true });
  writeFileSync(
    join(rootPath, "system", "extensions", "README.md"),
    [
      "# Extension contract",
      "",
      "Local extensions are registered in:",
      "",
      AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
      "",
    ].join("\n"),
    "utf8",
  );
}

function issueCodes(
  result: ReturnType<AiVerseOsCompatibilityDetector["inspect"]>,
): readonly string[] {
  return result.issues.map((issue) => issue.code);
}

function snapshotTree(rootPath: string): readonly string[] {
  const output: string[] = [];

  function walk(relativePath: string): void {
    const absolute = relativePath.length === 0
      ? rootPath
      : join(rootPath, relativePath);
    const entries = readdirSync(absolute, {
      withFileTypes: true,
    }).sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const child = relativePath.length === 0
        ? entry.name
        : join(relativePath, entry.name);
      if (entry.isDirectory()) {
        output.push(`dir:${child}`);
        walk(child);
      } else if (entry.isSymbolicLink()) {
        output.push(`symlink:${child}`);
      } else if (entry.isFile()) {
        output.push(
          `file:${child}:${readFileSync(join(rootPath, child), "utf8")}`,
        );
      } else {
        output.push(`other:${child}`);
      }
    }
  }

  walk("");
  return output;
}

test("compatible AI-Verse OS v2 unified-workspace host is detected read-only", () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    mkdirSync(join(f.rootPath, ".aiverse", "extensions"), {
      recursive: true,
    });
    writeFileSync(
      join(f.rootPath, ".aiverse", "extensions", "registry.json"),
      JSON.stringify({ version: 1, extensions: [] }),
      "utf8",
    );
    writeFileSync(join(f.rootPath, "sentinel.txt"), "preserve", "utf8");

    const before = snapshotTree(f.rootPath);
    const result = new AiVerseOsCompatibilityDetector().inspect({
      rootPath: f.rootPath,
    });
    const after = snapshotTree(f.rootPath);

    assert.equal(result.status, "compatible");
    assert.deepEqual(result.manifest, {
      schemaMajor: AI_VERSE_OS_REQUIRED_SCHEMA_MAJOR,
      architecture: AI_VERSE_OS_REQUIRED_ARCHITECTURE,
    });
    assert.equal(
      result.extensionRegistryRelativePath,
      AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
    );
    assert.deepEqual(result.issues, []);
    assert.deepEqual(after, before);
  } finally {
    f.cleanup();
  }
});

test("documented schema-version aliases and unknown manifest fields are tolerated when unambiguous", () => {
  for (const key of [
    "schema",
    "schema-version",
    "schema_version",
    "schemaVersion",
  ]) {
    const f = fixture();
    try {
      writeCompatibleHost(
        f.rootPath,
        [
          `${key}: "2.4"`,
          "architecture: 'unified-workspace'",
          "future_field: keep-me",
          "nested:",
          "  unknown: true",
          "",
        ].join("\n"),
      );
      const result = new AiVerseOsCompatibilityDetector().inspect({
        rootPath: f.rootPath,
      });
      assert.equal(result.status, "compatible", key);
      assert.equal(result.manifest?.schemaMajor, 2, key);
    } finally {
      f.cleanup();
    }
  }
});

test("missing candidate root and empty project report no-os rather than incompatible", () => {
  const f = fixture();
  const missing = join(f.rootPath, "does-not-exist");
  try {
    const detector = new AiVerseOsCompatibilityDetector();

    const missingResult = detector.inspect({ rootPath: missing });
    assert.equal(missingResult.status, "no-os");
    assert.deepEqual(issueCodes(missingResult), [
      "AI_VERSE_NOT_DETECTED",
    ]);

    const emptyResult = detector.inspect({ rootPath: f.rootPath });
    assert.equal(emptyResult.status, "no-os");
    assert.deepEqual(issueCodes(emptyResult), [
      "AI_VERSE_NOT_DETECTED",
    ]);
  } finally {
    f.cleanup();
  }
});

test("AI-Verse-like partial host without manifest is incompatible and cannot silently fall back", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.rootPath, "AGENTS.md"), "# Agents\n", "utf8");
    mkdirSync(join(f.rootPath, "workspaces"));

    const result = new AiVerseOsCompatibilityDetector().inspect({
      rootPath: f.rootPath,
    });

    assert.equal(result.status, "incompatible");
    assert.ok(issueCodes(result).includes("MANIFEST_MISSING"));
    assert.equal(result.extensionRegistryRelativePath, null);
  } finally {
    f.cleanup();
  }
});

test("unsupported schema major and architecture remain distinct incompatibility reasons", () => {
  const versionFixture = fixture();
  const architectureFixture = fixture();
  try {
    writeCompatibleHost(
      versionFixture.rootPath,
      "schema: 3\narchitecture: unified-workspace\n",
    );
    const version = new AiVerseOsCompatibilityDetector().inspect({
      rootPath: versionFixture.rootPath,
    });
    assert.equal(version.status, "incompatible");
    assert.ok(
      issueCodes(version).includes("SCHEMA_VERSION_UNSUPPORTED"),
    );

    writeCompatibleHost(
      architectureFixture.rootPath,
      "schema: 2\narchitecture: legacy-workspaces\n",
    );
    const architecture = new AiVerseOsCompatibilityDetector().inspect({
      rootPath: architectureFixture.rootPath,
    });
    assert.equal(architecture.status, "incompatible");
    assert.ok(
      issueCodes(architecture).includes("ARCHITECTURE_UNSUPPORTED"),
    );
  } finally {
    versionFixture.cleanup();
    architectureFixture.cleanup();
  }
});

test("ambiguous or malformed manifest identity fails closed", () => {
  const duplicateFixture = fixture();
  const missingFixture = fixture();
  try {
    writeCompatibleHost(
      duplicateFixture.rootPath,
      [
        "schema: 2",
        "schema_version: 2",
        "architecture: unified-workspace",
        "",
      ].join("\n"),
    );
    const duplicate = new AiVerseOsCompatibilityDetector().inspect({
      rootPath: duplicateFixture.rootPath,
    });
    assert.equal(duplicate.status, "incompatible");
    assert.ok(issueCodes(duplicate).includes("MANIFEST_MALFORMED"));

    writeCompatibleHost(
      missingFixture.rootPath,
      "name: incomplete\narchitecture: unified-workspace\n",
    );
    const missing = new AiVerseOsCompatibilityDetector().inspect({
      rootPath: missingFixture.rootPath,
    });
    assert.equal(missing.status, "incompatible");
    assert.ok(issueCodes(missing).includes("SCHEMA_VERSION_MISSING"));
  } finally {
    duplicateFixture.cleanup();
    missingFixture.cleanup();
  }
});

test("required AI-Verse host structure and extension contract are verified", () => {
  const agentsFixture = fixture();
  const operatorFixture = fixture();
  const workspacesFixture = fixture();
  const contractFixture = fixture();
  const referenceFixture = fixture();

  try {
    for (const f of [
      agentsFixture,
      operatorFixture,
      workspacesFixture,
      contractFixture,
      referenceFixture,
    ]) {
      writeCompatibleHost(f.rootPath);
    }

    rmSync(join(agentsFixture.rootPath, "AGENTS.md"));
    rmSync(join(operatorFixture.rootPath, "operator"), {
      recursive: true,
      force: true,
    });
    rmSync(join(workspacesFixture.rootPath, "workspaces"), {
      recursive: true,
      force: true,
    });
    rmSync(
      join(contractFixture.rootPath, "system", "extensions", "README.md"),
    );
    writeFileSync(
      join(referenceFixture.rootPath, "system", "extensions", "README.md"),
      "# Extension contract without registry path\n",
      "utf8",
    );

    const detector = new AiVerseOsCompatibilityDetector();
    assert.ok(
      issueCodes(detector.inspect({ rootPath: agentsFixture.rootPath }))
        .includes("AGENTS_MISSING"),
    );
    assert.ok(
      issueCodes(detector.inspect({ rootPath: operatorFixture.rootPath }))
        .includes("OPERATOR_MISSING"),
    );
    assert.ok(
      issueCodes(detector.inspect({ rootPath: workspacesFixture.rootPath }))
        .includes("WORKSPACES_MISSING"),
    );
    assert.ok(
      issueCodes(detector.inspect({ rootPath: contractFixture.rootPath }))
        .includes("EXTENSION_CONTRACT_MISSING"),
    );
    assert.ok(
      issueCodes(detector.inspect({ rootPath: referenceFixture.rootPath }))
        .includes("EXTENSION_CONTRACT_UNSUPPORTED"),
    );
  } finally {
    agentsFixture.cleanup();
    operatorFixture.cleanup();
    workspacesFixture.cleanup();
    contractFixture.cleanup();
    referenceFixture.cleanup();
  }
});

test("symlinked root and required host paths fail closed", () => {
  const parent = fixture();
  const child = fixture();
  const agentsFixture = fixture();
  const registryFixture = fixture();

  try {
    writeCompatibleHost(child.rootPath);
    const rootLink = join(parent.rootPath, "os-link");
    symlinkSync(child.rootPath, rootLink, "dir");

    const rootResult = new AiVerseOsCompatibilityDetector().inspect({
      rootPath: rootLink,
    });
    assert.equal(rootResult.status, "incompatible");
    assert.ok(issueCodes(rootResult).includes("ROOT_UNSAFE"));

    writeCompatibleHost(agentsFixture.rootPath);
    rmSync(join(agentsFixture.rootPath, "AGENTS.md"));
    writeFileSync(join(agentsFixture.rootPath, "agents-target.md"), "x");
    symlinkSync(
      join(agentsFixture.rootPath, "agents-target.md"),
      join(agentsFixture.rootPath, "AGENTS.md"),
      "file",
    );
    const agents = new AiVerseOsCompatibilityDetector().inspect({
      rootPath: agentsFixture.rootPath,
    });
    assert.equal(agents.status, "incompatible");
    assert.ok(issueCodes(agents).includes("AGENTS_UNSAFE"));

    writeCompatibleHost(registryFixture.rootPath);
    mkdirSync(join(registryFixture.rootPath, ".aiverse"), {
      recursive: true,
    });
    mkdirSync(join(registryFixture.rootPath, "registry-target"));
    symlinkSync(
      join(registryFixture.rootPath, "registry-target"),
      join(registryFixture.rootPath, ".aiverse", "extensions"),
      "dir",
    );
    const registry = new AiVerseOsCompatibilityDetector().inspect({
      rootPath: registryFixture.rootPath,
    });
    assert.equal(registry.status, "incompatible");
    assert.ok(
      issueCodes(registry).includes("EXTENSION_REGISTRY_PATH_UNSAFE"),
    );
  } finally {
    parent.cleanup();
    child.cleanup();
    agentsFixture.cleanup();
    registryFixture.cleanup();
  }
});

test("existing registry contents are not parsed or mutated during Task 19 detection", () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    mkdirSync(join(f.rootPath, ".aiverse", "extensions"), {
      recursive: true,
    });
    const registryPath = join(
      f.rootPath,
      ".aiverse",
      "extensions",
      "registry.json",
    );
    writeFileSync(registryPath, "{future-format-not-task19}", "utf8");

    const before = readFileSync(registryPath, "utf8");
    const result = new AiVerseOsCompatibilityDetector().inspect({
      rootPath: f.rootPath,
    });
    const after = readFileSync(registryPath, "utf8");

    assert.equal(result.status, "compatible");
    assert.equal(after, before);
  } finally {
    f.cleanup();
  }
});

test("oversized manifest is rejected before parsing", () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeFileSync(
      join(f.rootPath, "AI-VERSE.yaml"),
      `schema: 2\narchitecture: unified-workspace\npadding: ${"x".repeat(1024 * 1024)}\n`,
      "utf8",
    );

    const result = new AiVerseOsCompatibilityDetector().inspect({
      rootPath: f.rootPath,
    });
    assert.equal(result.status, "incompatible");
    assert.ok(issueCodes(result).includes("MANIFEST_TOO_LARGE"));
  } finally {
    f.cleanup();
  }
});
