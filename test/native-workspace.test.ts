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

import Database from "better-sqlite3";

import {
  AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
  AiVerseWorkspaceError,
  AiVerseWorkspaceDataInitializer,
  AiVerseWorkspaceDiscovery,
  AiVerseWorkspaceResolver,
  discoverWorkspaceData,
  initWorkspaceData,
  resolveWorkspace,
} from "../src/native/index.js";
import {
  TrustedDataRoot,
  createWorkspaceDataScope,
  openScopedDataDatabase,
} from "../src/scope/index.js";
import { SqliteStorageDriver } from "../src/storage/index.js";

interface Fixture {
  readonly rootPath: string;
  cleanup(): void;
}

function fixture(): Fixture {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-ws21-"));
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

function writeWorkspace(
  rootPath: string,
  workspaceId: string,
  overrides: Record<string, string> = {},
): void {
  const manifest: Record<string, string> = {
    schema_version: '"2.0"',
    id: `"${workspaceId}"`,
    name: `"Workspace ${workspaceId}"`,
    type: '"custom"',
    status: '"active"',
    purpose: '"Task 21 fixture workspace."',
    ...overrides,
  };
  const lines = [
    `schema_version: ${manifest.schema_version}`,
    `id: ${manifest.id}`,
    `name: ${manifest.name}`,
    `type: ${manifest.type}`,
    `status: ${manifest.status}`,
    `purpose: ${manifest.purpose}`,
    "",
  ];
  mkdirSync(join(rootPath, "workspaces", workspaceId), {
    recursive: true,
  });
  writeFileSync(
    join(rootPath, "workspaces", workspaceId, "WORKSPACE.yaml"),
    lines.join("\n"),
    "utf8",
  );
}

function errorCode(error: unknown): string | null {
  return error instanceof AiVerseWorkspaceError ? error.code : null;
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
      if (entry.isDirectory()) {
        output.push(`dir:${child}`);
        walk(child);
      } else if (entry.isSymbolicLink()) {
        output.push(`symlink:${child}`);
      } else if (entry.isFile()) {
        const absoluteChild = join(rootPath, child);
        if (child.endsWith(".sqlite") || child.endsWith(".sqlite-journal") || child.endsWith(".sqlite-wal") || child.endsWith(".sqlite-shm")) {
          output.push(`file:${child}:<sqlite-binary>`);
        } else {
          output.push(
            `file:${child}:${readFileSync(absoluteChild, "utf8")}`,
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

test("resolver accepts only ID input and derives the canonical Data path", () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "sales");

    const resolved = resolveWorkspace({
      rootPath: f.rootPath,
      workspaceId: "sales",
    });

    assert.equal(resolved.workspaceId, "sales");
    assert.equal(
      resolved.workspacePath,
      join(f.rootPath, "workspaces", "sales"),
    );
    assert.equal(
      resolved.manifestPath,
      join(f.rootPath, "workspaces", "sales", "WORKSPACE.yaml"),
    );
    assert.equal(
      resolved.databasePath,
      join(
        f.rootPath,
        "workspaces",
        "sales",
        "data",
        "ai-verse-data.sqlite",
      ),
    );
    assert.equal(
      resolved.databaseRelativePath,
      "workspaces/sales/data/ai-verse-data.sqlite",
    );
    assert.equal(resolved.manifest.status, "active");
    assert.equal(resolved.manifest.workspaceId, "sales");
    assert.equal(resolved.manifest.schemaMajor, 2);

    const viaClass = new AiVerseWorkspaceResolver().resolve({
      rootPath: f.rootPath,
      workspaceId: "sales",
    });
    assert.equal(viaClass.databasePath, resolved.databasePath);
  } finally {
    f.cleanup();
  }
});

test("resolver rejects host-contract-violating workspace IDs before touching the filesystem", () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    const before = snapshotTree(f.rootPath);

    for (const workspaceId of [
      "",
      "Sales",
      "sales_ops",
      "sales.ops",
      "../sales",
      "sales/other",
      "sales\\other",
      "a".repeat(129),
    ]) {
      assert.throws(
        () =>
          resolveWorkspace({
            rootPath: f.rootPath,
            workspaceId,
          }),
        (error) => errorCode(error) === "INVALID_WORKSPACE_ID",
        workspaceId === "" ? "(empty)" : workspaceId,
      );
    }

    assert.deepEqual(snapshotTree(f.rootPath), before);
  } finally {
    f.cleanup();
  }
});

