import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
  AiVerseDataDoctor,
  disableDataExtension,
  discoverExtensionInstructions,
  doctorData,
  initWorkspaceData,
  installDataExtension,
  statusData,
  uninstallDataExtension,
  updateDataExtension,
} from "../src/native/index.js";

interface Fixture {
  readonly rootPath: string;
  cleanup(): void;
}

function fixture(): Fixture {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-coex25-"));
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

function writeWorkspace(rootPath: string, workspaceId: string): void {
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
      `purpose: "Task 25 coexistence fixture."`,
      "",
    ].join("\n"),
    "utf8",
  );
}

function registryPath(rootPath: string): string {
  return join(
    ...[rootPath, ...AI_VERSE_OS_EXTENSION_REGISTRY_PATH.split("/")],
  );
}

function writeSiblingRegistry(
  rootPath: string,
  siblings: Record<string, Record<string, unknown>>,
  topExtra: Record<string, unknown> = {},
): void {
  mkdirSync(join(rootPath, ".aiverse", "extensions"), {
    recursive: true,
  });
  writeFileSync(
    registryPath(rootPath),
    `${JSON.stringify(
      {
        schema_version: "1.0",
        custom_top_level: "preserve-me",
        ...topExtra,
        extensions: { ...siblings },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function readRegistry(rootPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(registryPath(rootPath), "utf8")) as Record<
    string,
    unknown
  >;
}

function siblingEntry(
  id: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    supported: true,
    installed: true,
    enabled: true,
    version: "9.9.9-sibling",
    source: `${id}-project`,
    instructions: `.aiverse/extensions/${id}/INSTRUCTIONS.md`,
    engine: `.aiverse/extensions/${id}/engine.mjs`,
    adapters: [],
    custom_sibling_field: `custom-${id}`,
    nested: { keep: true, list: [1, 2, 3] },
    ...extra,
  };
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

function siblingBytes(
  rootPath: string,
  ids: readonly string[],
): Record<string, string> {
  const registry = readRegistry(rootPath) as {
    extensions: Record<string, unknown>;
  };
  const out: Record<string, string> = {};
  for (const id of ids) {
    out[id] = JSON.stringify(registry.extensions[id]);
  }
  return out;
}

async function fullLifecycleWithChecks(
  rootPath: string,
  siblingIds: readonly string[],
): Promise<void> {
  const topBefore = (readRegistry(rootPath) as { custom_top_level: string })
    .custom_top_level;
  const sibBefore = siblingBytes(rootPath, siblingIds);

  const installed = installDataExtension({ rootPath });
  assert.equal(installed.status, "installed");
  assert.deepEqual(sqliteFiles(rootPath), []);
  assert.equal(
    (readRegistry(rootPath) as { custom_top_level: string })
      .custom_top_level,
    topBefore,
  );
  assert.deepEqual(siblingBytes(rootPath, siblingIds), sibBefore);

  const healthy = await statusData({ rootPath });
  assert.equal(healthy.healthy, true);

  const updated = updateDataExtension({ rootPath });
  assert.ok(updated.status === "updated" || updated.status === "unchanged");
  assert.deepEqual(siblingBytes(rootPath, siblingIds), sibBefore);

  const discovered = discoverExtensionInstructions({ rootPath });
  assert.equal(discovered.status, "ready");
  assert.deepEqual(siblingBytes(rootPath, siblingIds), sibBefore);

  const disabled = disableDataExtension({ rootPath });
  assert.equal(disabled.status, "disabled");
  assert.equal(disabled.enabled, false);
  assert.deepEqual(siblingBytes(rootPath, siblingIds), sibBefore);

  const docDisabled = new AiVerseDataDoctor();
  const disabledReport = await docDisabled.status({ rootPath });
  assert.equal(disabledReport.registration?.enabled, false);

  const uninstalled = uninstallDataExtension({ rootPath });
  assert.equal(uninstalled.status, "uninstalled");
  const afterUninstall = readRegistry(rootPath) as {
    custom_top_level: string;
    extensions: Record<string, unknown>;
  };
  assert.equal(afterUninstall.custom_top_level, topBefore);
  for (const id of siblingIds) {
    assert.ok(id in afterUninstall.extensions, id);
  }
  assert.ok(!("ai-verse-data" in afterUninstall.extensions));
  assert.deepEqual(siblingBytes(rootPath, siblingIds), sibBefore);

  const reinstalled = installDataExtension({ rootPath });
  assert.equal(reinstalled.status, "installed");
  assert.deepEqual(siblingBytes(rootPath, siblingIds), sibBefore);

  const final = await doctorData({ rootPath });
  assert.equal(final.registration?.registered, true);
}

const ORDERS: ReadonlyArray<{
  readonly name: string;
  readonly siblings: Record<string, Record<string, unknown>>;
}> = [
  { name: "OS->Data", siblings: {} },
  { name: "OS->Memory->Data", siblings: { memory: siblingEntry("memory") } },
  { name: "OS->Data->Memory", siblings: { memory: siblingEntry("memory") } },
  { name: "OS->Brain->Data", siblings: { brain: siblingEntry("brain") } },
  { name: "OS->Data->Brain", siblings: { brain: siblingEntry("brain") } },
  {
    name: "OS->Bots->Data",
    siblings: { "multiple-bots": siblingEntry("multiple-bots") },
  },
  {
    name: "OS->Data->Bots",
    siblings: { "multiple-bots": siblingEntry("multiple-bots") },
  },
  { name: "OS->Skills->Data", siblings: { skills: siblingEntry("skills") } },
  { name: "OS->Data->Skills", siblings: { skills: siblingEntry("skills") } },
  {
    name: "OS->Memory+enabled-false",
    siblings: {
      memory: siblingEntry("memory", { enabled: false }),
    },
  },
  {
    name: "unrelated-custom-metadata",
    siblings: {
      "unrelated-extension": siblingEntry("unrelated-extension", {
        weird: { deeply: { nested: [true, null, "x"] } },
        enabled: false,
      }),
    },
  },
  {
    name: "full-order",
    siblings: {
      memory: siblingEntry("memory"),
      brain: siblingEntry("brain"),
      "multiple-bots": siblingEntry("multiple-bots"),
      skills: siblingEntry("skills"),
      "unrelated-extension": siblingEntry("unrelated-extension"),
    },
  },
];

for (const order of ORDERS) {
  test(`coexistence order ${order.name} preserves siblings across lifecycle`, async () => {
    const f = fixture();
    try {
      writeCompatibleHost(f.rootPath);
      writeWorkspace(f.rootPath, "sales");
      writeSiblingRegistry(f.rootPath, order.siblings);
      const ids = Object.keys(order.siblings);
      await fullLifecycleWithChecks(f.rootPath, ids);
    } finally {
      f.cleanup();
    }
  });
}

test("seeded database bytes survive lifecycle plus reinstall in every order", async () => {
  for (const order of ORDERS.slice(0, 4)) {
    const f = fixture();
    try {
      writeCompatibleHost(f.rootPath);
      writeWorkspace(f.rootPath, "sales");
      writeSiblingRegistry(f.rootPath, order.siblings);
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
      assert.ok(existsSync(dbPath));
      const seeded = readFileSync(dbPath);

      updateDataExtension({ rootPath: f.rootPath });
      disableDataExtension({ rootPath: f.rootPath });
      assert.deepEqual(readFileSync(dbPath), seeded);
      uninstallDataExtension({ rootPath: f.rootPath });
      assert.deepEqual(readFileSync(dbPath), seeded);

      installDataExtension({ rootPath: f.rootPath });
      const report = await statusData({
        rootPath: f.rootPath,
        workspaceId: "sales",
      });
      assert.equal(report.database?.state, "compatible");
      assert.deepEqual(readFileSync(dbPath), seeded);
    } finally {
      f.cleanup();
    }
  }
});

test("registry busy plus lost-update plus unsafe paths fail closed with siblings present", async () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeSiblingRegistry(f.rootPath, {
      memory: siblingEntry("memory"),
    });
    installDataExtension({ rootPath: f.rootPath });
    const before = snapshotTree(f.rootPath).filter(
      (e) => !e.includes("registry.json.lock"),
    );

    const lockPath = join(
      f.rootPath,
      ".aiverse",
      "extensions",
      "registry.json.lock",
    );
    writeFileSync(lockPath, "busy", "utf8");
    try {
      assert.throws(
        () => updateDataExtension({ rootPath: f.rootPath }),
        (error: unknown) =>
          error instanceof Error && /busy|locked/i.test(error.message),
      );
    } finally {
      rmSync(lockPath, { force: true });
    }

    const siblings = siblingBytes(f.rootPath, ["memory"]);
    assert.deepEqual(siblingBytes(f.rootPath, ["memory"]), siblings);
    assert.deepEqual(
      snapshotTree(f.rootPath).filter(
        (e) => !e.includes("registry.json.lock"),
      ),
      before,
    );
    assert.deepEqual(sqliteFiles(f.rootPath), []);
  } finally {
    f.cleanup();
  }
});

test("no tracked OS mutation across coexistence lifecycle", () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "sales");
    writeSiblingRegistry(f.rootPath, {
      memory: siblingEntry("memory"),
      brain: siblingEntry("brain"),
    });
    const trackedBefore: Record<string, string> = {
      "AI-VERSE.yaml": readFileSync(join(f.rootPath, "AI-VERSE.yaml"), "utf8"),
      "AGENTS.md": readFileSync(join(f.rootPath, "AGENTS.md"), "utf8"),
      "system/extensions/README.md": readFileSync(
        join(f.rootPath, "system", "extensions", "README.md"),
        "utf8",
      ),
      "workspaces/sales/WORKSPACE.yaml": readFileSync(
        join(f.rootPath, "workspaces", "sales", "WORKSPACE.yaml"),
        "utf8",
      ),
    };

    installDataExtension({ rootPath: f.rootPath });
    updateDataExtension({ rootPath: f.rootPath });
    disableDataExtension({ rootPath: f.rootPath });
    uninstallDataExtension({ rootPath: f.rootPath });
    installDataExtension({ rootPath: f.rootPath });

    for (const [rel, contents] of Object.entries(trackedBefore)) {
      assert.equal(readFileSync(join(f.rootPath, rel), "utf8"), contents, rel);
    }
  } finally {
    f.cleanup();
  }
});
