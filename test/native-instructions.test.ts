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
  AiVerseDataExtensionInstaller,
  AiVerseDataInstructionDiscovery,
  AiVerseDataInstructionError,
  discoverExtensionInstructions,
} from "../src/native/index.js";
import { resolveExtensionOwnedPath } from "../src/native/extension-registry.js";
import { TrustedDataRoot } from "../src/scope/index.js";
import {
  AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
  AI_VERSE_DATA_EXTENSION_MANIFEST_PATH,
} from "../src/native/extension-types.js";

interface Fixture {
  readonly rootPath: string;
  cleanup(): void;
}

function fixture(): Fixture {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-instr22-"));
  return {
    rootPath,
    cleanup(): void {
      rmSync(rootPath, { recursive: true, force: true });
    },
  };
}

function writeCompatibleHost(rootPath: string): void {
  writeFileSync(
    join(rootPath, "AI-VERSE.yaml"),
    'schema_version: "2.0"\narchitecture: unified-workspace\n',
    "utf8",
  );
  writeFileSync(join(rootPath, "AGENTS.md"), "# Runtime\n", "utf8");
  mkdirSync(join(rootPath, "operator"), { recursive: true });
  mkdirSync(join(rootPath, "workspaces"), { recursive: true });
  mkdirSync(join(rootPath, "system", "extensions"), {
    recursive: true,
  });
  writeFileSync(
    join(rootPath, "system", "extensions", "README.md"),
    `# Local extensions\nRegistry: ${AI_VERSE_OS_EXTENSION_REGISTRY_PATH}\n`,
    "utf8",
  );
}

function installedRoot(): Fixture {
  const f = fixture();
  writeCompatibleHost(f.rootPath);
  new AiVerseDataExtensionInstaller().install({
    rootPath: f.rootPath,
  });
  return f;
}

function errorCode(error: unknown): string | null {
  return error instanceof AiVerseDataInstructionError ? error.code : null;
}

function snapshotTree(rootPath: string): readonly string[] {
  const output: string[] = [];

  function walk(relativePath: string): void {
    const absolute =
      relativePath.length === 0
        ? rootPath
        : join(rootPath, relativePath);
    const entries = readdirSync(absolute, {
      withFileTypes: true,
    }).sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const child =
        relativePath.length === 0
          ? entry.name
          : join(relativePath, entry.name);
      const display = child.split("\\").join("/");
      if (entry.isDirectory()) {
        output.push(`dir:${display}`);
        walk(child);
      } else if (entry.isSymbolicLink()) {
        output.push(`symlink:${display}`);
      } else if (entry.isFile()) {
        output.push(
          `file:${display}:${readFileSync(join(rootPath, child), "utf8")}`,
        );
      } else {
        output.push(`other:${display}`);
      }
    }
  }

  walk("");
  return output;
}

function readRegistry(rootPath: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      join(...[rootPath, ...AI_VERSE_OS_EXTENSION_REGISTRY_PATH.split("/")]),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

function writeRegistry(rootPath: string, document: unknown): void {
  writeFileSync(
    join(...[rootPath, ...AI_VERSE_OS_EXTENSION_REGISTRY_PATH.split("/")]),
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8",
  );
}

function findSqliteFiles(rootPath: string): string[] {
  const found: string[] = [];
  function walk(relativePath: string): void {
    const absolute =
      relativePath.length === 0
        ? rootPath
        : join(rootPath, relativePath);
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child =
        relativePath.length === 0
          ? entry.name
          : join(relativePath, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && child.endsWith(".sqlite")) found.push(child);
    }
  }
  walk("");
  return found;
}

