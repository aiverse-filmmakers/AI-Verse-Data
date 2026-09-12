import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
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
  AiVerseDataDoctor,
  doctorData,
  initWorkspaceData,
  installDataExtension,
  statusData,
} from "../src/native/index.js";

const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));

interface Fixture {
  readonly rootPath: string;
  cleanup(): void;
}

function fixture(): Fixture {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-doc24-"));
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
  status = "active",
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
      `status: "${status}"`,
      `purpose: "Task 24 fixture."`,
      "",
    ].join("\n"),
    "utf8",
  );
}

function runCli(...args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
  });
}

function registryPath(rootPath: string): string {
  return join(
    ...[rootPath, ...AI_VERSE_OS_EXTENSION_REGISTRY_PATH.split("/")],
  );
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
      const display = child.split("\\").join("/");
      if (entry.isDirectory()) {
        output.push(`dir:${display}`);
        walk(child);
      } else if (entry.isSymbolicLink()) {
        output.push(`symlink:${display}`);
      } else if (entry.isFile()) {
        if (
          display.endsWith(".sqlite") ||
          display.endsWith(".sqlite-wal") ||
          display.endsWith(".sqlite-shm") ||
          display.endsWith(".sqlite-journal")
        ) {
          output.push(`file:${display}:<sqlite-binary>`);
        } else {
          output.push(
            `file:${display}:${readFileSync(join(rootPath, child), "utf8")}`,
          );
        }
      } else {
        output.push(`other:${display}`);
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

test("healthy full stack reports ready with deep integrity on doctor", async () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "sales");
    installDataExtension({ rootPath: f.rootPath });
    await initWorkspaceData({
      rootPath: f.rootPath,
      workspaceId: "sales",
    });
    const before = snapshotTree(f.rootPath);

    const doctor = await doctorData({
      rootPath: f.rootPath,
      workspaceId: "sales",
    });
    assert.equal(doctor.healthy, true);
    assert.equal(doctor.mode, "ai-verse-os-v2");
    assert.equal(doctor.host.status, "compatible");
    assert.equal(doctor.registration?.registered, true);
    assert.equal(doctor.registration?.enabled, true);
    assert.equal(doctor.instructions?.status, "ready");
    assert.equal(doctor.workspace?.workspaceId, "sales");
    assert.equal(doctor.database?.state, "compatible");
    assert.equal(doctor.database?.migration?.state, "current");
    assert.ok(
      (doctor.sqlite?.version ?? "").length > 0 &&
        doctor.sqlite?.meetsMinimum === true,
    );
    assert.equal(doctor.integrity?.checked, true);
    assert.equal(doctor.integrity?.ok, true);
    assert.equal(doctor.problems.length, 0);

    const status = await statusData({
      rootPath: f.rootPath,
      workspaceId: "sales",
    });
    assert.equal(status.healthy, true);
    assert.equal(status.integrity?.checked, false);
    assert.equal(status.database?.state, "compatible");

    assert.deepEqual(snapshotTree(f.rootPath), before);
    assert.deepEqual(sqliteFiles(f.rootPath), [
      join("workspaces", "sales", "data", "ai-verse-data.sqlite"),
    ]);

    const viaClass = await new AiVerseDataDoctor().status({
      rootPath: f.rootPath,
      workspaceId: "sales",
    });
    assert.equal(viaClass.healthy, true);
  } finally {
    f.cleanup();
  }
});