test("resolver inspects only the requested workspace and fails closed on mismatch", () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "sales");
    writeWorkspace(f.rootPath, "other");

    assert.throws(
      () =>
        resolveWorkspace({
          rootPath: f.rootPath,
          workspaceId: "missing",
        }),
      (error) => errorCode(error) === "WORKSPACE_NOT_FOUND",
    );

    writeWorkspace(f.rootPath, "copied", { id: '"sales"' });
    assert.throws(
      () =>
        resolveWorkspace({
          rootPath: f.rootPath,
          workspaceId: "copied",
        }),
      (error) => errorCode(error) === "WORKSPACE_ID_MISMATCH",
    );

    assert.ok(
      existsSync(join(f.rootPath, "workspaces", "other", "WORKSPACE.yaml")),
    );
  } finally {
    f.cleanup();
  }
});

test("resolver rejects symlinked workspace directories and manifests", {
  skip: process.platform === "win32",
}, () => {
  const linkFixture = fixture();
  const manifestFixture = fixture();
  try {
    writeCompatibleHost(linkFixture.rootPath);
    writeCompatibleHost(manifestFixture.rootPath);
    writeWorkspace(linkFixture.rootPath, "real");
    writeWorkspace(manifestFixture.rootPath, "sales");

    const outside = mkdtempSync(join(tmpdir(), "ai-verse-data-ws21-out-"));
    try {
      rmSync(join(linkFixture.rootPath, "workspaces", "linked"), {
        recursive: true,
        force: true,
      });
      symlinkSync(
        join(linkFixture.rootPath, "workspaces", "real"),
        join(linkFixture.rootPath, "workspaces", "linked"),
      );
      assert.throws(
        () =>
          resolveWorkspace({
            rootPath: linkFixture.rootPath,
            workspaceId: "linked",
          }),
        (error) =>
          errorCode(error) === "WORKSPACE_UNSAFE" ||
          errorCode(error) === "WORKSPACE_ID_MISMATCH",
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }

    const manifestPath = join(
      manifestFixture.rootPath,
      "workspaces",
      "sales",
      "WORKSPACE.yaml",
    );
    const saved = readFileSync(manifestPath, "utf8");
    rmSync(manifestPath);
    symlinkSync(
      join(manifestFixture.rootPath, "AGENTS.md"),
      manifestPath,
    );
    assert.throws(
      () =>
        resolveWorkspace({
          rootPath: manifestFixture.rootPath,
          workspaceId: "sales",
        }),
      (error) => errorCode(error) === "WORKSPACE_MANIFEST_UNSAFE",
    );
    rmSync(manifestPath);
    writeFileSync(manifestPath, saved, "utf8");
  } finally {
    linkFixture.cleanup();
    manifestFixture.cleanup();
  }
});

test("resolver validates manifest identity fields and reports paused/archived status", () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);

    writeWorkspace(f.rootPath, "bad-schema", {
      schema_version: '"3.0"',
    });
    assert.throws(
      () =>
        resolveWorkspace({
          rootPath: f.rootPath,
          workspaceId: "bad-schema",
        }),
      (error) => errorCode(error) === "WORKSPACE_SCHEMA_UNSUPPORTED",
    );

    writeWorkspace(f.rootPath, "bad-status", { status: '"retired"' });
    assert.throws(
      () =>
        resolveWorkspace({
          rootPath: f.rootPath,
          workspaceId: "bad-status",
        }),
      (error) => errorCode(error) === "WORKSPACE_STATUS_INVALID",
    );

    writeWorkspace(f.rootPath, "empty-name", { name: '""' });
    assert.throws(
      () =>
        resolveWorkspace({
          rootPath: f.rootPath,
          workspaceId: "empty-name",
        }),
      (error) => errorCode(error) === "WORKSPACE_MANIFEST_MALFORMED",
    );

    writeWorkspace(f.rootPath, "paused-ws", { status: '"paused"' });
    const paused = resolveWorkspace({
      rootPath: f.rootPath,
      workspaceId: "paused-ws",
    });
    assert.equal(paused.manifest.status, "paused");

    writeWorkspace(f.rootPath, "archived-ws", {
      status: '"archived"',
    });
    const archived = resolveWorkspace({
      rootPath: f.rootPath,
      workspaceId: "archived-ws",
    });
    assert.equal(archived.manifest.status, "archived");

    writeWorkspace(f.rootPath, "tolerant", {});
    const manifestPath = join(
      f.rootPath,
      "workspaces",
      "tolerant",
      "WORKSPACE.yaml",
    );
    writeFileSync(
      manifestPath,
      `${readFileSync(manifestPath, "utf8")}future_field: keep-me\n`,
      "utf8",
    );
    const tolerant = resolveWorkspace({
      rootPath: f.rootPath,
      workspaceId: "tolerant",
    });
    assert.equal(tolerant.manifest.status, "active");
  } finally {
    f.cleanup();
  }
});

