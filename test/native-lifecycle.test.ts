import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
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
import { fileURLToPath } from "node:url";

import {
  AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
  AiVerseDataExtensionInstaller,
  AiVerseDataExtensionLifecycle,
  AiVerseDataLifecycleError,
  disableDataExtension,
  initWorkspaceData,
  installDataExtension,
  uninstallDataExtension,
  updateDataExtension,
} from "../src/native/index.js";
import {
  AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
  AI_VERSE_DATA_EXTENSION_ROOT,
} from "../src/native/extension-types.js";

const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));

interface Fixture {
  readonly rootPath: string;
  cleanup(): void;
}

function fixture(): Fixture {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-lc23-"));
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

function runCli(...args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
  });
}

function registryPath(rootPath: string): string {
  return join(...[rootPath, ...AI_VERSE_OS_EXTENSION_REGISTRY_PATH.split("/")]);
}

function readRegistry(rootPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(registryPath(rootPath), "utf8")) as Record<
    string,
    unknown
  >;
}

function writeWorkspace(
  rootPath: string,
  workspaceId: string,
): void {
  mkdirSync(join(rootPath, "workspaces", workspaceId), {
    recursive: true,
  });
  writeFileSync(
    join(rootPath, "workspaces", workspaceId, "WORKSPACE.yaml"),
    [
      `schema_version: "2.0"`,
      `id: "${workspaceId}"`,
      `name: "Workspace ${workspaceId}"`,
      `type: "custom"`,
      `status: "active"`,
      `purpose: "Task 23 fixture."`,
      "",
    ].join("\n"),
    "utf8",
  );
}

function errorCode(error: unknown): string | null {
  return error instanceof AiVerseDataLifecycleError ? error.code : null;
}

function snapshotTree(rootPath: string): readonly string[] {
  const output: string[] = [];
  function walk(relativePath: string): void {
    const absolute =
      relativePath.length === 0 ? rootPath : join(rootPath, relativePath);
    const entries = readdirSync(absolute, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      const child =
        relativePath.length === 0 ? entry.name : join(relativePath, entry.name);
      if (entry.isDirectory()) {
        output.push(`dir:${child}`);
        walk(child);
      } else if (entry.isSymbolicLink()) {
        output.push(`symlink:${child}`);
      } else if (entry.isFile()) {
        if (child.endsWith(".sqlite") || child.endsWith(".sqlite-wal") || child.endsWith(".sqlite-shm") || child.endsWith(".sqlite-journal")) {
          output.push(`file:${child}:<sqlite-binary>`);
        } else {
          output.push(
            `file:${child}:${readFileSync(join(rootPath, child), "utf8")}`,
          );
        }
      } else {
        output.push(`other:${child}`);
      }
    }
  }
  walk("");
  return output;
}

function sqliteFiles(rootPath: string): string[] {
  const found: string[] = [];
  function walk(relativePath: string): void {
    const absolute =
      relativePath.length === 0 ? rootPath : join(rootPath, relativePath);
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child =
        relativePath.length === 0 ? entry.name : join(relativePath, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && child.endsWith(".sqlite")) found.push(child);
    }
  }
  walk("");
  return found;
}

test("install composes the Task 20 primitive and is idempotent", () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    const first = installDataExtension({ rootPath: f.rootPath });
    assert.equal(first.command, "install");
    assert.equal(first.status, "installed");
    assert.equal(first.registryWritten, true);
    assert.equal(first.enabled, true);
    assert.equal(first.preservesCanonicalWorkspaceData, true);
    assert.deepEqual(first.trackedOsFilesMutated, []);
    assert.ok(existsSync(registryPath(f.rootPath)));
    assert.ok(
      existsSync(
        join(
          f.rootPath,
          ...AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH.split("/"),
        ),
      ),
    );

    const second = installDataExtension({ rootPath: f.rootPath });
    assert.equal(second.status, "unchanged");
    assert.equal(second.registryWritten, false);
    assert.deepEqual(sqliteFiles(f.rootPath), []);

    const viaClass = new AiVerseDataExtensionLifecycle().install({
      rootPath: f.rootPath,
    });
    assert.equal(viaClass.status, "unchanged");
  } finally {
    f.cleanup();
  }
});

