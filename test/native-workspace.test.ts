import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import {
  AI_VERSE_DATA_EXTENSION_ENGINE_PATH,
  AI_VERSE_DATA_EXTENSION_ID,
  AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
  AI_VERSE_DATA_EXTENSION_MANIFEST_PATH,
  AiVerseDataExtensionInstaller,
  AiVerseDataWorkspaceManager,
  AiVerseWorkspaceError,
} from "../src/native/index.js";
import { AI_VERSE_OS_EXTENSION_REGISTRY_PATH } from "../src/native/types.js";
import {
  AI_VERSE_DATA_SCOPE_BINDING_VERSION,
  SqliteStorageDriver,
} from "../src/storage/index.js";

const MIGRATION_ID = "sqlite-0001-v1-to-v2";
const MIGRATION_DIGEST = createHash("sha256")
  .update(
    "ai-verse-data/sqlite migration 1->2: internal migration ledger framework v1",
    "utf8",
  )
  .digest("hex");

interface Fixture {
  readonly rootPath: string;
  cleanup(): void;
}

function fixture(): Fixture {
  const rootPath = mkdtempSync(
    join(tmpdir(), "ai-verse-data-native-workspace-"),
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

function workspaceManifest(
  id: string,
  status: "active" | "paused" | "archived" = "active",
  extra = "",
): string {
  return [
    'schema_version: "2.0"',
    `id: "${id}"`,
    `name: "Workspace ${id}"`,
    'type: "custom"',
    `status: "${status}"`,
    'purpose: "Native Data workspace"',
    extra,
    "",
  ].join("\n");
}

function writeWorkspace(
  rootPath: string,
  id: string,
  options: {
    readonly status?: "active" | "paused" | "archived";
    readonly manifest?: string;
  } = {},
): void {
  const path = join(rootPath, "workspaces", id);
  mkdirSync(path, { recursive: true });
  writeFileSync(
    join(path, "WORKSPACE.yaml"),
    options.manifest ??
      workspaceManifest(id, options.status ?? "active"),
    "utf8",
  );
}

function installData(rootPath: string): void {
  new AiVerseDataExtensionInstaller().install({ rootPath });
}

function databasePath(rootPath: string, id: string): string {
  return join(
    rootPath,
    "workspaces",
    id,
    "data",
    "ai-verse-data.sqlite",
  );
}

function assertWorkspaceError(
  error: unknown,
  code: AiVerseWorkspaceError["code"],
): boolean {
  assert.ok(error instanceof AiVerseWorkspaceError);
  assert.equal(error.code, code);
  return true;
}

function registry(rootPath: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      join(rootPath, ".aiverse", "extensions", "registry.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

function writeRegistry(
  rootPath: string,
  document: Record<string, unknown>,
): void {
  writeFileSync(
    join(rootPath, ".aiverse", "extensions", "registry.json"),
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8",
  );
}

function seedBoundDatabase(
  rootPath: string,
  targetWorkspace: string,
  bindingWorkspace: string,
): void {
  const location = databasePath(rootPath, targetWorkspace);
  mkdirSync(join(rootPath, "workspaces", targetWorkspace, "data"), {
    recursive: true,
  });
  const driver = new SqliteStorageDriver();
  const database = driver.open({
    location,
    expectedBinding: {
      bindingVersion: AI_VERSE_DATA_SCOPE_BINDING_VERSION,
      kind: "workspace",
      workspaceId: bindingWorkspace,
    },
  });
  database.close();
}

test("valid native workspace resolves read-only with exact manifest identity and canonical Data scope", () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "client-a", {
      manifest: [
        'schema_version: "2.4"',
        'id: "client-a"',
        'name: "Client A"',
        'type: "client"',
        'status: "active"',
        "purpose: |",
        "  Deliver the active engagement.",
        "  Preserve workspace isolation.",
        "metadata:",
        "  future: true",
        "",
      ].join("\n"),
    });
    const manifestBefore = readFileSync(
      join(f.rootPath, "workspaces", "client-a", "WORKSPACE.yaml"),
      "utf8",
    );

    const resolved = new AiVerseDataWorkspaceManager().resolve({
      rootPath: f.rootPath,
      workspaceId: "client-a",
    });

    assert.equal(resolved.workspaceId, "client-a");
    assert.equal(resolved.workspaceRelativePath, "workspaces/client-a");
    assert.equal(
      resolved.manifestRelativePath,
      "workspaces/client-a/WORKSPACE.yaml",
    );
    assert.equal(
      resolved.databaseRelativePath,
      "workspaces/client-a/data/ai-verse-data.sqlite",
    );
    assert.deepEqual(resolved.manifest, {
      schemaMajor: 2,
      schemaVersion: "2.4",
      id: "client-a",
      name: "Client A",
      type: "client",
      status: "active",
      purpose:
        "Deliver the active engagement.\nPreserve workspace isolation.",
    });
    assert.deepEqual(resolved.scope.binding, {
      bindingVersion: AI_VERSE_DATA_SCOPE_BINDING_VERSION,
      kind: "workspace",
      workspaceId: "client-a",
    });
    assert.equal(
      readFileSync(
        join(f.rootPath, "workspaces", "client-a", "WORKSPACE.yaml"),
        "utf8",
      ),
      manifestBefore,
    );
    assert.equal(
      existsSync(join(f.rootPath, "workspaces", "client-a", "data")),
      false,
    );
  } finally {
    f.cleanup();
  }
});

test("native workspace IDs must match the exact host slug contract before filesystem lookup", () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    const manager = new AiVerseDataWorkspaceManager();

    for (const id of [
      "../client",
      "Client-A",
      "client_a",
      "client.a",
      "-client",
      "client/name",
      "client\\name",
      "",
    ]) {
      assert.throws(
        () => manager.resolve({ rootPath: f.rootPath, workspaceId: id }),
        (error) => assertWorkspaceError(error, "WORKSPACE_ID_INVALID"),
        id,
      );
    }
  } finally {
    f.cleanup();
  }
});

