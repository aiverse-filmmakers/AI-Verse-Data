import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
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

import { TrustedDataRoot } from "../src/scope/index.js";
import {
  AI_VERSE_DATA_EXTENSION_ENGINE_PATH,
  AI_VERSE_DATA_EXTENSION_ID,
  AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
  AI_VERSE_DATA_EXTENSION_MANIFEST_PATH,
  AI_VERSE_DATA_EXTENSION_ROOT,
  AI_VERSE_DATA_EXTENSION_VERSION,
  AI_VERSE_OS_EXTENSION_REGISTRY_LOCK_PATH,
  AI_VERSE_OS_EXTENSION_REGISTRY_SCHEMA,
  AiVerseDataExtensionInstallError,
  AiVerseDataExtensionInstaller,
} from "../src/native/index.js";
import {
  buildDataExtensionEntry,
  readRegistryDocument,
  registryWithDataEntry,
  validateAiVerseOsExtensionRelativePath,
  writeRegistryAtomic,
} from "../src/native/extension-registry.js";
import {
  materializeOwnedFiles,
  ownedFileContentsForTesting,
  rollbackOwnedFiles,
} from "../src/native/extension-materialization.js";
import { AI_VERSE_OS_EXTENSION_REGISTRY_PATH } from "../src/native/types.js";

interface Fixture {
  readonly rootPath: string;
  cleanup(): void;
}

function fixture(): Fixture {
  const rootPath = mkdtempSync(
    join(tmpdir(), "ai-verse-data-native-install-"),
  );
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

function absolute(rootPath: string, relativePath: string): string {
  return join(rootPath, ...relativePath.split("/"));
}

function ensureParent(rootPath: string, relativePath: string): void {
  const segments = relativePath.split("/");
  segments.pop();
  if (segments.length > 0) {
    mkdirSync(join(rootPath, ...segments), { recursive: true });
  }
}

function writeRelative(
  rootPath: string,
  relativePath: string,
  contents: string,
): void {
  ensureParent(rootPath, relativePath);
  writeFileSync(absolute(rootPath, relativePath), contents, "utf8");
}

function readRegistry(rootPath: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      absolute(rootPath, AI_VERSE_OS_EXTENSION_REGISTRY_PATH),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

function snapshotTree(rootPath: string): readonly string[] {
  const output: string[] = [];

  function walk(relativePath: string): void {
    const path =
      relativePath.length === 0
        ? rootPath
        : join(rootPath, relativePath);
    const entries = readdirSync(path, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    );

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
          `file:${display}:${readFileSync(
            join(rootPath, child),
            "utf8",
          )}`,
        );
      } else {
        output.push(`other:${display}`);
      }
    }
  }

  walk("");
  return output;
}

function errorCode(error: unknown): string | null {
  return error instanceof AiVerseDataExtensionInstallError
    ? error.code
    : null;
}

test("Task 20 plan is read-only and describes only Data-owned installation state", () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    const before = snapshotTree(f.rootPath);

    const plan = new AiVerseDataExtensionInstaller().plan({
      rootPath: f.rootPath,
    });

    const after = snapshotTree(f.rootPath);
    assert.deepEqual(after, before);
    assert.equal(plan.registryExists, false);
    assert.equal(plan.registryRequiresWrite, true);
    assert.equal(plan.requiresWrite, true);
    assert.equal(plan.currentEntry, null);
    assert.equal(plan.nextEntry.id, AI_VERSE_DATA_EXTENSION_ID);
    assert.equal(plan.nextEntry.enabled, true);
    assert.equal(
      plan.nextEntry.version,
      AI_VERSE_DATA_EXTENSION_VERSION,
    );
    assert.deepEqual(plan.trackedOsFilesMutated, []);
    assert.equal(plan.preservesUnknownRegistryFields, true);
    assert.equal(plan.preservesCanonicalWorkspaceData, true);
    assert.deepEqual(
      plan.ownedFiles.map((file) => file.relativePath),
      [
        AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
        AI_VERSE_DATA_EXTENSION_ENGINE_PATH,
        AI_VERSE_DATA_EXTENSION_MANIFEST_PATH,
      ],
    );
    assert.ok(plan.ownedFiles.every((file) => !file.exists));
    assert.ok(plan.ownedFiles.every((file) => file.requiresWrite));
    assert.equal(existsSync(join(f.rootPath, ".aiverse")), false);
  } finally {
    f.cleanup();
  }
});