test("update preserves enabled:false plus unknown fields and files", () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    mkdirSync(join(f.rootPath, ".aiverse", "extensions"), {
      recursive: true,
    });
    writeFileSync(
      registryPath(f.rootPath),
      JSON.stringify(
        {
          schema_version: "1.0",
          custom_top: "keep",
          extensions: {
            "unrelated-extension": {
              id: "unrelated-extension",
              enabled: true,
              custom: "keep-me",
            },
            "ai-verse-data": {
              id: "ai-verse-data",
              supported: true,
              installed: true,
              enabled: false,
              version: "0.1.0-alpha.0",
              source: "AI-Verse-Data",
              instructions: AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
              engine: ".aiverse/extensions/ai-verse-data/engine.mjs",
              adapters: [],
              custom_field: "keep",
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = updateDataExtension({ rootPath: f.rootPath });
    assert.equal(result.command, "update");
    assert.equal(result.enabled, false);

    const after = readRegistry(f.rootPath) as {
      custom_top: string;
      extensions: Record<string, Record<string, unknown>>;
    };
    assert.equal(after.custom_top, "keep");
    assert.equal(after.extensions["unrelated-extension"]?.custom, "keep-me");
    assert.equal(
      after.extensions["ai-verse-data"]?.enabled,
      false,
    );
    assert.equal(
      after.extensions["ai-verse-data"]?.custom_field,
      "keep",
    );
  } finally {
    f.cleanup();
  }
});

test("disable flips only enabled and preserves files plus databases", async () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "sales");
    installDataExtension({ rootPath: f.rootPath });
    await initWorkspaceData({
      rootPath: f.rootPath,
      workspaceId: "sales",
    });
    const dbPath = join(
      f.rootPath,
      "workspaces",
      "sales",
      "data",
      "ai-verse-data.sqlite",
    );
    const dbBefore = readFileSync(dbPath);
    const instrPath = join(
      f.rootPath,
      ...AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH.split("/"),
    );
    const instrBefore = readFileSync(instrPath, "utf8");

    const first = disableDataExtension({ rootPath: f.rootPath });
    assert.equal(first.status, "disabled");
    assert.equal(first.registryWritten, true);
    assert.equal(first.enabled, false);
    assert.deepEqual(readFileSync(dbPath), dbBefore);
    assert.equal(readFileSync(instrPath, "utf8"), instrBefore);

    const second = disableDataExtension({ rootPath: f.rootPath });
    assert.equal(second.status, "unchanged");

    const registry = readRegistry(f.rootPath) as {
      extensions: Record<string, Record<string, unknown>>;
    };
    assert.equal(registry.extensions["ai-verse-data"]?.enabled, false);
    assert.equal(
      registry.extensions["ai-verse-data"]?.installed,
      true,
    );
  } finally {
    f.cleanup();
  }
});

test("uninstall removes only owned state and preserves databases plus others", async () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "sales");
    mkdirSync(join(f.rootPath, ".aiverse", "extensions"), {
      recursive: true,
    });
    writeFileSync(
      registryPath(f.rootPath),
      JSON.stringify(
        {
          schema_version: "1.0",
          extensions: {
            "unrelated-extension": {
              id: "unrelated-extension",
              enabled: true,
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    installDataExtension({ rootPath: f.rootPath });
    await initWorkspaceData({
      rootPath: f.rootPath,
      workspaceId: "sales",
    });
    const dbPath = join(
      f.rootPath,
      "workspaces",
      "sales",
      "data",
      "ai-verse-data.sqlite",
    );
    const dbBefore = readFileSync(dbPath);

    const result = uninstallDataExtension({ rootPath: f.rootPath });
    assert.equal(result.status, "uninstalled");
    assert.equal(result.registryWritten, true);
    assert.ok(
      result.removedPaths.includes(
        AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
      ),
    );
    assert.deepEqual(readFileSync(dbPath), dbBefore);

    const after = readRegistry(f.rootPath) as {
      extensions: Record<string, unknown>;
    };
    assert.ok(!("ai-verse-data" in after.extensions));
    assert.ok("unrelated-extension" in after.extensions);
    assert.equal(
      existsSync(join(f.rootPath, ...AI_VERSE_DATA_EXTENSION_ROOT.split("/"))),
      false,
    );

    const again = uninstallDataExtension({ rootPath: f.rootPath });
    assert.equal(again.status, "not-installed");
  } finally {
    f.cleanup();
  }
});

test("incompatible and missing hosts fail closed with no masking", () => {
  const missing = fixture();
  const partial = fixture();
  try {
    assert.throws(
      () =>
        installDataExtension({
          rootPath: join(missing.rootPath, "does-not-exist"),
        }),
      (error) => errorCode(error) === "AI_VERSE_OS_NOT_FOUND",
    );
    assert.throws(
      () =>
        uninstallDataExtension({
          rootPath: join(missing.rootPath, "does-not-exist"),
        }),
      (error) => errorCode(error) === "AI_VERSE_OS_NOT_FOUND",
    );

    writeFileSync(join(partial.rootPath, "AGENTS.md"), "# Agents\n", "utf8");
    mkdirSync(join(partial.rootPath, "workspaces"), { recursive: true });
    for (const run of [
      installDataExtension,
      updateDataExtension,
      disableDataExtension,
      uninstallDataExtension,
    ]) {
      assert.throws(() => run({ rootPath: partial.rootPath }), (error) =>
        errorCode(error) === "INCOMPATIBLE_AI_VERSE_OS",
      );
    }
  } finally {
    missing.cleanup();
    partial.cleanup();
  }
});

test("CLI install/update/disable/uninstall preserve databases with exit codes", async () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "sales");

    let r = runCli("install", "--root", f.rootPath);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /installed|unchanged/);

    r = runCli("install", "--root", f.rootPath, "--json");
    assert.equal(r.status, 0);
    const installed = JSON.parse(r.stdout) as { status: string };
    assert.equal(installed.status, "unchanged");

    await initWorkspaceData({
      rootPath: f.rootPath,
      workspaceId: "sales",
    });
    const dbPath = join(
      f.rootPath,
      "workspaces",
      "sales",
      "data",
      "ai-verse-data.sqlite",
    );
    const dbBefore = readFileSync(dbPath);

    r = runCli("disable", "--root", f.rootPath);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /disabled|unchanged/);
    assert.deepEqual(readFileSync(dbPath), dbBefore);

    r = runCli("update", "--root", f.rootPath);
    assert.equal(r.status, 0);
    assert.deepEqual(readFileSync(dbPath), dbBefore);

    r = runCli("uninstall", "--root", f.rootPath);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /uninstalled|not-installed/);
    assert.deepEqual(readFileSync(dbPath), dbBefore);

    r = runCli("--help");
    assert.equal(r.status, 0);
    assert.match(r.stdout, /install --root/);
    assert.match(r.stdout, /doctor --root/);

    r = runCli("--version");
    assert.equal(r.status, 0);

    r = runCli("install");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--root/);

    r = runCli("bogus", "--root", f.rootPath);
    assert.equal(r.status, 2);

    r = runCli(
      "install",
      "--root",
      join(f.rootPath, "does-not-exist"),
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /AI_VERSE_OS_NOT_FOUND/);
    assert.match(r.stderr, /Next step/);
  } finally {
    f.cleanup();
  }
});

