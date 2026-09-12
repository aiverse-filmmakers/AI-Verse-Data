import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDataClient } from "../src/client/index.js";
import { DataRecordError } from "../src/records/index.js";
import {
  TrustedDataRoot,
  createWorkspaceDataScope,
} from "../src/scope/index.js";
import {
  AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
  AiVerseOsCompatibilityDetector,
  doctorData,
  initWorkspaceData,
  installDataExtension,
  statusData,
  uninstallDataExtension,
  updateDataExtension,
} from "../src/native/index.js";

function fixture(): { readonly rootPath: string; cleanup(): void } {
  const rootPath = realpathSync(mkdtempSync(join(tmpdir(), "ai-verse-data-release-")));
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
  mkdirSync(join(rootPath, "system", "extensions"), { recursive: true });
  writeFileSync(
    join(rootPath, "system", "extensions", "README.md"),
    `# Local extensions\nRegistry: ${AI_VERSE_OS_EXTENSION_REGISTRY_PATH}\n`,
    "utf8",
  );
}

function writeWorkspace(rootPath: string, workspaceId: string): void {
  mkdirSync(join(rootPath, "workspaces", workspaceId), { recursive: true });
  writeFileSync(
    join(rootPath, "workspaces", workspaceId, "WORKSPACE.yaml"),
    [
      `schema_version: "2.0"`,
      `id: "${workspaceId}"`,
      `name: "Workspace ${workspaceId}"`,
      `type: "custom"`,
      `status: "active"`,
      `purpose: "Release acceptance."`,
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

function dbPath(rootPath: string, workspaceId: string): string {
  return join(
    rootPath,
    "workspaces",
    workspaceId,
    "data",
    "ai-verse-data.sqlite",
  );
}

test("Release acceptance: clean-environment full story", async () => {
  const f = fixture();
  try {
    // Fresh OS, workspace A manifest, tracked snapshot.
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "workspace-a");
    const trackedBefore = trackedBytes(f.rootPath);
    assert.equal(
      new AiVerseOsCompatibilityDetector().inspect({ rootPath: f.rootPath })
        .status,
      "compatible",
    );

    // Install: owned files only, no workspace database yet.
    const firstInstall = installDataExtension({ rootPath: f.rootPath });
    assert.equal(firstInstall.status, "installed");
    assert.deepEqual(trackedBytes(f.rootPath), trackedBefore);
    assert.equal(
      existsSync(join(f.rootPath, "workspaces", "workspace-a", "data")),
      false,
    );

    // Initialize workspace A only.
    const initA = await initWorkspaceData({
      rootPath: f.rootPath,
      workspaceId: "workspace-a",
    });
    assert.equal(initA.status, "created");

    // CRM space, schemas, related records with receipts and replay.
    const root = TrustedDataRoot.fromExistingDirectory(f.rootPath);
    const client = createDataClient({
      scope: createWorkspaceDataScope(root, "workspace-a"),
      actor: { kind: "human", id: "release-owner" },
      authorization: { mode: "local-operator" },
    });
    try {
      assert.equal(
        client.spaces.create({
          spaceId: "crm",
          name: "CRM",
          authority: "local_canonical",
        }).ok,
        true,
      );
      assert.equal(
        client.schemas.create({
          spaceId: "crm",
          entity: "companies",
          name: "Companies",
          fields: { name: { type: "string", required: true } },
        }).ok,
        true,
      );
      assert.equal(
        client.schemas.create({
          spaceId: "crm",
          entity: "deals",
          name: "Deals",
          fields: {
            title: { type: "string", required: true },
            value: { type: "number", min: 0, default: 0 },
            stage: {
              type: "enum",
              values: ["lead", "proposal", "won"],
              default: "lead",
            },
            company: { type: "reference", entity: "companies", required: true },
          },
        }).ok,
        true,
      );

      const company = client.records.create({
        spaceId: "crm",
        entity: "companies",
        idempotencyKey: "release:company:1",
        data: { name: "Acme" },
      });
      assert.equal(company.ok, true);
      const deal = client.records.createWithReceipt({
        spaceId: "crm",
        entity: "deals",
        idempotencyKey: "release:deal:1",
        data: {
          title: "Flagship",
          value: 120,
          stage: "proposal",
          company: company.result.recordId,
        },
      });
      assert.equal(deal.ok, true);
      const replay = client.records.createWithReceipt({
        spaceId: "crm",
        entity: "deals",
        idempotencyKey: "release:deal:1",
        data: {
          title: "Flagship",
          value: 120,
          stage: "proposal",
          company: company.result.recordId,
        },
      });
      assert.equal(replay.ok, true);
      assert.equal(
        replay.result.record.recordId,
        deal.result.record.recordId,
      );
      assert.equal(
        replay.result.receipt.requestId,
        deal.result.receipt.requestId,
      );

      // Query plus aggregates.
      const page = client.query.query({
        spaceId: "crm",
        entity: "deals",
        where: { field: "stage", op: "eq", value: "proposal" },
        orderBy: [{ field: "value", direction: "desc" }],
        limit: 10,
      });
      assert.equal(page.ok, true);
      assert.equal(page.result.items.length, 1);
      const agg = client.query.aggregate({
        spaceId: "crm",
        entity: "deals",
        metrics: [
          { op: "count", as: "count" },
          { op: "sum", field: "value", as: "sum" },
        ],
      });
      assert.equal(agg.ok, true);
      assert.equal(agg.result.values["count"], 1);
      assert.equal(agg.result.values["sum"], 120);

      // Safe versioned update, then simulated concurrent conflict.
      const updated = client.records.updateWithReceipt({
        spaceId: "crm",
        entity: "deals",
        recordId: deal.result.record.recordId,
        expectedVersion: 1,
        idempotencyKey: "release:deal:update",
        patch: { value: 200, stage: "won" },
      });
      assert.equal(updated.ok, true);
      assert.equal(updated.result.record.version, 2);
      assert.throws(
        () =>
          client.records.update({
            spaceId: "crm",
            entity: "deals",
            recordId: deal.result.record.recordId,
            expectedVersion: 1,
            idempotencyKey: "release:deal:stale",
            patch: { value: 999 },
          }),
        (error: unknown) => {
          assert.ok(error instanceof DataRecordError);
          assert.equal(error.code, "RECORD_VERSION_CONFLICT");
          return true;
        },
      );

      // Backup artifact with verify proof.
      const artifacts = mkdtempSync(join(tmpdir(), "ai-verse-data-release-art-"));
      let backupArtifactId = "";
      try {
        const backupDir = join(artifacts, "backup");
        const backup = await client.backup.createBackup(backupDir);
        assert.ok(backup.manifest.artifactId.startsWith("artifact_"));
        const verified = await client.backup.verifyBackup(backupDir);
        assert.equal(
          verified.manifest.artifactId,
          backup.manifest.artifactId,
        );
        backupArtifactId = backup.manifest.artifactId;
      } finally {
        rmSync(artifacts, { recursive: true, force: true });
      }
      assert.ok(backupArtifactId.length > 0);

      // State to verify across restart.
      const dealsBefore = client.records.list({
        spaceId: "crm",
        entity: "deals",
        limit: 50,
      });
      assert.equal(dealsBefore.ok, true);
      const eventsBefore = client.provenance.listEvents({ spaceId: "crm" });
      assert.equal(eventsBefore.ok, true);
      const receiptBefore = client.provenance.getReceiptByIdempotencyKey(
        "release:deal:1",
      );
      assert.equal(receiptBefore.ok, true);
      const dealsCount = dealsBefore.result.length;
      const eventsCount = eventsBefore.result.items.length;
      const receiptId = receiptBefore.result.receiptId;
      client.close();

      // Restart/reopen: exact state, events, receipts.
      const root2 = TrustedDataRoot.fromExistingDirectory(f.rootPath);
      const client2 = createDataClient({
        scope: createWorkspaceDataScope(root2, "workspace-a"),
        actor: { kind: "human", id: "release-owner" },
        authorization: { mode: "local-operator" },
      });
      try {
        const dealsAfter = client2.records.list({
          spaceId: "crm",
          entity: "deals",
          limit: 50,
        });
        assert.equal(dealsAfter.ok, true);
        assert.equal(dealsAfter.result.length, dealsCount);
        const eventsAfter = client2.provenance.listEvents({ spaceId: "crm" });
        assert.equal(eventsAfter.ok, true);
        assert.equal(eventsAfter.result.items.length, eventsCount);
        const receiptAfter = client2.provenance.getReceipt(receiptId);
        assert.equal(receiptAfter.ok, true);
        assert.equal(receiptAfter.result.receiptId, receiptId);
      } finally {
        client2.close();
      }

      // Workspace B isolation.
      writeWorkspace(f.rootPath, "workspace-b");
      const initB = await initWorkspaceData({
        rootPath: f.rootPath,
        workspaceId: "workspace-b",
      });
      assert.equal(initB.status, "created");
      const rootB = TrustedDataRoot.fromExistingDirectory(f.rootPath);
      const clientB = createDataClient({
        scope: createWorkspaceDataScope(rootB, "workspace-b"),
        actor: { kind: "human", id: "release-owner" },
        authorization: { mode: "local-operator" },
      });
      try {
        assert.throws(
          () => clientB.spaces.get({ spaceId: "crm" }),
          (error: unknown) => {
            assert.ok(error instanceof Error);
            return true;
          },
        );
      } finally {
        clientB.close();
      }
    } finally {
      try {
        client.close();
      } catch {
        // Already closed on the restart path; fixture cleanup owns the rest.
      }
    }

    // Representative sibling state survives update without damage.
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
    const seeded = readFileSync(dbPath(f.rootPath, "workspace-a"));
    updateDataExtension({ rootPath: f.rootPath });
    assert.deepEqual(readFileSync(dbPath(f.rootPath, "workspace-a")), seeded);
    assert.equal(
      (
        readRegistry(f.rootPath) as {
          extensions: Record<string, Record<string, unknown>>;
        }
      ).extensions["memory"]?.["custom_sibling"],
      "keep",
    );
    const deep = await doctorData({
      rootPath: f.rootPath,
      workspaceId: "workspace-a",
    });
    assert.equal(deep.healthy, true);

    // Uninstall preserves canonical DB; reinstall reopens it verified.
    uninstallDataExtension({ rootPath: f.rootPath });
    assert.deepEqual(readFileSync(dbPath(f.rootPath, "workspace-a")), seeded);
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
    assert.deepEqual(readFileSync(dbPath(f.rootPath, "workspace-a")), seeded);
    const root3 = TrustedDataRoot.fromExistingDirectory(f.rootPath);
    const client3 = createDataClient({
      scope: createWorkspaceDataScope(root3, "workspace-a"),
      actor: { kind: "human", id: "release-owner" },
      authorization: { mode: "local-operator" },
    });
    try {
      const final = client3.records.list({
        spaceId: "crm",
        entity: "deals",
        limit: 50,
      });
      assert.equal(final.ok, true);
      assert.equal(final.result.length, 1);
      const finalReceipt = client3.provenance.getReceiptByIdempotencyKey(
        "release:deal:1",
      );
      assert.equal(finalReceipt.ok, true);
    } finally {
      client3.close();
    }
    assert.deepEqual(trackedBytes(f.rootPath), trackedBefore);
  } finally {
    f.cleanup();
  }
});