test("init creates exactly the requested active workspace database with exact binding", async () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "sales");
    writeWorkspace(f.rootPath, "other");

    const result = await initWorkspaceData({
      rootPath: f.rootPath,
      workspaceId: "sales",
    });

    assert.equal(result.status, "created");
    assert.equal(result.workspaceId, "sales");
    assert.equal(result.workspaceStatus, "active");
    assert.equal(
      result.databasePath,
      join(
        f.rootPath,
        "workspaces",
        "sales",
        "data",
        "ai-verse-data.sqlite",
      ),
    );
    assert.equal(result.discovery.state, "compatible");
    assert.ok(existsSync(result.databasePath));

    assert.equal(
      existsSync(
        join(f.rootPath, "workspaces", "other", "data", "ai-verse-data.sqlite"),
      ),
      false,
    );

    const driver = new SqliteStorageDriver();
    const root = TrustedDataRoot.fromExistingDirectory(f.rootPath);
    const scope = createWorkspaceDataScope(root, "sales");
    const handle = openScopedDataDatabase(driver, scope, {
      mode: "open-existing",
    });
    try {
      assert.deepEqual(handle.database.metadata().binding, {
        bindingVersion: 1,
        kind: "workspace",
        workspaceId: "sales",
      });
    } finally {
      handle.database.close();
    }

    const viaClass = await new AiVerseWorkspaceDataInitializer().initialize(
      {
        rootPath: f.rootPath,
        workspaceId: "sales",
      },
    );
    assert.equal(viaClass.status, "unchanged");
  } finally {
    f.cleanup();
  }
});

test("repeated init is idempotent and discovery-safe", async () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "sales");

    const first = await initWorkspaceData({
      rootPath: f.rootPath,
      workspaceId: "sales",
    });
    assert.equal(first.status, "created");

    const before = readFileSync(first.databasePath);
    const second = await initWorkspaceData({
      rootPath: f.rootPath,
      workspaceId: "sales",
    });
    assert.equal(second.status, "unchanged");
    assert.equal(second.databasePath, first.databasePath);
    assert.deepEqual(readFileSync(second.databasePath), before);
  } finally {
    f.cleanup();
  }
});

test("init refuses paused and archived workspaces without creating a database", async () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "paused-ws", { status: '"paused"' });
    writeWorkspace(f.rootPath, "archived-ws", {
      status: '"archived"',
    });

    await assert.rejects(
      initWorkspaceData({
        rootPath: f.rootPath,
        workspaceId: "paused-ws",
      }),
      (error) => errorCode(error) === "WORKSPACE_NOT_ACTIVE",
    );
    await assert.rejects(
      initWorkspaceData({
        rootPath: f.rootPath,
        workspaceId: "archived-ws",
      }),
      (error) => errorCode(error) === "WORKSPACE_NOT_ACTIVE",
    );

    assert.equal(
      existsSync(
        join(
          f.rootPath,
          "workspaces",
          "paused-ws",
          "data",
          "ai-verse-data.sqlite",
        ),
      ),
      false,
    );
    assert.equal(
      existsSync(
        join(
          f.rootPath,
          "workspaces",
          "archived-ws",
          "data",
          "ai-verse-data.sqlite",
        ),
      ),
      false,
    );
  } finally {
    f.cleanup();
  }
});