test("ready discovery returns Data files only and leaves the fixture byte-identical", () => {
  const f = installedRoot();
  try {
    const registryBefore = readFileSync(
      join(...[f.rootPath, ...AI_VERSE_OS_EXTENSION_REGISTRY_PATH.split("/")]),
      "utf8",
    );
    const before = snapshotTree(f.rootPath);

    const result = discoverExtensionInstructions({
      rootPath: f.rootPath,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.taskRelevant, true);
    assert.equal(result.taskHint, null);
    assert.equal(result.provenance.extensionId, "ai-verse-data");
    assert.equal(result.provenance.supported, true);
    assert.equal(result.provenance.installed, true);
    assert.equal(result.provenance.enabled, true);
    assert.equal(result.provenance.registryExists, true);
    assert.ok(result.instructions !== null);
    assert.ok(result.engine !== null);
    assert.ok(result.manifest !== null);
    assert.equal(
      result.instructions.relativePath,
      AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
    );
    assert.match(result.instructions.contents, /structured operational/);
    assert.match(result.engine.contents, /registrationOnly/);
    assert.match(result.manifest.contents, /ai-verse-data/);
    assert.deepEqual(result.adapters, []);
    assert.ok(
      result.instructions.absolutePath.startsWith(f.rootPath),
    );

    const viaClass = new AiVerseDataInstructionDiscovery().discover({
      rootPath: f.rootPath,
    });
    assert.equal(viaClass.status, "ready");
    assert.equal(
      viaClass.instructions?.contents,
      result.instructions.contents,
    );

    assert.deepEqual(snapshotTree(f.rootPath), before);
    assert.equal(
      readFileSync(
        join(...[f.rootPath, ...AI_VERSE_OS_EXTENSION_REGISTRY_PATH.split("/")]),
        "utf8",
      ),
      registryBefore,
    );
    assert.deepEqual(findSqliteFiles(f.rootPath), []);
  } finally {
    f.cleanup();
  }
});

test("task-relevant filtering matches related hints and rejects unrelated ones", () => {
  const f = installedRoot();
  try {
    const related = discoverExtensionInstructions({
      rootPath: f.rootPath,
      taskHint: "structured records workspace",
    });
    assert.equal(related.status, "ready");
    assert.equal(related.taskRelevant, true);
    assert.ok(related.matchedTerms.length > 0);
    assert.ok(related.matchedTerms.includes("structured"));

    const unrelated = discoverExtensionInstructions({
      rootPath: f.rootPath,
      taskHint: "zzzqqq jjjkkk",
    });
    assert.equal(unrelated.status, "ready");
    assert.equal(unrelated.taskRelevant, false);
    assert.deepEqual(unrelated.matchedTerms, []);
    assert.ok(unrelated.instructions !== null);

    assert.deepEqual(snapshotTree(f.rootPath), snapshotTree(f.rootPath));
  } finally {
    f.cleanup();
  }
});

test("disabled extension loads no files and reports provenance", () => {
  const f = installedRoot();
  try {
    const registry = readRegistry(f.rootPath) as {
      extensions: Record<string, Record<string, unknown>>;
    };
    registry.extensions["ai-verse-data"] = {
      ...registry.extensions["ai-verse-data"],
      enabled: false,
    };
    writeRegistry(f.rootPath, registry);
    const before = snapshotTree(f.rootPath);

    const result = discoverExtensionInstructions({
      rootPath: f.rootPath,
      taskHint: "structured records",
    });

    assert.equal(result.status, "disabled");
    assert.equal(result.taskRelevant, false);
    assert.equal(result.provenance.enabled, false);
    assert.equal(result.instructions, null);
    assert.equal(result.engine, null);
    assert.equal(result.manifest, null);
    assert.deepEqual(result.adapters, []);
    assert.deepEqual(snapshotTree(f.rootPath), before);
  } finally {
    f.cleanup();
  }
});

test("missing registry reports not-installed without failing", () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    const result = discoverExtensionInstructions({
      rootPath: f.rootPath,
    });
    assert.equal(result.status, "not-installed");
    assert.equal(result.taskRelevant, true);
    assert.equal(result.instructions, null);
    assert.equal(result.provenance.registryExists, false);
    assert.deepEqual(findSqliteFiles(f.rootPath), []);
  } finally {
    f.cleanup();
  }
});