test("fresh native install materializes only Data-owned files and registers schema 1.0", () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    mkdirSync(join(f.rootPath, "workspaces", "alpha"), {
      recursive: true,
    });
    writeFileSync(
      join(f.rootPath, "workspaces", "alpha", "WORKSPACE.yaml"),
      "id: alpha\n",
      "utf8",
    );

    const trackedBefore = {
      manifest: readFileSync(join(f.rootPath, "AI-VERSE.yaml"), "utf8"),
      agents: readFileSync(join(f.rootPath, "AGENTS.md"), "utf8"),
      extensionContract: readFileSync(
        join(f.rootPath, "system", "extensions", "README.md"),
        "utf8",
      ),
      workspace: snapshotTree(join(f.rootPath, "workspaces")),
    };

    const result = new AiVerseDataExtensionInstaller().install({
      rootPath: f.rootPath,
    });

    assert.equal(result.status, "installed");
    assert.equal(result.registryWritten, true);
    assert.deepEqual(result.materializedPaths, [
      AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
      AI_VERSE_DATA_EXTENSION_ENGINE_PATH,
      AI_VERSE_DATA_EXTENSION_MANIFEST_PATH,
    ]);

    const registry = readRegistry(f.rootPath);
    assert.equal(
      registry.schema_version,
      AI_VERSE_OS_EXTENSION_REGISTRY_SCHEMA,
    );
    const extensions = registry.extensions as Record<string, unknown>;
    assert.deepEqual(Object.keys(extensions), [
      AI_VERSE_DATA_EXTENSION_ID,
    ]);
    const entry = extensions[
      AI_VERSE_DATA_EXTENSION_ID
    ] as Record<string, unknown>;
    assert.equal(entry.id, AI_VERSE_DATA_EXTENSION_ID);
    assert.equal(entry.supported, true);
    assert.equal(entry.installed, true);
    assert.equal(entry.enabled, true);
    assert.equal(entry.version, AI_VERSE_DATA_EXTENSION_VERSION);
    assert.equal(
      entry.instructions,
      AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
    );
    assert.equal(entry.engine, AI_VERSE_DATA_EXTENSION_ENGINE_PATH);
    assert.deepEqual(entry.adapters, []);

    for (const relativePath of [
      AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
      AI_VERSE_DATA_EXTENSION_ENGINE_PATH,
      AI_VERSE_DATA_EXTENSION_MANIFEST_PATH,
    ]) {
      const path = absolute(f.rootPath, relativePath);
      assert.equal(lstatSync(path).isFile(), true);
      assert.equal(lstatSync(path).isSymbolicLink(), false);
    }

    const installedManifest = JSON.parse(
      readFileSync(
        absolute(f.rootPath, AI_VERSE_DATA_EXTENSION_MANIFEST_PATH),
        "utf8",
      ),
    ) as Record<string, unknown>;
    assert.equal(installedManifest.id, AI_VERSE_DATA_EXTENSION_ID);
    assert.equal(
      installedManifest.package_version,
      AI_VERSE_DATA_EXTENSION_VERSION,
    );
    assert.equal(
      installedManifest.registry_path,
      AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
    );
    assert.equal(
      installedManifest.registry_lock_path,
      AI_VERSE_OS_EXTENSION_REGISTRY_LOCK_PATH,
    );
    assert.equal(installedManifest.initializes_workspace_data, false);
    assert.deepEqual(installedManifest.tracked_os_files_mutated, []);

    assert.equal(
      readFileSync(join(f.rootPath, "AI-VERSE.yaml"), "utf8"),
      trackedBefore.manifest,
    );
    assert.equal(
      readFileSync(join(f.rootPath, "AGENTS.md"), "utf8"),
      trackedBefore.agents,
    );
    assert.equal(
      readFileSync(
        join(f.rootPath, "system", "extensions", "README.md"),
        "utf8",
      ),
      trackedBefore.extensionContract,
    );
    assert.deepEqual(
      snapshotTree(join(f.rootPath, "workspaces")),
      trackedBefore.workspace,
    );
    assert.equal(
      existsSync(
        join(
          f.rootPath,
          "workspaces",
          "alpha",
          "data",
          "ai-verse-data.sqlite",
        ),
      ),
      false,
    );
    assert.equal(
      existsSync(
        absolute(
          f.rootPath,
          AI_VERSE_OS_EXTENSION_REGISTRY_LOCK_PATH,
        ),
      ),
      false,
    );
  } finally {
    f.cleanup();
  }
});