test("discovery distinguishes all seven workspace Data states", async () => {
  const missingFixture = fixture();
  const conflictFixture = fixture();
  const unsupportedFixture = fixture();
  const quarantinedFixture = fixture();
  const migrationFixture = fixture();
  const unavailableFixture = fixture();
  try {
    writeCompatibleHost(missingFixture.rootPath);
    writeWorkspace(missingFixture.rootPath, "sales");
    const missing = await discoverWorkspaceData({
      rootPath: missingFixture.rootPath,
      workspaceId: "sales",
    });
    assert.equal(missing.state, "missing");

    writeCompatibleHost(conflictFixture.rootPath);
    writeWorkspace(conflictFixture.rootPath, "sales");
    {
      const root = TrustedDataRoot.fromExistingDirectory(
        conflictFixture.rootPath,
      );
      const otherScope = createWorkspaceDataScope(root, "other");
      mkdirSync(
        join(
          conflictFixture.rootPath,
          "workspaces",
          "sales",
          "data",
        ),
        { recursive: true },
      );
      const foreignPath = join(
        conflictFixture.rootPath,
        "workspaces",
        "sales",
        "data",
        "ai-verse-data.sqlite",
      );
      const driver = new SqliteStorageDriver();
      mkdirSync(
        join(conflictFixture.rootPath, "workspaces", "other", "data"),
        { recursive: true },
      );
      const source = openScopedDataDatabase(driver, otherScope);
      source.database.close();
      const sourcePath = otherScope.databasePath();
      const bytes = readFileSync(sourcePath);
      writeFileSync(foreignPath, bytes);
    }
    const conflict = await discoverWorkspaceData({
      rootPath: conflictFixture.rootPath,
      workspaceId: "sales",
    });
    assert.equal(conflict.state, "scope_conflict");

    writeCompatibleHost(unsupportedFixture.rootPath);
    writeWorkspace(unsupportedFixture.rootPath, "sales");
    mkdirSync(
      join(unsupportedFixture.rootPath, "workspaces", "sales", "data"),
      { recursive: true },
    );
    {
      const foreignPath = join(
        unsupportedFixture.rootPath,
        "workspaces",
        "sales",
        "data",
        "ai-verse-data.sqlite",
      );
      const raw = new Database(foreignPath);
      try {
        raw.exec("CREATE TABLE unrelated (id INTEGER PRIMARY KEY);");
      } finally {
        raw.close();
      }
    }
    const unsupported = await discoverWorkspaceData({
      rootPath: unsupportedFixture.rootPath,
      workspaceId: "sales",
    });
    assert.equal(unsupported.state, "unsupported");

    writeCompatibleHost(quarantinedFixture.rootPath);
    writeWorkspace(quarantinedFixture.rootPath, "sales");
    await initWorkspaceData({
      rootPath: quarantinedFixture.rootPath,
      workspaceId: "sales",
    });
    {
      const quarantinePath = join(
        quarantinedFixture.rootPath,
        "workspaces",
        "sales",
        "data",
        "ai-verse-data.sqlite",
      );
      const raw = new Database(quarantinePath);
      try {
        raw.exec("DROP TRIGGER IF EXISTS _events_no_update");
        raw
          .prepare("UPDATE _events SET event_digest = ? WHERE event_sequence = 1")
          .run("0".repeat(64));
      } catch {
        // Seeded databases without events still exercise the path below.
      } finally {
        raw.close();
      }
      const rawCorrupt = new Database(quarantinePath);
      try {
        rawCorrupt.exec("PRAGMA writable_schema = ON;");
        rawCorrupt.exec("DELETE FROM _aiverse_meta WHERE key = 'format';");
      } finally {
        rawCorrupt.close();
      }
    }
    const quarantined = await discoverWorkspaceData({
      rootPath: quarantinedFixture.rootPath,
      workspaceId: "sales",
    });
    assert.equal(quarantined.state, "quarantined");

    writeCompatibleHost(migrationFixture.rootPath);
    writeWorkspace(migrationFixture.rootPath, "sales");
    await initWorkspaceData({
      rootPath: migrationFixture.rootPath,
      workspaceId: "sales",
    });
    {
      const databasePath = join(
        migrationFixture.rootPath,
        "workspaces",
        "sales",
        "data",
        "ai-verse-data.sqlite",
      );
      const raw = new Database(databasePath);
      try {
        raw.exec("DROP TABLE IF EXISTS _schema_migrations;");
        raw
          .prepare(
            "DELETE FROM _aiverse_meta WHERE key = 'migration_framework_version'",
          )
          .run();
        raw
          .prepare(
            "UPDATE _aiverse_meta SET value = '1' WHERE key = 'format_version'",
          )
          .run();
        raw.pragma("user_version = 1");
      } finally {
        raw.close();
      }
    }
    const migration = await discoverWorkspaceData({
      rootPath: migrationFixture.rootPath,
      workspaceId: "sales",
    });
    assert.equal(migration.state, "migration_required");

    writeCompatibleHost(unavailableFixture.rootPath);
    writeWorkspace(unavailableFixture.rootPath, "sales");
    await initWorkspaceData({
      rootPath: unavailableFixture.rootPath,
      workspaceId: "sales",
    });
    {
      const databasePath = join(
        unavailableFixture.rootPath,
        "workspaces",
        "sales",
        "data",
        "ai-verse-data.sqlite",
      );
      rmSync(databasePath);
      mkdirSync(databasePath, { recursive: true });
    }
    const unavailable = await discoverWorkspaceData({
      rootPath: unavailableFixture.rootPath,
      workspaceId: "sales",
    });
    assert.equal(unavailable.state, "unavailable");

    const viaClass = await new AiVerseWorkspaceDiscovery().discover({
      rootPath: missingFixture.rootPath,
      workspaceId: "sales",
    });
    assert.equal(viaClass.state, "missing");

    const states: Set<string> = new Set([
      missing.state,
      conflict.state,
      unsupported.state,
      quarantined.state,
      migration.state,
      unavailable.state,
    ]);
    assert.ok(states.has("missing"));
    assert.ok(states.has("scope_conflict"));
    assert.ok(states.has("unsupported"));
    assert.ok(states.has("quarantined"));
    assert.ok(states.has("migration_required"));
    assert.ok(states.has("unavailable"));

    const compatibleFixture = fixture();
    try {
      writeCompatibleHost(compatibleFixture.rootPath);
      writeWorkspace(compatibleFixture.rootPath, "sales");
      await initWorkspaceData({
        rootPath: compatibleFixture.rootPath,
        workspaceId: "sales",
      });
      const compatible = await discoverWorkspaceData({
        rootPath: compatibleFixture.rootPath,
        workspaceId: "sales",
      });
      assert.equal(compatible.state, "compatible");
      states.add(compatible.state);
      assert.equal(states.size, 7);
    } finally {
      compatibleFixture.cleanup();
    }
  } finally {
    missingFixture.cleanup();
    conflictFixture.cleanup();
    unsupportedFixture.cleanup();
    quarantinedFixture.cleanup();
    migrationFixture.cleanup();
    unavailableFixture.cleanup();
  }
});