test("malformed and unsupported registries fail closed read-only", () => {
  const badJson = fixture();
  const badSchema = fixture();
  const badEntry = fixture();
  const badEnabled = fixture();
  try {
    for (const f of [badJson, badSchema, badEntry, badEnabled]) {
      writeCompatibleHost(f.rootPath);
    }

    mkdirSync(
      join(badJson.rootPath, ".aiverse", "extensions"),
      { recursive: true },
    );
    writeFileSync(
      join(...[badJson.rootPath, ...AI_VERSE_OS_EXTENSION_REGISTRY_PATH.split("/")]),
      "{not-json",
      "utf8",
    );

    assert.throws(
      () => discoverExtensionInstructions({ rootPath: badJson.rootPath }),
      (error) => errorCode(error) === "INVALID_EXTENSION_REGISTRY",
    );

    new AiVerseDataExtensionInstaller().install({
      rootPath: badSchema.rootPath,
    });
    const schemaRegistry = readRegistry(badSchema.rootPath) as Record<
      string,
      unknown
    >;
    writeRegistry(badSchema.rootPath, {
      ...schemaRegistry,
      schema_version: "2.0",
    });
    const schemaBefore = snapshotTree(badSchema.rootPath);
    assert.throws(
      () => discoverExtensionInstructions({ rootPath: badSchema.rootPath }),
      (error) =>
        errorCode(error) === "UNSUPPORTED_EXTENSION_REGISTRY_SCHEMA",
    );
    assert.deepEqual(snapshotTree(badSchema.rootPath), schemaBefore);

    new AiVerseDataExtensionInstaller().install({
      rootPath: badEntry.rootPath,
    });
    const entryRegistry = readRegistry(badEntry.rootPath) as {
      extensions: Record<string, unknown>;
    };
    entryRegistry.extensions["ai-verse-data"] = "broken";
    writeRegistry(badEntry.rootPath, entryRegistry);
    assert.throws(
      () => discoverExtensionInstructions({ rootPath: badEntry.rootPath }),
      (error) => errorCode(error) === "INVALID_EXISTING_EXTENSION_ENTRY",
    );

    new AiVerseDataExtensionInstaller().install({
      rootPath: badEnabled.rootPath,
    });
    const enabledRegistry = readRegistry(badEnabled.rootPath) as {
      extensions: Record<string, Record<string, unknown>>;
    };
    enabledRegistry.extensions["ai-verse-data"] = {
      ...enabledRegistry.extensions["ai-verse-data"],
      supported: true,
      installed: true,
      enabled: "yes",
    };
    writeRegistry(badEnabled.rootPath, enabledRegistry);
    assert.throws(
      () => discoverExtensionInstructions({ rootPath: badEnabled.rootPath }),
      (error) => errorCode(error) === "INVALID_EXISTING_EXTENSION_ENTRY",
    );
  } finally {
    badJson.cleanup();
    badSchema.cleanup();
    badEntry.cleanup();
    badEnabled.cleanup();
  }
});

test("traversal, absolute, and symlink paths fail closed", {
  skip: process.platform === "win32",
}, () => {
  const traversal = installedRoot();
  const absolute = installedRoot();
  const link = installedRoot();
  try {
    const tRegistry = readRegistry(traversal.rootPath) as {
      extensions: Record<string, Record<string, unknown>>;
    };
    tRegistry.extensions["ai-verse-data"] = {
      ...tRegistry.extensions["ai-verse-data"],
      instructions: "../escape.md",
    };
    writeRegistry(traversal.rootPath, tRegistry);
    assert.throws(
      () => discoverExtensionInstructions({ rootPath: traversal.rootPath }),
      (error) => errorCode(error) === "INVALID_EXTENSION_PATH",
    );

    const aRegistry = readRegistry(absolute.rootPath) as {
      extensions: Record<string, Record<string, unknown>>;
    };
    aRegistry.extensions["ai-verse-data"] = {
      ...aRegistry.extensions["ai-verse-data"],
      instructions: "/abs/path/INSTRUCTIONS.md",
    };
    writeRegistry(absolute.rootPath, aRegistry);
    assert.throws(
      () => discoverExtensionInstructions({ rootPath: absolute.rootPath }),
      (error) => errorCode(error) === "INVALID_EXTENSION_PATH",
    );

    const root = TrustedDataRoot.fromExistingDirectory(link.rootPath);
    const target = resolveExtensionOwnedPath(
      root,
      AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
    );
    const saved = readFileSync(target, "utf8");
    rmSync(target);
    symlinkSync(join(link.rootPath, "AGENTS.md"), target);
    try {
      assert.throws(
        () => discoverExtensionInstructions({ rootPath: link.rootPath }),
        (error) => errorCode(error) === "SYMLINK_PATH_REJECTED",
      );
    } finally {
      rmSync(target);
      writeFileSync(target, saved, "utf8");
    }
  } finally {
    traversal.cleanup();
    absolute.cleanup();
    link.cleanup();
  }
});

