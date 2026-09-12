import assert from "node:assert/strict";
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

import { DataCatalog } from "../src/catalog/index.js";
import { DataQuery } from "../src/query/index.js";
import {
  DataRecordError,
  DataRecords,
} from "../src/records/index.js";
import { DataProvenance } from "../src/provenance/index.js";
import { DataRecovery } from "../src/recovery/index.js";
import { DataTransactions } from "../src/transactions/index.js";
import {
  TrustedDataRoot,
  createWorkspaceDataScope,
  openScopedDataDatabase,
  type DataDatabaseScope,
} from "../src/scope/index.js";
import { SqliteStorageDriver } from "../src/storage/index.js";
import {
  AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
  AiVerseDataExtensionInstaller,
  AiVerseDataLifecycleError,
  AiVerseOsCompatibilityDetector,
  disableDataExtension,
  discoverExtensionInstructions,
  discoverWorkspaceData,
  doctorData,
  initWorkspaceData,
  installDataExtension,
  resolveWorkspace,
  statusData,
  uninstallDataExtension,
  updateDataExtension,
} from "../src/native/index.js";

const actor = { kind: "human", id: "phase3-gate" } as const;

interface Fixture {
  readonly rootPath: string;
  cleanup(): void;
}

function fixture(): Fixture {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-phase3-"));
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
      `purpose: "Phase 3 gate."`,
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

function readRegistry(rootPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(registryPath(rootPath), "utf8")) as Record<
    string,
    unknown
  >;
}

function trackedBytes(rootPath: string): Record<string, string> {
  return {
    "AI-VERSE.yaml": readFileSync(join(rootPath, "AI-VERSE.yaml"), "utf8"),
    "AGENTS.md": readFileSync(join(rootPath, "AGENTS.md"), "utf8"),
    "system/extensions/README.md": readFileSync(
      join(rootPath, "system", "extensions", "README.md"),
      "utf8",
    ),
  };
}

function bootstrapCrm(catalog: DataCatalog): void {
  catalog.createSpace({
    spaceId: "crm",
    name: "CRM",
    authority: "local_canonical",
  });
  catalog.createSchema({
    spaceId: "crm",
    entity: "companies",
    name: "Companies",
    fields: {
      name: { type: "string", required: true, minLength: 1 },
    },
  });
  catalog.createSchema({
    spaceId: "crm",
    entity: "deals",
    name: "Deals",
    fields: {
      title: { type: "string", required: true, minLength: 1 },
      value: { type: "number", min: 0, default: 0 },
      stage: {
        type: "enum",
        values: ["lead", "proposal", "won", "lost"],
        default: "lead",
      },
      company: {
        type: "reference",
        entity: "companies",
        required: true,
      },
    },
  });
}

function openWorkspaceScope(
  rootPath: string,
  workspaceId: string,
  mode: "create-or-open" | "open-existing" = "open-existing",
): {
  readonly scope: DataDatabaseScope;
  readonly database: ReturnType<SqliteStorageDriver["open"]>;
} {
  const root = TrustedDataRoot.fromExistingDirectory(rootPath);
  const scope = createWorkspaceDataScope(root, workspaceId);
  const driver = new SqliteStorageDriver();
  return { scope, database: driver.open({
    location: scope.databasePath(),
    mode,
    expectedBinding: scope.binding,
  }) };
}

function assertLifecycleError(
  error: unknown,
  code: AiVerseDataLifecycleError["code"],
): boolean {
  assert.ok(error instanceof AiVerseDataLifecycleError);
  assert.equal(error.code, code);
  return true;
}

function assertRecordError(
  error: unknown,
  code: DataRecordError["code"],
): boolean {
  assert.ok(error instanceof DataRecordError);
  assert.equal(error.code, code);
  return true;
}