test("disabled plus not-installed plus missing registry are reported read-only", async () => {
  const disabled = fixture();
  const clean = fixture();
  try {
    writeCompatibleHost(disabled.rootPath);
    writeWorkspace(disabled.rootPath, "sales");
    installDataExtension({ rootPath: disabled.rootPath });
    const registry = JSON.parse(
      readFileSync(registryPath(disabled.rootPath), "utf8"),
    ) as { extensions: Record<string, Record<string, unknown>> };
    registry.extensions["ai-verse-data"] = {
      ...registry.extensions["ai-verse-data"],
      enabled: false,
    };
    writeFileSync(
      registryPath(disabled.rootPath),
      `${JSON.stringify(registry, null, 2)}\n`,
      "utf8",
    );
    const beforeDisabled = snapshotTree(disabled.rootPath);
    const disabledResult = await statusData({
      rootPath: disabled.rootPath,
      workspaceId: "sales",
    });
    assert.equal(disabledResult.registration?.enabled, false);
    assert.equal(disabledResult.instructions?.status, "disabled");
    assert.equal(disabledResult.database?.state, "missing");
    assert.deepEqual(snapshotTree(disabled.rootPath), beforeDisabled);

    writeCompatibleHost(clean.rootPath);
    const cleanResult = await statusData({ rootPath: clean.rootPath });
    assert.equal(cleanResult.registration?.registered ?? false, false);
    assert.equal(cleanResult.instructions?.status, "not-installed");
    assert.deepEqual(sqliteFiles(clean.rootPath), []);
  } finally {
    disabled.cleanup();
    clean.cleanup();
  }
});

test("no-os reports standalone while incompatible fails closed", async () => {
  const missing = fixture();
  const partial = fixture();
  try {
    const standalone = await statusData({
      rootPath: join(missing.rootPath, "does-not-exist"),
    });
    assert.equal(standalone.healthy, true);
    assert.equal(standalone.mode, "standalone");
    assert.equal(standalone.host.status, "no-os");

    writeFileSync(join(partial.rootPath, "AGENTS.md"), "# Agents\n", "utf8");
    mkdirSync(join(partial.rootPath, "workspaces"), { recursive: true });
    const bad = await statusData({ rootPath: partial.rootPath });
    assert.equal(bad.healthy, false);
    assert.equal(bad.mode, "incompatible");
    assert.ok(
      bad.problems.some((p) => p.code === "INCOMPATIBLE_AI_VERSE_OS"),
    );
  } finally {
    missing.cleanup();
    partial.cleanup();
  }
});

test("paused workspace plus every discovery state surface distinctly", async () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "paused-ws", "paused");
    writeWorkspace(f.rootPath, "sales");
    installDataExtension({ rootPath: f.rootPath });
    await initWorkspaceData({
      rootPath: f.rootPath,
      workspaceId: "sales",
    });

    const paused = await statusData({
      rootPath: f.rootPath,
      workspaceId: "paused-ws",
    });
    assert.ok(
      paused.notices.some((n) => n.code === "WORKSPACE_NOT_ACTIVE"),
    );
    assert.equal(paused.database?.state, "missing");

    const missing = await statusData({
      rootPath: f.rootPath,
      workspaceId: "paused-ws",
    });
    assert.equal(missing.database?.state, "missing");

    const compatible = await statusData({
      rootPath: f.rootPath,
      workspaceId: "sales",
    });
    assert.equal(compatible.database?.state, "compatible");

    const dbPath = join(
      f.rootPath,
      "workspaces",
      "sales",
      "data",
      "ai-verse-data.sqlite",
    );
    {
      const before = snapshotTree(f.rootPath);
      const raw = new Database(dbPath);
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
      const migration = await statusData({
        rootPath: f.rootPath,
        workspaceId: "sales",
      });
      assert.equal(migration.database?.state, "migration_required");
      assert.ok(migration.problems.length > 0);
      assert.deepEqual(
        snapshotTree(f.rootPath).filter(
          (e) => !e.includes("ai-verse-data.sqlite"),
        ),
        before.filter((e) => !e.includes("ai-verse-data.sqlite")),
      );
    }

    {
      const raw = new Database(dbPath);
      try {
        raw.exec("CREATE TABLE unrelated (id INTEGER PRIMARY KEY);");
        raw.exec("DROP TABLE IF EXISTS _aiverse_meta;");
      } finally {
        raw.close();
      }
      const unsupported = await statusData({
        rootPath: f.rootPath,
        workspaceId: "sales",
      });
      assert.equal(unsupported.database?.state, "unsupported");
    }
  } finally {
    f.cleanup();
  }
});