test("workspace directory and manifest path fail closed for missing, wrong-type, and symlink state", {
  skip: process.platform === "win32",
}, () => {
  const f = fixture();
  const outside = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    const manager = new AiVerseDataWorkspaceManager();

    assert.throws(
      () =>
        manager.resolve({
          rootPath: f.rootPath,
          workspaceId: "missing",
        }),
      (error) => assertWorkspaceError(error, "WORKSPACE_NOT_FOUND"),
    );

    writeFileSync(
      join(f.rootPath, "workspaces", "file-workspace"),
      "not a directory",
      "utf8",
    );
    assert.throws(
      () =>
        manager.resolve({
          rootPath: f.rootPath,
          workspaceId: "file-workspace",
        }),
      (error) => assertWorkspaceError(error, "WORKSPACE_UNSAFE"),
    );

    writeWorkspace(outside.rootPath, "linked");
    symlinkSync(
      join(outside.rootPath, "workspaces", "linked"),
      join(f.rootPath, "workspaces", "linked"),
      "dir",
    );
    assert.throws(
      () =>
        manager.resolve({
          rootPath: f.rootPath,
          workspaceId: "linked",
        }),
      (error) => assertWorkspaceError(error, "WORKSPACE_UNSAFE"),
    );

    mkdirSync(join(f.rootPath, "workspaces", "no-manifest"));
    assert.throws(
      () =>
        manager.resolve({
          rootPath: f.rootPath,
          workspaceId: "no-manifest",
        }),
      (error) =>
        assertWorkspaceError(error, "WORKSPACE_MANIFEST_MISSING"),
    );

    mkdirSync(join(f.rootPath, "workspaces", "linked-manifest"));
    const externalManifest = join(outside.rootPath, "WORKSPACE.yaml");
    writeFileSync(
      externalManifest,
      workspaceManifest("linked-manifest"),
      "utf8",
    );
    symlinkSync(
      externalManifest,
      join(
        f.rootPath,
        "workspaces",
        "linked-manifest",
        "WORKSPACE.yaml",
      ),
      "file",
    );
    assert.throws(
      () =>
        manager.resolve({
          rootPath: f.rootPath,
          workspaceId: "linked-manifest",
        }),
      (error) =>
        assertWorkspaceError(error, "WORKSPACE_MANIFEST_UNSAFE"),
    );
  } finally {
    f.cleanup();
    outside.cleanup();
  }
});