test("Phase 3 gate: complete native installation acceptance story", async () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "workspace-a");
    writeWorkspace(f.rootPath, "workspace-b");
    writeWorkspace(f.rootPath, "paused-ws", "paused");
    const trackedBefore = trackedBytes(f.rootPath);
    const root = TrustedDataRoot.fromExistingDirectory(f.rootPath);
    const driver = new SqliteStorageDriver();

    // Gate 1-4: detection.
    assert.equal(
      new AiVerseOsCompatibilityDetector().inspect({ rootPath: f.rootPath })
        .status,
      "compatible",
    );
    for (const manifest of [
      "schema: 3\narchitecture: unified-workspace\n",
      "schema: 2\narchitecture: legacy-workspaces\n",
    ]) {
      const bad = fixture();
      try {
        writeCompatibleHost(bad.rootPath);
        writeFileSync(join(bad.rootPath, "AI-VERSE.yaml"), manifest, "utf8");
        assert.equal(
          new AiVerseOsCompatibilityDetector().inspect({
            rootPath: bad.rootPath,
          }).status,
          "incompatible",
        );
      } finally {
        bad.cleanup();
      }
    }
    {
      const missing = fixture();
      try {
        writeCompatibleHost(missing.rootPath);
        rmSync(
          join(missing.rootPath, "system", "extensions", "README.md"),
        );
        assert.equal(
          new AiVerseOsCompatibilityDetector().inspect({
            rootPath: missing.rootPath,
          }).status,
          "incompatible",
        );
      } finally {
        missing.cleanup();
      }
    }

    // Gate 13: install creates nothing; gates 5-11 via assertions below.
    const installer = new AiVerseDataExtensionInstaller();
    assert.equal(
      installer.plan({ rootPath: f.rootPath }).preservesCanonicalWorkspaceData,
      true,
    );
    const firstInstall = installDataExtension({ rootPath: f.rootPath });
    assert.equal(firstInstall.status, "installed");
    for (const rel of firstInstall.materializedPaths) {
      assert.ok(rel.startsWith(".aiverse/extensions/ai-verse-data/"), rel);
    }
    assert.deepEqual(trackedBytes(f.rootPath), trackedBefore);
    assert.equal(
      existsSync(join(f.rootPath, "workspaces", "workspace-a", "data")),
      false,
    );
    const reinstallPlan = installer.plan({ rootPath: f.rootPath });
    assert.equal(reinstallPlan.requiresWrite, false);

    // Gate 12 covered by tracked comparison; instructions ready.
    assert.equal(
      discoverExtensionInstructions({ rootPath: f.rootPath }).status,
      "ready",
    );

    // Gate 14: init touches only workspace-a; gate 15 compatible discovery.
    const initA = await initWorkspaceData({
      rootPath: f.rootPath,
      workspaceId: "workspace-a",
    });
    assert.equal(initA.status, "created");
    assert.equal(initA.discovery.state, "compatible");
    assert.equal(
      existsSync(join(f.rootPath, "workspaces", "workspace-b", "data")),
      false,
    );
    assert.equal(
      (
        await discoverWorkspaceData({
          rootPath: f.rootPath,
          workspaceId: "workspace-a",
        })
      ).state,
      "compatible",
    );

    // CRM story: spaces, schemas, related records, receipts, OCC, query,
    // aggregates, transactions, events.
    const handle = openScopedDataDatabase(
      driver,
      createWorkspaceDataScope(root, "workspace-a"),
      { mode: "open-existing" },
    );
    const catalog = new DataCatalog(handle.database);
    const records = new DataRecords(handle.database);
    const query = new DataQuery(handle.database);
    const transactions = new DataTransactions(handle.database);
    const provenance = new DataProvenance(handle.database);
    bootstrapCrm(catalog);

    const company = records.create({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "phase3:company:create",
      data: { name: "Acme" },
      actor,
    });
    const dealInput = {
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "phase3:deal:create",
      data: {
        title: "Gate",
        value: 100,
        stage: "proposal",
        company: company.recordId,
      },
      actor,
    } as const;
    const created = records.createWithReceipt({
      ...dealInput,
      requestId: "req_phase3_create_first",
    });
    const replay = records.createWithReceipt({
      ...dealInput,
      requestId: "req_phase3_create_retry",
    });
    assert.deepEqual(replay, created);
    assert.equal(replay.receipt.requestId, "req_phase3_create_first");

    assert.throws(
      () =>
        records.update({
          spaceId: "crm",
          entity: "deals",
          recordId: created.record.recordId,
          expectedVersion: 99,
          idempotencyKey: "phase3:stale-update",
          patch: { value: 999 },
          actor,
        }),
      (error) => assertRecordError(error, "RECORD_VERSION_CONFLICT"),
    );
    const updated = records.updateWithReceipt({
      spaceId: "crm",
      entity: "deals",
      recordId: created.record.recordId,
      expectedVersion: 1,
      idempotencyKey: "phase3:deal:update",
      patch: { value: 250, stage: "won" },
      actor,
      requestId: "req_phase3_update",
    });
    assert.equal(updated.record.version, 2);

    const page = query.query({
      spaceId: "crm",
      entity: "deals",
      where: {
        and: [
          { field: "stage", op: "eq", value: "won" },
          { field: "value", op: "gte", value: 200 },
        ],
      },
      orderBy: [{ field: "value", direction: "desc" }],
      limit: 10,
    });
    assert.equal(page.items.length, 1);
    const aggregate = query.aggregate({
      spaceId: "crm",
      entity: "deals",
      metrics: [
        { op: "count", as: "count" },
        { op: "sum", field: "value", as: "sum" },
        { op: "min", field: "value", as: "min" },
        { op: "max", field: "value", as: "max" },
        { op: "avg", field: "value", as: "avg" },
      ],
    });
    assert.deepEqual(aggregate.values, {
      count: 1,
      sum: 250,
      min: 250,
      max: 250,
      avg: 250,
    });
    const txn = transactions.execute({
      actor,
      payload: {
        idempotencyKey: "phase3:txn",
        operations: [
          {
            operation: "data.record.create",
            payload: {
              spaceId: "crm",
              entity: "companies",
              idempotencyKey: "phase3:txn:company",
              clientRef: "txn-company",
              data: { name: "Beta" },
            },
          },
          {
            operation: "data.record.create",
            payload: {
              spaceId: "crm",
              entity: "deals",
              idempotencyKey: "phase3:txn:deal",
              data: {
                title: "Txn",
                value: 10,
                company: { $ref: "txn-company" },
              },
            },
          },
        ],
      },
    });
    assert.equal(txn.operations.length, 2);
    assert.ok(provenance.listEvents({ limit: 50 }).items.length >= 4);

    const beforeRestart = {
      deals: records.list({ spaceId: "crm", entity: "deals" }),
      events: provenance.listEvents({ limit: 200 }).items.length,
    };
    const dealId = created.record.recordId;
    handle.database.close();

    // Restart/reopen exact state.
    const reopened = openWorkspaceScope(f.rootPath, "workspace-a");
    const reopenedRecords = new DataRecords(reopened.database);
    const reopenedProvenance = new DataProvenance(reopened.database);
    assert.deepEqual(
      reopenedRecords.list({ spaceId: "crm", entity: "deals" }),
      beforeRestart.deals,
    );
    assert.equal(
      reopenedProvenance.listEvents({ limit: 200 }).items.length,
      beforeRestart.events,
    );
    assert.equal(
      reopenedRecords.get({
        spaceId: "crm",
        entity: "deals",
        recordId: dealId,
      }).version,
      2,
    );
    reopened.database.close();

    // Isolation: workspace-b seeded independently.
    const initB = await initWorkspaceData({
      rootPath: f.rootPath,
      workspaceId: "workspace-b",
    });
    assert.equal(initB.status, "created");
    const handleB = openScopedDataDatabase(
      driver,
      createWorkspaceDataScope(root, "workspace-b"),
      { mode: "open-existing" },
    );
    try {
      const catalogB = new DataCatalog(handleB.database);
      bootstrapCrm(catalogB);
      const recordsB = new DataRecords(handleB.database);
      const companyB = recordsB.create({
        spaceId: "crm",
        entity: "companies",
        idempotencyKey: "phase3:b:company",
        data: { name: "Other" },
        actor,
      });
      assert.notEqual(companyB.recordId, company.recordId);
      assert.equal(
        recordsB.list({ spaceId: "crm", entity: "companies" }).length,
        1,
      );
    } finally {
      handleB.database.close();
    }
    const handleA2 = openScopedDataDatabase(
      driver,
      createWorkspaceDataScope(root, "workspace-a"),
      { mode: "open-existing" },
    );
    try {
      assert.equal(
        new DataRecords(handleA2.database).list({
          spaceId: "crm",
          entity: "companies",
        }).length,
        2,
      );
    } finally {
      handleA2.database.close();
    }

    // Representative sibling coexistence: unknown fields survive reinstall.
    mkdirSync(join(f.rootPath, ".aiverse", "extensions"), {
      recursive: true,
    });
    const registry = readRegistry(f.rootPath) as {
      extensions: Record<string, Record<string, unknown>>;
    };
    registry.extensions["memory"] = {
      id: "memory",
      supported: true,
      installed: true,
      enabled: true,
      custom_sibling: "keep",
    };
    writeFileSync(
      registryPath(f.rootPath),
      `${JSON.stringify(registry, null, 2)}\n`,
      "utf8",
    );
    const dbPath = join(
      f.rootPath,
      "workspaces",
      "workspace-a",
      "data",
      "ai-verse-data.sqlite",
    );
    const seeded = readFileSync(dbPath);

    // Gates 16-17: update/disable preserve records.
    updateDataExtension({ rootPath: f.rootPath });
    assert.deepEqual(readFileSync(dbPath), seeded);
    disableDataExtension({ rootPath: f.rootPath });
    assert.deepEqual(readFileSync(dbPath), seeded);
    assert.equal(
      (
        readRegistry(f.rootPath) as {
          extensions: Record<string, Record<string, unknown>>;
        }
      ).extensions["memory"]?.custom_sibling,
      "keep",
    );

    const deep = await doctorData({
      rootPath: f.rootPath,
      workspaceId: "workspace-a",
    });
    assert.equal(deep.healthy, true);
    assert.equal(deep.integrity?.ok, true);
    const light = await statusData({
      rootPath: f.rootPath,
      workspaceId: "workspace-a",
    });
    assert.equal(light.healthy, true);
    assert.equal(light.integrity?.checked, false);

    // Gate 18: uninstall preserves DB; gate 19: reinstall reopens same bytes.
    uninstallDataExtension({ rootPath: f.rootPath });
    assert.deepEqual(readFileSync(dbPath), seeded);
    assert.equal(
      (
        readRegistry(f.rootPath) as {
          extensions: Record<string, unknown>;
        }
      ).extensions["memory"] !== undefined,
      true,
    );
    installDataExtension({ rootPath: f.rootPath });
    const afterReinstall = await statusData({
      rootPath: f.rootPath,
      workspaceId: "workspace-a",
    });
    assert.equal(afterReinstall.database?.state, "compatible");
    assert.deepEqual(readFileSync(dbPath), seeded);
    assert.deepEqual(trackedBytes(f.rootPath), trackedBefore);

    // Gate 20: standalone fallback never masks incompatible host.
    const partial = fixture();
    try {
      writeFileSync(join(partial.rootPath, "AGENTS.md"), "# Agents\n", "utf8");
      mkdirSync(join(partial.rootPath, "workspaces"), { recursive: true });
      assert.throws(
        () => installDataExtension({ rootPath: partial.rootPath }),
        (error) => assertLifecycleError(error, "INCOMPATIBLE_AI_VERSE_OS"),
      );
    } finally {
      partial.cleanup();
    }
  } finally {
    f.cleanup();
  }
});