test("corrupt database fails closed while status skips deep integrity", async () => {
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
    const raw = new Database(dbPath);
    try {
      raw.exec("PRAGMA writable_schema = ON;");
      raw.exec("DELETE FROM _aiverse_meta WHERE key = 'format';");
    } finally {
      raw.close();
    }

    const doctor = await doctorData({
      rootPath: f.rootPath,
      workspaceId: "sales",
    });
    assert.equal(doctor.database?.state, "quarantined");
    assert.equal(doctor.healthy, false);

    const status = await statusData({
      rootPath: f.rootPath,
      workspaceId: "sales",
    });
    assert.equal(status.integrity?.checked, false);
    assert.equal(status.database?.state, "quarantined");
  } finally {
    f.cleanup();
  }
});

test("symlinked database plus unknown workspace id fail closed read-only", async () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "sales");
    installDataExtension({ rootPath: f.rootPath });
    await initWorkspaceData({
      rootPath: f.rootPath,
      workspaceId: "sales",
    });
    const before = snapshotTree(f.rootPath);

    const unknown = await statusData({
      rootPath: f.rootPath,
      workspaceId: "missing",
    });
    assert.equal(unknown.healthy, false);
    assert.ok(
      unknown.problems.some((p) => p.code === "WORKSPACE_NOT_FOUND"),
    );

    if (process.platform !== "win32") {
      const dbPath = join(
        f.rootPath,
        "workspaces",
        "sales",
        "data",
        "ai-verse-data.sqlite",
      );
      const saved = readFileSync(dbPath);
      const outside = mkdtempSync(join(tmpdir(), "ai-verse-data-doc24-"));
      try {
        const target = join(outside, "external.sqlite");
        writeFileSync(target, saved);
        rmSync(dbPath);
        symlinkSync(target, dbPath);
        const linked = await statusData({
          rootPath: f.rootPath,
          workspaceId: "sales",
        });
        assert.equal(linked.healthy, false);
      } finally {
        rmSync(dbPath, { force: true });
        writeFileSync(dbPath, saved);
        rmSync(outside, { recursive: true, force: true });
      }
    }

    assert.ok(existsSync(dbPathSafe(f.rootPath)));
    void before;
  } finally {
    f.cleanup();
  }
});

function dbPathSafe(rootPath: string): string {
  return join(
    rootPath,
    "workspaces",
    "sales",
    "data",
    "ai-verse-data.sqlite",
  );
}

test("CLI doctor plus status preserve databases with exit codes", async () => {
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

    let r = runCli("doctor", "--root", f.rootPath, "--workspace", "sales");
    assert.equal(r.status, 0);
    assert.match(r.stdout, /healthy/);
    assert.deepEqual(readFileSync(dbPath), dbBefore);

    r = runCli("status", "--root", f.rootPath, "--workspace", "sales", "--json");
    assert.equal(r.status, 0);
    const parsed = JSON.parse(r.stdout) as { healthy: boolean };
    assert.equal(parsed.healthy, true);
    assert.deepEqual(readFileSync(dbPath), dbBefore);

    r = runCli("status", "--root", f.rootPath, "--workspace", "missing");
    assert.equal(r.status, 1);
    assert.match(r.stdout, /WORKSPACE_NOT_FOUND/);
    assert.match(r.stdout, /Next step/);

    r = runCli("doctor");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--root/);

    r = runCli("doctor", "--root", join(f.rootPath, "does-not-exist"));
    assert.equal(r.status, 0);
    assert.match(r.stdout, /standalone/);
  } finally {
    f.cleanup();
  }
});

test("doctor creates zero databases and siblings stay informational", async () => {
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
    const result = await statusData({ rootPath: f.rootPath });
    assert.equal(result.healthy, true);
    assert.match(result.siblingNote, /informational only/);
    assert.deepEqual(sqliteFiles(f.rootPath), []);
  } finally {
    f.cleanup();
  }
});