test("install preserves unknown registry state, unrelated extensions, disabled state, and unknown Data-owned files", () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeRelative(
      f.rootPath,
      AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
      `${JSON.stringify(
        {
          schema_version: "1.0",
          operator_note: { preserve: true },
          extensions: {
            "other-extension": {
              id: "other-extension",
              installed: true,
              custom: { untouched: true },
            },
            [AI_VERSE_DATA_EXTENSION_ID]: {
              id: AI_VERSE_DATA_EXTENSION_ID,
              supported: true,
              installed: true,
              enabled: false,
              version: "0.0.1",
              source: "old-source",
              instructions: AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
              engine: AI_VERSE_DATA_EXTENSION_ENGINE_PATH,
              adapters: ["legacy-but-known-field"],
              operator_metadata: { keep: "yes" },
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    mkdirSync(absolute(f.rootPath, AI_VERSE_DATA_EXTENSION_ROOT), {
      recursive: true,
    });
    writeRelative(
      f.rootPath,
      `${AI_VERSE_DATA_EXTENSION_ROOT}/operator-note.txt`,
      "preserve unknown owned-directory file\n",
    );
    writeRelative(
      f.rootPath,
      AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
      "old instructions\n",
    );
    writeRelative(
      f.rootPath,
      AI_VERSE_DATA_EXTENSION_ENGINE_PATH,
      "old engine\n",
    );
    writeRelative(
      f.rootPath,
      AI_VERSE_DATA_EXTENSION_MANIFEST_PATH,
      "{}\n",
    );

    const result = new AiVerseDataExtensionInstaller().install({
      rootPath: f.rootPath,
    });
    assert.equal(result.status, "updated");

    const registry = readRegistry(f.rootPath);
    assert.deepEqual(registry.operator_note, { preserve: true });
    const extensions = registry.extensions as Record<string, unknown>;
    assert.deepEqual(extensions["other-extension"], {
      id: "other-extension",
      installed: true,
      custom: { untouched: true },
    });

    const entry = extensions[
      AI_VERSE_DATA_EXTENSION_ID
    ] as Record<string, unknown>;
    assert.equal(entry.enabled, false);
    assert.equal(entry.version, AI_VERSE_DATA_EXTENSION_VERSION);
    assert.deepEqual(entry.operator_metadata, { keep: "yes" });
    assert.deepEqual(entry.adapters, []);

    assert.equal(
      readFileSync(
        absolute(
          f.rootPath,
          `${AI_VERSE_DATA_EXTENSION_ROOT}/operator-note.txt`,
        ),
        "utf8",
      ),
      "preserve unknown owned-directory file\n",
    );
  } finally {
    f.cleanup();
  }
});

test("reinstall is persistent-state idempotent and byte-stable when current", () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    const installer = new AiVerseDataExtensionInstaller();

    const first = installer.install({ rootPath: f.rootPath });
    assert.equal(first.status, "installed");

    const paths = [
      AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
      AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
      AI_VERSE_DATA_EXTENSION_ENGINE_PATH,
      AI_VERSE_DATA_EXTENSION_MANIFEST_PATH,
    ];
    const before = Object.fromEntries(
      paths.map((relativePath) => [
        relativePath,
        readFileSync(absolute(f.rootPath, relativePath), "utf8"),
      ]),
    );

    const second = installer.install({ rootPath: f.rootPath });
    assert.equal(second.status, "unchanged");
    assert.equal(second.requiresWrite, false);
    assert.equal(second.registryWritten, false);
    assert.deepEqual(second.materializedPaths, []);

    for (const relativePath of paths) {
      assert.equal(
        readFileSync(absolute(f.rootPath, relativePath), "utf8"),
        before[relativePath],
      );
    }
  } finally {
    f.cleanup();
  }
});

test("malformed or unsupported registry state fails closed before Data file materialization", () => {
  const cases = [
    {
      name: "invalid json",
      text: "{not-json}\n",
      code: "INVALID_EXTENSION_REGISTRY",
    },
    {
      name: "unsupported schema",
      text: '{"schema_version":"9.0","extensions":{}}\n',
      code: "UNSUPPORTED_EXTENSION_REGISTRY_SCHEMA",
    },
    {
      name: "invalid extensions envelope",
      text: '{"schema_version":"1.0","extensions":[]}\n',
      code: "INVALID_EXTENSION_REGISTRY",
    },
  ] as const;

  for (const item of cases) {
    const f = fixture();
    try {
      writeCompatibleHost(f.rootPath);
      writeRelative(
        f.rootPath,
        AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
        item.text,
      );
      const before = readFileSync(
        absolute(f.rootPath, AI_VERSE_OS_EXTENSION_REGISTRY_PATH),
        "utf8",
      );

      assert.throws(
        () =>
          new AiVerseDataExtensionInstaller().install({
            rootPath: f.rootPath,
          }),
        (error: unknown) => errorCode(error) === item.code,
        item.name,
      );

      assert.equal(
        readFileSync(
          absolute(f.rootPath, AI_VERSE_OS_EXTENSION_REGISTRY_PATH),
          "utf8",
        ),
        before,
      );
      assert.equal(
        existsSync(absolute(f.rootPath, AI_VERSE_DATA_EXTENSION_ROOT)),
        false,
      );
    } finally {
      f.cleanup();
    }
  }
});

test("invalid existing ai-verse-data registration fails closed rather than guessing state", () => {
  for (const ownEntry of [
    "not-an-object",
    { id: AI_VERSE_DATA_EXTENSION_ID, enabled: "false" },
  ]) {
    const f = fixture();
    try {
      writeCompatibleHost(f.rootPath);
      writeRelative(
        f.rootPath,
        AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
        `${JSON.stringify({
          schema_version: "1.0",
          extensions: {
            [AI_VERSE_DATA_EXTENSION_ID]: ownEntry,
          },
        })}\n`,
      );

      assert.throws(
        () =>
          new AiVerseDataExtensionInstaller().install({
            rootPath: f.rootPath,
          }),
        (error: unknown) =>
          errorCode(error) === "INVALID_EXISTING_EXTENSION_ENTRY",
      );
      assert.equal(
        existsSync(absolute(f.rootPath, AI_VERSE_DATA_EXTENSION_ROOT)),
        false,
      );
    } finally {
      f.cleanup();
    }
  }
});

test("existing registry lock is never stolen or deleted", () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    const registryText =
      '{"schema_version":"1.0","extensions":{},"sentinel":"keep"}\n';
    const lockText =
      '{"extension_id":"other-extension","created_at":"unknown"}\n';
    writeRelative(
      f.rootPath,
      AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
      registryText,
    );
    writeRelative(
      f.rootPath,
      AI_VERSE_OS_EXTENSION_REGISTRY_LOCK_PATH,
      lockText,
    );

    assert.throws(
      () =>
        new AiVerseDataExtensionInstaller().install({
          rootPath: f.rootPath,
        }),
      (error: unknown) =>
        errorCode(error) === "EXTENSION_REGISTRY_BUSY",
    );

    assert.equal(
      readFileSync(
        absolute(f.rootPath, AI_VERSE_OS_EXTENSION_REGISTRY_PATH),
        "utf8",
      ),
      registryText,
    );
    assert.equal(
      readFileSync(
        absolute(
          f.rootPath,
          AI_VERSE_OS_EXTENSION_REGISTRY_LOCK_PATH,
        ),
        "utf8",
      ),
      lockText,
    );
    assert.equal(
      existsSync(absolute(f.rootPath, AI_VERSE_DATA_EXTENSION_ROOT)),
      false,
    );
  } finally {
    f.cleanup();
  }
});

test("extension path validator rejects absolute, traversal, empty, drive, UNC, and NUL paths", () => {
  for (const unsafe of [
    "../outside",
    "a/../outside",
    "/tmp/outside",
    "C:\\outside\\file",
    "\\\\server\\share",
    "a//b",
    "a/./b",
    "a\u0000b",
  ]) {
    assert.throws(
      () => validateAiVerseOsExtensionRelativePath(unsafe),
      (error: unknown) =>
        errorCode(error) === "INVALID_EXTENSION_PATH",
      unsafe,
    );
  }

  assert.equal(
    validateAiVerseOsExtensionRelativePath(
      ".aiverse/extensions/ai-verse-data/engine.mjs",
    ),
    ".aiverse/extensions/ai-verse-data/engine.mjs",
  );
});

test("symlinked extension root and owned files are rejected without registry mutation", () => {
  const external = fixture();
  const rootLinkFixture = fixture();
  const fileLinkFixture = fixture();

  try {
    writeCompatibleHost(rootLinkFixture.rootPath);
    mkdirSync(
      join(rootLinkFixture.rootPath, ".aiverse", "extensions"),
      { recursive: true },
    );
    symlinkSync(
      external.rootPath,
      absolute(rootLinkFixture.rootPath, AI_VERSE_DATA_EXTENSION_ROOT),
      "dir",
    );

    assert.throws(
      () =>
        new AiVerseDataExtensionInstaller().install({
          rootPath: rootLinkFixture.rootPath,
        }),
      (error: unknown) =>
        errorCode(error) === "SYMLINK_PATH_REJECTED",
    );
    assert.equal(
      existsSync(
        absolute(
          rootLinkFixture.rootPath,
          AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
        ),
      ),
      false,
    );

    writeCompatibleHost(fileLinkFixture.rootPath);
    mkdirSync(
      absolute(fileLinkFixture.rootPath, AI_VERSE_DATA_EXTENSION_ROOT),
      { recursive: true },
    );
    const externalFile = join(external.rootPath, "external.md");
    writeFileSync(externalFile, "external\n", "utf8");
    symlinkSync(
      externalFile,
      absolute(
        fileLinkFixture.rootPath,
        AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
      ),
      "file",
    );

    assert.throws(
      () =>
        new AiVerseDataExtensionInstaller().install({
          rootPath: fileLinkFixture.rootPath,
        }),
      (error: unknown) =>
        errorCode(error) === "SYMLINK_PATH_REJECTED",
    );
    assert.equal(readFileSync(externalFile, "utf8"), "external\n");
    assert.equal(
      existsSync(
        absolute(
          fileLinkFixture.rootPath,
          AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
        ),
      ),
      false,
    );
  } finally {
    external.cleanup();
    rootLinkFixture.cleanup();
    fileLinkFixture.cleanup();
  }
});

test("registry expected-raw guard detects a competing writer and preserves the newer registry", () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    const original =
      '{"schema_version":"1.0","extensions":{},"generation":1}\n';
    writeRelative(
      f.rootPath,
      AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
      original,
    );

    const root = TrustedDataRoot.fromExistingDirectory(f.rootPath);
    const snapshot = readRegistryDocument(root);
    const next = registryWithDataEntry(
      snapshot,
      buildDataExtensionEntry(null),
    );

    const competing =
      '{"schema_version":"1.0","extensions":{"other":{"id":"other"}},"generation":2}\n';
    writeFileSync(
      absolute(f.rootPath, AI_VERSE_OS_EXTENSION_REGISTRY_PATH),
      competing,
      "utf8",
    );

    assert.throws(
      () => writeRegistryAtomic(root, next, snapshot.rawText),
      (error: unknown) =>
        errorCode(error) === "EXTENSION_REGISTRY_CHANGED",
    );

    assert.equal(
      readFileSync(
        absolute(f.rootPath, AI_VERSE_OS_EXTENSION_REGISTRY_PATH),
        "utf8",
      ),
      competing,
    );
  } finally {
    f.cleanup();
  }
});

test("pre-commit registry race can roll Data-owned files back without touching the competing registry", () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    const originalRegistry =
      '{"schema_version":"1.0","extensions":{},"generation":1}\n';
    writeRelative(
      f.rootPath,
      AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
      originalRegistry,
    );

    mkdirSync(absolute(f.rootPath, AI_VERSE_DATA_EXTENSION_ROOT), {
      recursive: true,
    });
    const previous = new Map<string, string>();
    for (const relativePath of [
      AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
      AI_VERSE_DATA_EXTENSION_ENGINE_PATH,
      AI_VERSE_DATA_EXTENSION_MANIFEST_PATH,
    ]) {
      const old = `old:${relativePath}\n`;
      previous.set(relativePath, old);
      writeRelative(f.rootPath, relativePath, old);
    }

    const root = TrustedDataRoot.fromExistingDirectory(f.rootPath);
    const registry = readRegistryDocument(root);
    const materialization = materializeOwnedFiles(root);
    assert.equal(materialization.changedPaths.length, 3);

    const competing =
      '{"schema_version":"1.0","extensions":{"other":{"id":"other"}},"generation":2}\n';
    writeFileSync(
      absolute(f.rootPath, AI_VERSE_OS_EXTENSION_REGISTRY_PATH),
      competing,
      "utf8",
    );

    assert.throws(
      () =>
        writeRegistryAtomic(
          root,
          registryWithDataEntry(
            registry,
            buildDataExtensionEntry(null),
          ),
          registry.rawText,
        ),
      (error: unknown) =>
        errorCode(error) === "EXTENSION_REGISTRY_CHANGED",
    );

    rollbackOwnedFiles(root, materialization.snapshots);

    for (const [relativePath, old] of previous) {
      assert.equal(
        readFileSync(absolute(f.rootPath, relativePath), "utf8"),
        old,
      );
    }
    assert.equal(
      readFileSync(
        absolute(f.rootPath, AI_VERSE_OS_EXTENSION_REGISTRY_PATH),
        "utf8",
      ),
      competing,
    );
  } finally {
    f.cleanup();
  }
});

test("no-os and incompatible hosts are rejected before native installation state is created", () => {
  const noOs = fixture();
  const incompatible = fixture();

  try {
    assert.throws(
      () =>
        new AiVerseDataExtensionInstaller().install({
          rootPath: noOs.rootPath,
        }),
      (error: unknown) =>
        errorCode(error) === "AI_VERSE_OS_NOT_FOUND",
    );
    assert.equal(existsSync(join(noOs.rootPath, ".aiverse")), false);

    writeCompatibleHost(incompatible.rootPath);
    writeFileSync(
      join(incompatible.rootPath, "AI-VERSE.yaml"),
      'schema_version: "3.0"\narchitecture: unified-workspace\n',
      "utf8",
    );

    assert.throws(
      () =>
        new AiVerseDataExtensionInstaller().install({
          rootPath: incompatible.rootPath,
        }),
      (error: unknown) =>
        errorCode(error) === "INCOMPATIBLE_AI_VERSE_OS",
    );
    assert.equal(
      existsSync(join(incompatible.rootPath, ".aiverse")),
      false,
    );
  } finally {
    noOs.cleanup();
    incompatible.cleanup();
  }
});

test("materialized file constants are deterministic and do not expose workspace initialization", () => {
  const instructions = ownedFileContentsForTesting(
    AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
  );
  const engine = ownedFileContentsForTesting(
    AI_VERSE_DATA_EXTENSION_ENGINE_PATH,
  );
  const manifest = ownedFileContentsForTesting(
    AI_VERSE_DATA_EXTENSION_MANIFEST_PATH,
  );

  assert.match(instructions ?? "", /never creates a workspace database implicitly/);
  assert.match(engine ?? "", /registrationOnly: false/);
  assert.match(engine ?? "", /phase: "5\.6"/);
  assert.match(instructions ?? "", /workspace discovery and initialization are explicit native operations/);
  const parsed = JSON.parse(manifest ?? "{}") as Record<string, unknown>;
  assert.equal(parsed.id, AI_VERSE_DATA_EXTENSION_ID);
  assert.equal(parsed.package_version, AI_VERSE_DATA_EXTENSION_VERSION);
  assert.equal(parsed.initializes_workspace_data, false);
  assert.equal(parsed.workspace_initialization, "explicit");
  assert.equal(parsed.release_phase, "5.6");
  assert.equal(parsed.release_complete, true);
  assert.equal(parsed.registration_grants_permissions, false);
  assert.equal(parsed.registration_asserts_health, false);
});
