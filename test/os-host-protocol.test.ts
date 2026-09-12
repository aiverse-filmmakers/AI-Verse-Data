import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AI_VERSE_DATA_HOST_PROTOCOL,
  AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
  describeAiVerseDataHostEngine,
  handleAiVerseDataHostRequest,
} from "../src/native/index.js";

function fixture() {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-os-host-"));
  writeFileSync(
    join(rootPath, "AI-VERSE.yaml"),
    'schema_version: "2.0"\narchitecture: unified-workspace\n',
    "utf8",
  );
  writeFileSync(join(rootPath, "AGENTS.md"), "# Runtime\n", "utf8");
  mkdirSync(join(rootPath, "operator"), { recursive: true });
  mkdirSync(join(rootPath, "system", "extensions"), { recursive: true });
  writeFileSync(
    join(rootPath, "system", "extensions", "README.md"),
    `Registry: ${AI_VERSE_OS_EXTENSION_REGISTRY_PATH}\n`,
    "utf8",
  );
  const workspacePath = join(rootPath, "workspaces", "alpha");
  mkdirSync(workspacePath, { recursive: true });
  writeFileSync(
    join(workspacePath, "WORKSPACE.yaml"),
    [
      'schema_version: "2.0"',
      'id: "alpha"',
      'name: "Alpha"',
      'type: "custom"',
      'status: "active"',
      'purpose: "OS host protocol regression."',
      "",
    ].join("\n"),
    "utf8",
  );
  return {
    rootPath,
    cleanup(): void {
      rmSync(rootPath, { recursive: true, force: true });
    },
  };
}

test("Data engine description exactly matches the live AI-Verse OS host contract", () => {
  assert.deepEqual(describeAiVerseDataHostEngine(), {
    protocol: "ai-verse-data-host/1.0",
    extensionId: "ai-verse-data",
    actorBinding: "human:local-operator",
    authorizationBinding: "local-operator",
    workspaceInitialization: "explicit",
  });
});

test("OS host protocol can explicitly initialize and then execute typed Data requests", async () => {
  const f = fixture();
  try {
    await handleAiVerseDataHostRequest({
      protocol: AI_VERSE_DATA_HOST_PROTOCOL,
      operation: "workspace.init",
      rootPath: f.rootPath,
      workspaceId: "alpha",
    });

    const created = await handleAiVerseDataHostRequest({
      protocol: AI_VERSE_DATA_HOST_PROTOCOL,
      operation: "data.request",
      rootPath: f.rootPath,
      workspaceId: "alpha",
      data: {
        operation: "data.space.create",
        payload: {
          spaceId: "crm",
          name: "CRM",
          authority: "local_canonical",
        },
      },
    }) as { result: { spaceId: string } };
    assert.equal(created.result.spaceId, "crm");

    const listed = await handleAiVerseDataHostRequest({
      protocol: AI_VERSE_DATA_HOST_PROTOCOL,
      operation: "data.request",
      rootPath: f.rootPath,
      workspaceId: "alpha",
      data: {
        operation: "data.space.list",
        payload: {},
      },
    }) as { result: readonly { spaceId: string }[] };
    assert.ok(listed.result.some((space) => space.spaceId === "crm"));
  } finally {
    f.cleanup();
  }
});