test("workspace manifest identity/schema/required fields/status fail closed without creating Data state", () => {
  const cases: ReadonlyArray<{
    readonly id: string;
    readonly manifest: string;
    readonly code: AiVerseWorkspaceError["code"];
  }> = [
    {
      id: "old-schema",
      manifest: workspaceManifest("old-schema").replace(
        'schema_version: "2.0"',
        'schema_version: "1.0"',
      ),
      code: "WORKSPACE_SCHEMA_UNSUPPORTED",
    },
    {
      id: "numeric-schema",
      manifest: workspaceManifest("numeric-schema").replace(
        'schema_version: "2.0"',
        "schema_version: 2.0",
      ),
      code: "WORKSPACE_MANIFEST_MALFORMED",
    },
    {
      id: "mismatch",
      manifest: workspaceManifest("different-id"),
      code: "WORKSPACE_ID_MISMATCH",
    },
    {
      id: "bad-status",
      manifest: workspaceManifest("bad-status").replace(
        'status: "active"',
        'status: "deleted"',
      ),
      code: "WORKSPACE_STATUS_INVALID",
    },
    {
      id: "missing-name",
      manifest: workspaceManifest("missing-name").replace(
        'name: "Workspace missing-name"\n',
        "",
      ),
      code: "WORKSPACE_MANIFEST_MALFORMED",
    },
    {
      id: "empty-type",
      manifest: workspaceManifest("empty-type").replace(
        'type: "custom"',
        'type: ""',
      ),
      code: "WORKSPACE_MANIFEST_MALFORMED",
    },
    {
      id: "duplicate-id",
      manifest: `${workspaceManifest("duplicate-id")}id: "duplicate-id"\n`,
      code: "WORKSPACE_MANIFEST_MALFORMED",
    },
    {
      id: "non-string-purpose",
      manifest: workspaceManifest("non-string-purpose").replace(
        'purpose: "Native Data workspace"',
        "purpose: true",
      ),
      code: "WORKSPACE_MANIFEST_MALFORMED",
    },
  ];

  for (const item of cases) {
    const f = fixture();
    try {
      writeCompatibleHost(f.rootPath);
      writeWorkspace(f.rootPath, item.id, { manifest: item.manifest });
      assert.throws(
        () =>
          new AiVerseDataWorkspaceManager().resolve({
            rootPath: f.rootPath,
            workspaceId: item.id,
          }),
        (error) => assertWorkspaceError(error, item.code),
        item.id,
      );
      assert.equal(
        existsSync(join(f.rootPath, "workspaces", item.id, "data")),
        false,
      );
    } finally {
      f.cleanup();
    }
  }
});

test("oversized workspace manifest is rejected before parsing", () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "oversized", {
      manifest:
        workspaceManifest("oversized") +
        `metadata_padding: "${"x".repeat(1024 * 1024)}"\n`,
    });

    assert.throws(
      () =>
        new AiVerseDataWorkspaceManager().resolve({
          rootPath: f.rootPath,
          workspaceId: "oversized",
        }),
      (error) =>
        assertWorkspaceError(error, "WORKSPACE_MANIFEST_TOO_LARGE"),
    );
  } finally {
    f.cleanup();
  }
});

test("paused and archived workspaces resolve/discover but cannot receive fresh Data initialization", async () => {
  for (const status of ["paused", "archived"] as const) {
    const f = fixture();
    try {
      writeCompatibleHost(f.rootPath);
      writeWorkspace(f.rootPath, status, { status });
      installData(f.rootPath);
      const manager = new AiVerseDataWorkspaceManager();

      const resolved = manager.resolve({
        rootPath: f.rootPath,
        workspaceId: status,
      });
      assert.equal(resolved.manifest.status, status);

      const discovery = await manager.discover({
        rootPath: f.rootPath,
        workspaceId: status,
      });
      assert.equal(discovery.state, "missing");
      assert.equal(discovery.cleanMissing, true);

      await assert.rejects(
        () =>
          manager.initialize({
            rootPath: f.rootPath,
            workspaceId: status,
          }),
        (error) => assertWorkspaceError(error, "WORKSPACE_INACTIVE"),
      );
      assert.equal(existsSync(databasePath(f.rootPath, status)), false);
    } finally {
      f.cleanup();
    }
  }
});