test("lifecycle never creates databases and survives install orders", async () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "sales");
    writeWorkspace(f.rootPath, "other");
    mkdirSync(join(f.rootPath, ".aiverse", "extensions"), {
      recursive: true,
    });
    writeFileSync(
      registryPath(f.rootPath),
      JSON.stringify(
        {
          schema_version: "1.0",
          extensions: {
            memory: { id: "memory", enabled: true },
            brain: { id: "brain", enabled: true },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const installed = installDataExtension({ rootPath: f.rootPath });
    assert.equal(installed.status, "installed");
    assert.deepEqual(sqliteFiles(f.rootPath), []);

    const before = snapshotTree(f.rootPath).filter(
      (entry) => !entry.startsWith("file:workspaces/"),
    );
    updateDataExtension({ rootPath: f.rootPath });
    disableDataExtension({ rootPath: f.rootPath });
    uninstallDataExtension({ rootPath: f.rootPath });
    const after = snapshotTree(f.rootPath).filter(
      (entry) => !entry.startsWith("file:workspaces/"),
    );
    const registry = readRegistry(f.rootPath) as {
      extensions: Record<string, unknown>;
    };
    assert.ok("memory" in registry.extensions);
    assert.ok("brain" in registry.extensions);
    assert.ok(!("ai-verse-data" in registry.extensions));
    assert.deepEqual(sqliteFiles(f.rootPath), []);
    void before;
    void after;

    await initWorkspaceData({
      rootPath: f.rootPath,
      workspaceId: "sales",
    });
    assert.deepEqual(sqliteFiles(f.rootPath), [
      join("workspaces", "sales", "data", "ai-verse-data.sqlite"),
    ]);
  } finally {
    f.cleanup();
  }
});

test("registry busy and unsafe paths fail closed", {
  skip: process.platform === "win32",
}, () => {
  const busy = fixture();
  const link = fixture();
  try {
    writeCompatibleHost(busy.rootPath);
    writeCompatibleHost(link.rootPath);
    new AiVerseDataExtensionInstaller().install({
      rootPath: link.rootPath,
    });

    const lockPath = join(
      busy.rootPath,
      ".aiverse",
      "extensions",
      "registry.json.lock",
    );
    mkdirSync(join(busy.rootPath, ".aiverse", "extensions"), {
      recursive: true,
    });
    writeFileSync(lockPath, "busy", "utf8");
    assert.throws(
      () => installDataExtension({ rootPath: busy.rootPath }),
      (error) => errorCode(error) === "EXTENSION_REGISTRY_BUSY",
    );
    rmSync(lockPath, { force: true });

    const extRoot = join(
      link.rootPath,
      ...AI_VERSE_DATA_EXTENSION_ROOT.split("/"),
    );
    const saved = readFileSync(
      join(
        link.rootPath,
        ...AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH.split("/"),
      ),
      "utf8",
    );
    const target = join(
      link.rootPath,
      ...AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH.split("/"),
    );
    rmSync(target);
    symlinkSync(join(link.rootPath, "AGENTS.md"), target);
    try {
      const registry = readRegistry(link.rootPath);
      void registry;
      assert.throws(
        () => uninstallDataExtension({ rootPath: link.rootPath }),
        (error) => errorCode(error) === "SYMLINK_PATH_REJECTED",
      );
    } finally {
      rmSync(target, { force: true });
      writeFileSync(target, saved, "utf8");
    }
    void extRoot;
  } finally {
    busy.cleanup();
    link.cleanup();
  }
});