test("init never silently replaces existing databases", async () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "sales");
    mkdirSync(join(f.rootPath, "workspaces", "sales", "data"), {
      recursive: true,
    });
    const existingPath = join(
      f.rootPath,
      "workspaces",
      "sales",
      "data",
      "ai-verse-data.sqlite",
    );
    const raw = new Database(existingPath);
    try {
      raw.exec("CREATE TABLE unrelated (id INTEGER PRIMARY KEY);");
    } finally {
      raw.close();
    }
    const before = readFileSync(existingPath);

    await assert.rejects(
      initWorkspaceData({
        rootPath: f.rootPath,
        workspaceId: "sales",
      }),
      (error) => errorCode(error) === "WORKSPACE_DATABASE_UNSUPPORTED",
    );
    assert.deepEqual(readFileSync(existingPath), before);
  } finally {
    f.cleanup();
  }
});

test("database files in the wrong workspace fail closed on binding", async () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "sales");
    writeWorkspace(f.rootPath, "other");

    await initWorkspaceData({
      rootPath: f.rootPath,
      workspaceId: "sales",
    });

    const salesPath = join(
      f.rootPath,
      "workspaces",
      "sales",
      "data",
      "ai-verse-data.sqlite",
    );
    const otherData = join(f.rootPath, "workspaces", "other", "data");
    mkdirSync(otherData, { recursive: true });
    const otherPath = join(otherData, "ai-verse-data.sqlite");
    writeFileSync(otherPath, readFileSync(salesPath));

    const discovery = await discoverWorkspaceData({
      rootPath: f.rootPath,
      workspaceId: "other",
    });
    assert.equal(discovery.state, "scope_conflict");

    await assert.rejects(
      initWorkspaceData({
        rootPath: f.rootPath,
        workspaceId: "other",
      }),
      (error) => errorCode(error) === "WORKSPACE_DATABASE_CONFLICT",
    );
  } finally {
    f.cleanup();
  }
});