test("fresh initialization requires a current enabled Task 20 extension installation", async () => {
  const noInstall = fixture();
  const disabled = fixture();
  const outdated = fixture();

  try {
    writeCompatibleHost(noInstall.rootPath);
    writeWorkspace(noInstall.rootPath, "alpha");
    await assert.rejects(
      () =>
        new AiVerseDataWorkspaceManager().initialize({
          rootPath: noInstall.rootPath,
          workspaceId: "alpha",
        }),
      (error) => assertWorkspaceError(error, "EXTENSION_NOT_INSTALLED"),
    );

    writeCompatibleHost(disabled.rootPath);
    writeWorkspace(disabled.rootPath, "alpha");
    installData(disabled.rootPath);
    const disabledRegistry = registry(disabled.rootPath);
    const disabledExtensions =
      disabledRegistry.extensions as Record<string, Record<string, unknown>>;
    disabledExtensions[AI_VERSE_DATA_EXTENSION_ID]!.enabled = false;
    writeRegistry(disabled.rootPath, disabledRegistry);
    await assert.rejects(
      () =>
        new AiVerseDataWorkspaceManager().initialize({
          rootPath: disabled.rootPath,
          workspaceId: "alpha",
        }),
      (error) => assertWorkspaceError(error, "EXTENSION_DISABLED"),
    );

    writeCompatibleHost(outdated.rootPath);
    writeWorkspace(outdated.rootPath, "alpha");
    installData(outdated.rootPath);
    writeFileSync(
      join(
        outdated.rootPath,
        ...AI_VERSE_DATA_EXTENSION_ENGINE_PATH.split("/"),
      ),
      "export const outdated = true;\n",
      "utf8",
    );
    await assert.rejects(
      () =>
        new AiVerseDataWorkspaceManager().initialize({
          rootPath: outdated.rootPath,
          workspaceId: "alpha",
        }),
      (error) =>
        assertWorkspaceError(
          error,
          "EXTENSION_INSTALLATION_INCOMPLETE",
        ),
    );

    for (const root of [
      noInstall.rootPath,
      disabled.rootPath,
      outdated.rootPath,
    ]) {
      assert.equal(existsSync(databasePath(root, "alpha")), false);
    }
  } finally {
    noInstall.cleanup();
    disabled.cleanup();
    outdated.cleanup();
  }
});

test("explicit initialization creates only the requested active workspace database with exact binding", async () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "alpha");
    writeWorkspace(f.rootPath, "beta");
    installData(f.rootPath);

    const manager = new AiVerseDataWorkspaceManager();
    const result = await manager.initialize({
      rootPath: f.rootPath,
      workspaceId: "alpha",
    });

    assert.equal(result.status, "initialized");
    assert.equal(result.discovery.state, "healthy");
    assert.equal(result.discovery.exactBinding, true);
    assert.deepEqual(result.metadata.binding, {
      bindingVersion: AI_VERSE_DATA_SCOPE_BINDING_VERSION,
      kind: "workspace",
      workspaceId: "alpha",
    });
    assert.equal(existsSync(databasePath(f.rootPath, "alpha")), true);
    assert.equal(existsSync(databasePath(f.rootPath, "beta")), false);
    assert.equal(
      lstatSync(databasePath(f.rootPath, "alpha")).isFile(),
      true,
    );

    const alphaDataEntries = readdirSync(
      join(f.rootPath, "workspaces", "alpha", "data"),
    );
    assert.ok(alphaDataEntries.includes("ai-verse-data.sqlite"));
    assert.ok(
      alphaDataEntries.every(
        (entry) => !entry.startsWith(".ai-verse-data-init-"),
      ),
    );
  } finally {
    f.cleanup();
  }
});

test("repeated initialization of exact healthy binding is idempotent and never replaces the canonical database", async () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "alpha");
    installData(f.rootPath);
    const manager = new AiVerseDataWorkspaceManager();

    const first = await manager.initialize({
      rootPath: f.rootPath,
      workspaceId: "alpha",
    });
    const firstStat = statSync(databasePath(f.rootPath, "alpha"));
    const firstCreatedAt = first.metadata.createdAt;

    const second = await manager.initialize({
      rootPath: f.rootPath,
      workspaceId: "alpha",
    });
    const secondStat = statSync(databasePath(f.rootPath, "alpha"));

    assert.equal(second.status, "already_initialized");
    assert.equal(second.discovery.state, "healthy");
    assert.equal(second.discovery.exactBinding, true);
    assert.equal(second.metadata.createdAt, firstCreatedAt);
    if (typeof firstStat.ino === "number" && firstStat.ino !== 0) {
      assert.equal(secondStat.ino, firstStat.ino);
    }
  } finally {
    f.cleanup();
  }
});