test("unrelated extensions are preserved and never loaded", () => {
  const f = installedRoot();
  try {
    const registry = readRegistry(f.rootPath) as {
      extensions: Record<string, unknown>;
    };
    registry.extensions["unrelated-extension"] = {
      id: "unrelated-extension",
      supported: true,
      installed: true,
      enabled: true,
      instructions: ".aiverse/extensions/unrelated/INSTRUCTIONS.md",
    };
    writeRegistry(f.rootPath, registry);

    const result = discoverExtensionInstructions({
      rootPath: f.rootPath,
    });
    assert.equal(result.status, "ready");
    assert.ok(result.instructions !== null);
    assert.match(result.instructions.contents, /AI-Verse Data/);
    assert.ok(!result.instructions.contents.includes("unrelated"));
    const after = readRegistry(f.rootPath) as {
      extensions: Record<string, unknown>;
    };
    assert.ok("unrelated-extension" in after.extensions);
  } finally {
    f.cleanup();
  }
});

test("manifest metadata plus adapters load only from the Data-owned directory", () => {
  const f = installedRoot();
  try {
    const root = TrustedDataRoot.fromExistingDirectory(f.rootPath);
    const adapterRelative =
      ".aiverse/extensions/ai-verse-data/ADAPTER.md";
    const adapterAbsolute = resolveExtensionOwnedPath(root, adapterRelative);
    writeFileSync(adapterAbsolute, "# Adapter\n", "utf8");

    const registry = readRegistry(f.rootPath) as {
      extensions: Record<string, Record<string, unknown>>;
    };
    registry.extensions["ai-verse-data"] = {
      ...registry.extensions["ai-verse-data"],
      adapters: [adapterRelative],
    };
    writeRegistry(f.rootPath, registry);

    const result = discoverExtensionInstructions({
      rootPath: f.rootPath,
    });
    assert.equal(result.status, "ready");
    assert.equal(result.adapters.length, 1);
    assert.equal(result.adapters[0]?.relativePath, adapterRelative);
    assert.match(result.adapters[0]?.contents ?? "", /Adapter/);
    assert.equal(
      result.manifest?.relativePath,
      AI_VERSE_DATA_EXTENSION_MANIFEST_PATH,
    );

    const outside = readRegistry(f.rootPath) as {
      extensions: Record<string, Record<string, unknown>>;
    };
    outside.extensions["ai-verse-data"] = {
      ...outside.extensions["ai-verse-data"],
      adapters: ["../outside.md"],
    };
    writeRegistry(f.rootPath, outside);
    assert.throws(
      () => discoverExtensionInstructions({ rootPath: f.rootPath }),
      (error) => errorCode(error) === "INVALID_EXTENSION_PATH",
    );
  } finally {
    f.cleanup();
  }
});

test("incompatible hosts fail closed with no standalone masking", () => {
  const partial = fixture();
  const missingRoot = fixture();
  try {
    writeFileSync(
      join(partial.rootPath, "AGENTS.md"), "# Agents\n", "utf8");
    mkdirSync(join(partial.rootPath, "workspaces"), { recursive: true });
    assert.throws(
      () => discoverExtensionInstructions({ rootPath: partial.rootPath }),
      (error) => errorCode(error) === "INCOMPATIBLE_AI_VERSE_OS",
    );

    assert.throws(
      () =>
        discoverExtensionInstructions({
          rootPath: join(missingRoot.rootPath, "does-not-exist"),
        }),
      (error) => errorCode(error) === "AI_VERSE_OS_NOT_FOUND",
    );
  } finally {
    partial.cleanup();
    missingRoot.cleanup();
  }
});

test("invalid task hints fail closed before any file load", () => {
  const f = installedRoot();
  try {
    const before = snapshotTree(f.rootPath);
    assert.throws(
      () =>
        discoverExtensionInstructions({
          rootPath: f.rootPath,
          taskHint: "bad hint",
        }),
      (error) => errorCode(error) === "INVALID_TASK_HINT",
    );
    assert.throws(
      () =>
        discoverExtensionInstructions({
          rootPath: f.rootPath,
          taskHint: "a".repeat(513),
        }),
      (error) => errorCode(error) === "INVALID_TASK_HINT",
    );
    assert.deepEqual(snapshotTree(f.rootPath), before);
  } finally {
    f.cleanup();
  }
});