test("symlinked database paths fail closed and discovery never migrates or repairs", async () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "sales");
    await initWorkspaceData({
      rootPath: f.rootPath,
      workspaceId: "sales",
    });

    const databasePath = join(
      f.rootPath,
      "workspaces",
      "sales",
      "data",
      "ai-verse-data.sqlite",
    );
    const before = readFileSync(databasePath);

    const migration = await discoverWorkspaceData({
      rootPath: f.rootPath,
      workspaceId: "sales",
    });
    assert.equal(migration.state, "compatible");
    assert.deepEqual(readFileSync(databasePath), before);

    if (process.platform !== "win32") {
      const outside = mkdtempSync(join(tmpdir(), "ai-verse-data-ws21-db-"));
      try {
        const target = join(outside, "external.sqlite");
        writeFileSync(target, before);
        rmSync(databasePath);
        symlinkSync(target, databasePath);
        const linkInfo = lstatSync(databasePath);
        assert.ok(linkInfo.isSymbolicLink());
        await assert.rejects(
          discoverWorkspaceData({
            rootPath: f.rootPath,
            workspaceId: "sales",
          }),
          (error) => errorCode(error) === "WORKSPACE_DATA_UNSAFE",
        );
      } finally {
        rmSync(databasePath, { force: true });
        writeFileSync(databasePath, before);
        rmSync(outside, { recursive: true, force: true });
      }
    }
  } finally {
    f.cleanup();
  }
});

test("other extension registry state and workspace files survive init", async () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "sales");
    mkdirSync(join(f.rootPath, ".aiverse", "extensions"), {
      recursive: true,
    });
    writeFileSync(
      join(f.rootPath, ".aiverse", "extensions", "registry.json"),
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

    const before = snapshotTree(f.rootPath).filter(
      (entry) =>
        !entry.startsWith("dir:workspaces/sales/data") &&
        !entry.startsWith("file:workspaces/sales/data/"),
    );

    await initWorkspaceData({
      rootPath: f.rootPath,
      workspaceId: "sales",
    });

    const after = snapshotTree(f.rootPath).filter(
      (entry) =>
        !entry.startsWith("dir:workspaces/sales/data") &&
        !entry.startsWith("file:workspaces/sales/data/"),
    );
    assert.deepEqual(after, before);
  } finally {
    f.cleanup();
  }
});

test("big-machine plus any-install-order still work after Task 21", async () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "big-machine-01");
    writeWorkspace(f.rootPath, "sales");

    const first = await initWorkspaceData({
      rootPath: f.rootPath,
      workspaceId: "big-machine-01",
    });
    assert.equal(first.status, "created");

    const second = await initWorkspaceData({
      rootPath: f.rootPath,
      workspaceId: "sales",
    });
    assert.equal(second.status, "created");

    const root = TrustedDataRoot.fromExistingDirectory(f.rootPath);
    const driver = new SqliteStorageDriver();
    for (const workspaceId of ["big-machine-01", "sales"]) {
      const scope = createWorkspaceDataScope(root, workspaceId);
      const handle = openScopedDataDatabase(driver, scope, {
        mode: "open-existing",
      });
      try {
        assert.equal(handle.database.metadata().binding?.workspaceId, workspaceId);
      } finally {
        handle.database.close();
      }
    }
  } finally {
    f.cleanup();
  }
});