test("missing canonical database with SQLite sidecar residue is not treated as safe fresh initialization", async () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "alpha");
    installData(f.rootPath);
    mkdirSync(join(f.rootPath, "workspaces", "alpha", "data"));
    writeFileSync(
      `${databasePath(f.rootPath, "alpha")}-wal`,
      "orphaned",
      "utf8",
    );

    const manager = new AiVerseDataWorkspaceManager();
    const discovery = await manager.discover({
      rootPath: f.rootPath,
      workspaceId: "alpha",
    });
    assert.equal(discovery.state, "residue");
    assert.equal(discovery.cleanMissing, false);
    assert.deepEqual(discovery.auxiliaryResidue, [
      "workspaces/alpha/data/ai-verse-data.sqlite-wal",
    ]);

    await assert.rejects(
      () =>
        manager.initialize({
          rootPath: f.rootPath,
          workspaceId: "alpha",
        }),
      (error) =>
        assertWorkspaceError(error, "DATABASE_RESIDUE_PRESENT"),
    );
    assert.equal(existsSync(databasePath(f.rootPath, "alpha")), false);
  } finally {
    f.cleanup();
  }
});

test("existing unbound Data database is discovered as unbound and is never silently adopted", async () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "alpha");
    installData(f.rootPath);
    mkdirSync(join(f.rootPath, "workspaces", "alpha", "data"));

    const driver = new SqliteStorageDriver();
    const raw = driver.open({
      location: databasePath(f.rootPath, "alpha"),
    });
    assert.equal(raw.metadata().binding, null);
    raw.close();

    const manager = new AiVerseDataWorkspaceManager(driver);
    const discovery = await manager.discover({
      rootPath: f.rootPath,
      workspaceId: "alpha",
    });
    assert.equal(discovery.state, "unbound");
    assert.equal(discovery.exactBinding, false);

    await assert.rejects(
      () =>
        manager.initialize({
          rootPath: f.rootPath,
          workspaceId: "alpha",
        }),
      (error) =>
        assertWorkspaceError(error, "DATABASE_NOT_INITIALIZABLE"),
    );

    const inspected = driver.inspectMigration({
      location: databasePath(f.rootPath, "alpha"),
    });
    assert.equal(inspected.binding, null);
  } finally {
    f.cleanup();
  }
});

test("native discovery preserves distinct existing database failure states", async () => {
  const cases: ReadonlyArray<{
    readonly id: string;
    readonly expected:
      | "scope_conflict"
      | "migration_required"
      | "migration_incomplete"
      | "unsupported"
      | "quarantined"
      | "unavailable";
    readonly prepare: (rootPath: string) => void;
  }> = [
    {
      id: "scope-conflict",
      expected: "scope_conflict",
      prepare(rootPath) {
        seedBoundDatabase(rootPath, "scope-conflict", "other");
      },
    },
    {
      id: "migration-required",
      expected: "migration_required",
      prepare(rootPath) {
        seedBoundDatabase(
          rootPath,
          "migration-required",
          "migration-required",
        );
        const raw = new Database(
          databasePath(rootPath, "migration-required"),
        );
        try {
          raw
            .prepare(
              "UPDATE _aiverse_meta SET value = '1' WHERE key = 'format_version'",
            )
            .run();
          raw
            .prepare(
              "DELETE FROM _aiverse_meta WHERE key = 'migration_framework_version'",
            )
            .run();
          raw.pragma("user_version = 1");
        } finally {
          raw.close();
        }
      },
    },
    {
      id: "migration-incomplete",
      expected: "migration_incomplete",
      prepare(rootPath) {
        seedBoundDatabase(
          rootPath,
          "migration-incomplete",
          "migration-incomplete",
        );
        const raw = new Database(
          databasePath(rootPath, "migration-incomplete"),
        );
        try {
          raw
            .prepare(
              `INSERT INTO _schema_migrations (
                 migration_id,
                 definition_digest,
                 from_version,
                 to_version,
                 state,
                 attempt,
                 backup_artifact_id,
                 backup_payload_sha256,
                 backup_manifest_sha256,
                 started_at,
                 completed_at,
                 failed_at,
                 failure_message
               ) VALUES (?, ?, 1, 2, 'in_progress', 1, ?, ?, ?, ?, NULL, NULL, NULL)`,
            )
            .run(
              MIGRATION_ID,
              MIGRATION_DIGEST,
              "native_incomplete",
              "a".repeat(64),
              "b".repeat(64),
              new Date().toISOString(),
            );
        } finally {
          raw.close();
        }
      },
    },
    {
      id: "unsupported",
      expected: "unsupported",
      prepare(rootPath) {
        seedBoundDatabase(rootPath, "unsupported", "unsupported");
        const raw = new Database(databasePath(rootPath, "unsupported"));
        try {
          raw
            .prepare(
              "UPDATE _aiverse_meta SET value = '999' WHERE key = 'format_version'",
            )
            .run();
          raw.pragma("user_version = 999");
        } finally {
          raw.close();
        }
      },
    },
    {
      id: "quarantined",
      expected: "quarantined",
      prepare(rootPath) {
        mkdirSync(join(rootPath, "workspaces", "quarantined", "data"));
        writeFileSync(
          databasePath(rootPath, "quarantined"),
          "not-sqlite",
          "utf8",
        );
      },
    },
    {
      id: "unavailable",
      expected: "unavailable",
      prepare(rootPath) {
        mkdirSync(
          databasePath(rootPath, "unavailable"),
          { recursive: true },
        );
      },
    },
  ];

  for (const item of cases) {
    const f = fixture();
    try {
      writeCompatibleHost(f.rootPath);
      writeWorkspace(f.rootPath, item.id);
      item.prepare(f.rootPath);
      const manager = new AiVerseDataWorkspaceManager();

      const discovery = await manager.discover({
        rootPath: f.rootPath,
        workspaceId: item.id,
      });
      assert.equal(discovery.state, item.expected, item.id);

      installData(f.rootPath);
      await assert.rejects(
        () =>
          manager.initialize({
            rootPath: f.rootPath,
            workspaceId: item.id,
          }),
        (error) =>
          assertWorkspaceError(error, "DATABASE_NOT_INITIALIZABLE"),
        item.id,
      );
    } finally {
      f.cleanup();
    }
  }
});