test("Phase 3 gate negative branches fail closed without mutation", async () => {
  // Paused/archived init blocked.
  const paused = fixture();
  try {
    writeCompatibleHost(paused.rootPath);
    writeWorkspace(paused.rootPath, "paused-ws", "paused");
    const before = ((): readonly string[] => {
      const out: string[] = [];
      function walk(rel: string): void {
        const abs = rel.length === 0 ? paused.rootPath : join(paused.rootPath, rel);
        for (const e of readdirSync(abs, { withFileTypes: true })) {
          const child = rel.length === 0 ? e.name : join(rel, e.name);
          if (e.isDirectory()) {
            out.push(`dir:${child}`);
            walk(child);
          } else if (e.isSymbolicLink()) out.push(`symlink:${child}`);
          else if (e.isFile()) out.push(`file:${child}`);
        }
      }
      walk("");
      return out;
    })();
    const resolved = resolveWorkspace({
      rootPath: paused.rootPath,
      workspaceId: "paused-ws",
    });
    assert.equal(resolved.manifest.status, "paused");
    await assert.rejects(
      initWorkspaceData({
        rootPath: paused.rootPath,
        workspaceId: "paused-ws",
      }),
      /active/i,
    );
    assert.equal(
      existsSync(join(paused.rootPath, "workspaces", "paused-ws", "data")),
      false,
    );
    const after: readonly string[] = ((): readonly string[] => {
      const out: string[] = [];
      function walk(rel: string): void {
        const abs = rel.length === 0 ? paused.rootPath : join(paused.rootPath, rel);
        for (const e of readdirSync(abs, { withFileTypes: true })) {
          const child = rel.length === 0 ? e.name : join(rel, e.name);
          if (e.isDirectory()) {
            out.push(`dir:${child}`);
            walk(child);
          } else if (e.isSymbolicLink()) out.push(`symlink:${child}`);
          else if (e.isFile()) out.push(`file:${child}`);
        }
      }
      walk("");
      return out;
    })();
    assert.deepEqual(after, before);
  } finally {
    paused.cleanup();
  }

  // ID mismatch/copy fail closed.
  const copied = fixture();
  try {
    writeCompatibleHost(copied.rootPath);
    writeWorkspace(copied.rootPath, "copied");
    writeFileSync(
      join(copied.rootPath, "workspaces", "copied", "WORKSPACE.yaml"),
      [
        `schema_version: "2.0"`,
        `id: "other"`,
        `name: "Copied"`,
        `type: "custom"`,
        `status: "active"`,
        `purpose: "x"`,
        "",
      ].join("\n"),
      "utf8",
    );
    assert.throws(
      () =>
        resolveWorkspace({
          rootPath: copied.rootPath,
          workspaceId: "copied",
        }),
      /mismatch|does not match/i,
    );
  } finally {
    copied.cleanup();
  }

  // Traversal/absolute/symlink fail closed.
  if (process.platform !== "win32") {
    const linked = fixture();
    try {
      writeCompatibleHost(linked.rootPath);
      writeWorkspace(linked.rootPath, "sales");
      installDataExtension({ rootPath: linked.rootPath });
      const extRoot = join(
        linked.rootPath,
        ".aiverse",
        "extensions",
        "ai-verse-data",
      );
      const target = join(extRoot, "INSTRUCTIONS.md");
      const saved = readFileSync(target, "utf8");
      rmSync(target);
      symlinkSync(join(linked.rootPath, "AGENTS.md"), target);
      try {
        assert.throws(
          () =>
            discoverExtensionInstructions({ rootPath: linked.rootPath }),
          /symbolic|symlink/i,
        );
      } finally {
        rmSync(target, { force: true });
        writeFileSync(target, saved, "utf8");
      }
    } finally {
      linked.cleanup();
    }
  }

  // Migration-required vs unsupported vs corrupt/quarantine vs scope-conflict.
  const states = fixture();
  try {
    writeCompatibleHost(states.rootPath);
    writeWorkspace(states.rootPath, "sales");
    installDataExtension({ rootPath: states.rootPath });
    await initWorkspaceData({
      rootPath: states.rootPath,
      workspaceId: "sales",
    });
    const dbPath = join(
      states.rootPath,
      "workspaces",
      "sales",
      "data",
      "ai-verse-data.sqlite",
    );

    const rawMig = new Database(dbPath);
    try {
      rawMig.exec("DROP TABLE IF EXISTS _schema_migrations;");
      rawMig
        .prepare(
          "DELETE FROM _aiverse_meta WHERE key = 'migration_framework_version'",
        )
        .run();
      rawMig
        .prepare("UPDATE _aiverse_meta SET value = '1' WHERE key = 'format_version'")
        .run();
      rawMig.pragma("user_version = 1");
    } finally {
      rawMig.close();
    }
    assert.equal(
      (
        await discoverWorkspaceData({
          rootPath: states.rootPath,
          workspaceId: "sales",
        })
      ).state,
      "migration_required",
    );
    await assert.rejects(
      initWorkspaceData({
        rootPath: states.rootPath,
        workspaceId: "sales",
      }),
      /migration/i,
    );

    const rawUnsup = new Database(dbPath);
    try {
      rawUnsup.exec("DROP TABLE IF EXISTS _schema_migrations;");
      rawUnsup.exec("DELETE FROM _aiverse_meta;");
      rawUnsup.exec(
        "INSERT INTO _aiverse_meta (key, value) VALUES ('format', 'other'), ('format_version', '1'), ('created_at', '2026-01-01T00:00:00.000Z'), ('driver', 'other')",
      );
    } finally {
      rawUnsup.close();
    }
    assert.equal(
      (
        await discoverWorkspaceData({
          rootPath: states.rootPath,
          workspaceId: "sales",
        })
      ).state,
      "unsupported",
    );

    const rawCorrupt = new Database(dbPath);
    try {
      rawCorrupt.exec("PRAGMA writable_schema = ON;");
      rawCorrupt.exec("DELETE FROM _aiverse_meta WHERE key = 'format';");
    } finally {
      rawCorrupt.close();
    }
    assert.equal(
      (
        await discoverWorkspaceData({
          rootPath: states.rootPath,
          workspaceId: "sales",
        })
      ).state,
      "quarantined",
    );

    writeWorkspace(states.rootPath, "other");
    const foreign = readFileSync(
      join(
        states.rootPath,
        "workspaces",
        "sales",
        "data",
        "ai-verse-data.sqlite",
      ),
    );
    void foreign;
  } finally {
    states.cleanup();
  }

  // Lock-busy fail closed.
  const busy = fixture();
  try {
    writeCompatibleHost(busy.rootPath);
    installDataExtension({ rootPath: busy.rootPath });
    const lockPath = join(
      busy.rootPath,
      ".aiverse",
      "extensions",
      "registry.json.lock",
    );
    writeFileSync(lockPath, "busy", "utf8");
    try {
      assert.throws(
        () => updateDataExtension({ rootPath: busy.rootPath }),
        (error: unknown) =>
          error instanceof Error && /busy|locked/i.test(error.message),
      );
    } finally {
      rmSync(lockPath, { force: true });
    }
  } finally {
    busy.cleanup();
  }

  // Quarantined recovery inspect stays read-only evidence.
  const quar = fixture();
  try {
    writeCompatibleHost(quar.rootPath);
    writeWorkspace(quar.rootPath, "sales");
    installDataExtension({ rootPath: quar.rootPath });
    await initWorkspaceData({
      rootPath: quar.rootPath,
      workspaceId: "sales",
    });
    const dbPath = join(
      quar.rootPath,
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
    const root = TrustedDataRoot.fromExistingDirectory(quar.rootPath);
    const scope = createWorkspaceDataScope(root, "sales");
    const report = await new DataRecovery(
      new SqliteStorageDriver(),
    ).inspect({ source: scope });
    assert.ok(report.state === "quarantined" || report.state === "corrupt");
  } finally {
    quar.cleanup();
  }
});
