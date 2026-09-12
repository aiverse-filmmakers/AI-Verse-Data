import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AI_VERSE_DATA_EXTENSION_ENGINE_PATH,
  AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH,
  AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
  installDataExtension,
  openAiVerseDataHostSession,
  uninstallDataExtension,
} from "../src/native/index.js";

function fixture() {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-native-audit-"));
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
  return {
    rootPath,
    cleanup(): void {
      rmSync(rootPath, { recursive: true, force: true });
    },
  };
}

function writeWorkspace(rootPath: string, workspaceId: string): void {
  const path = join(rootPath, "workspaces", workspaceId);
  mkdirSync(path, { recursive: true });
  writeFileSync(
    join(path, "WORKSPACE.yaml"),
    [
      'schema_version: "2.0"',
      `id: "${workspaceId}"`,
      `name: "Workspace ${workspaceId}"`,
      'type: "custom"',
      'status: "active"',
      'purpose: "Post-release host bridge regression."',
      "",
    ].join("\n"),
    "utf8",
  );
}

function absolute(rootPath: string, relativePath: string): string {
  return join(rootPath, ...relativePath.split("/"));
}

test("supported host session explicitly initializes then reopens canonical workspace Data", async () => {
  const f = fixture();
  try {
    writeWorkspace(f.rootPath, "alpha");
    await assert.rejects(
      () =>
        openAiVerseDataHostSession({
          rootPath: f.rootPath,
          workspaceId: "alpha",
          actor: { kind: "human", id: "operator" },
          authorization: { mode: "local-operator" },
        }),
      /explicitly allow initializeIfMissing/,
    );

    const created = await openAiVerseDataHostSession({
      rootPath: f.rootPath,
      workspaceId: "alpha",
      actor: { kind: "human", id: "operator" },
      authorization: { mode: "local-operator" },
      initializeIfMissing: true,
    });
    try {
      assert.equal(created.initialized, "created");
      assert.equal(created.client.scope.workspaceId, "alpha");
      assert.ok(existsSync(created.databasePath));
      created.client.spaces.create({
        spaceId: "crm",
        name: "CRM",
        authority: "local_canonical",
      });
    } finally {
      created.close();
    }

    const reopened = await openAiVerseDataHostSession({
      rootPath: f.rootPath,
      workspaceId: "alpha",
      actor: { kind: "human", id: "operator" },
      authorization: { mode: "local-operator" },
    });
    try {
      assert.equal(reopened.initialized, "existing");
      assert.equal(reopened.client.spaces.get({ spaceId: "crm" }).result.name, "CRM");
    } finally {
      reopened.close();
    }
  } finally {
    f.cleanup();
  }
});

test("uninstall rolls back earlier file removals when a later owned path is unsafe", () => {
  const f = fixture();
  try {
    installDataExtension({ rootPath: f.rootPath });
    const instructionsPath = absolute(f.rootPath, AI_VERSE_DATA_EXTENSION_INSTRUCTIONS_PATH);
    const enginePath = absolute(f.rootPath, AI_VERSE_DATA_EXTENSION_ENGINE_PATH);
    const registryPath = absolute(f.rootPath, AI_VERSE_OS_EXTENSION_REGISTRY_PATH);
    const instructionsBefore = readFileSync(instructionsPath, "utf8");
    const registryBefore = readFileSync(registryPath, "utf8");

    rmSync(enginePath);
    mkdirSync(enginePath);

    assert.throws(() => uninstallDataExtension({ rootPath: f.rootPath }));
    assert.equal(readFileSync(instructionsPath, "utf8"), instructionsBefore);
    assert.equal(readFileSync(registryPath, "utf8"), registryBefore);
    assert.equal(existsSync(enginePath), true);
  } finally {
    f.cleanup();
  }
});