test("database data-directory and canonical leaf symlinks are rejected before discovery or initialization", {
  skip: process.platform === "win32",
}, async () => {
  const external = fixture();
  const dataLink = fixture();
  const databaseLink = fixture();

  try {
    writeCompatibleHost(dataLink.rootPath);
    writeWorkspace(dataLink.rootPath, "alpha");
    installData(dataLink.rootPath);
    symlinkSync(
      external.rootPath,
      join(dataLink.rootPath, "workspaces", "alpha", "data"),
      "dir",
    );
    assert.throws(
      () =>
        new AiVerseDataWorkspaceManager().resolve({
          rootPath: dataLink.rootPath,
          workspaceId: "alpha",
        }),
      (error) =>
        assertWorkspaceError(error, "DATABASE_PATH_UNSAFE"),
    );

    writeCompatibleHost(databaseLink.rootPath);
    writeWorkspace(databaseLink.rootPath, "alpha");
    installData(databaseLink.rootPath);
    mkdirSync(
      join(databaseLink.rootPath, "workspaces", "alpha", "data"),
    );
    const externalDb = join(external.rootPath, "external.sqlite");
    writeFileSync(externalDb, "external", "utf8");
    symlinkSync(
      externalDb,
      databasePath(databaseLink.rootPath, "alpha"),
      "file",
    );
    assert.throws(
      () =>
        new AiVerseDataWorkspaceManager().resolve({
          rootPath: databaseLink.rootPath,
          workspaceId: "alpha",
        }),
      (error) =>
        assertWorkspaceError(error, "DATABASE_PATH_UNSAFE"),
    );
    assert.equal(readFileSync(externalDb, "utf8"), "external");
  } finally {
    external.cleanup();
    dataLink.cleanup();
    databaseLink.cleanup();
  }
});

test("Task 21 initialization does not modify Task 20 extension-owned files or registry state", async () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "alpha");
    installData(f.rootPath);

    const preservedPaths = [
      join(f.rootPath, ".aiverse", "extensions", "registry.json"),
      join(
        f.rootPath,
        ...AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH.split("/"),
      ),
      join(
        f.rootPath,
        ...AI_VERSE_DATA_EXTENSION_ENGINE_PATH.split("/"),
      ),
      join(
        f.rootPath,
        ...AI_VERSE_DATA_EXTENSION_MANIFEST_PATH.split("/"),
      ),
    ];
    const before = preservedPaths.map((path) =>
      readFileSync(path, "utf8"),
    );

    await new AiVerseDataWorkspaceManager().initialize({
      rootPath: f.rootPath,
      workspaceId: "alpha",
    });

    const after = preservedPaths.map((path) =>
      readFileSync(path, "utf8"),
    );
    assert.deepEqual(after, before);
  } finally {
    f.cleanup();
  }
});
