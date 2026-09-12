import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  AI_VERSE_DATA_EXTENSION_ENGINE_PATH,
  AI_VERSE_DATA_HOST_PROTOCOL,
  AI_VERSE_OS_EXTENSION_REGISTRY_PATH,
  AiVerseDataHostBridgeError,
  installDataExtension,
} from "../src/native/index.js";

function fixture(): {
  readonly rootPath: string;
  cleanup(): void;
} {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-host-"));
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
      'schema_version: "2.0"',
      `id: "${workspaceId}"`,
      `name: "Workspace ${workspaceId}"`,
      'type: "custom"',
      'status: "active"',
      'purpose: "Native Data host bridge acceptance."',
      "",
    ].join("\n"),
    "utf8",
  );
}

test("materialized engine serves an explicit workspace-scoped Data host flow", async () => {
  const f = fixture();
  try {
    writeCompatibleHost(f.rootPath);
    writeWorkspace(f.rootPath, "sales");
    const install = installDataExtension({ rootPath: f.rootPath });
    assert.equal(install.status, "installed");

    const enginePath = join(
      f.rootPath,
      ...AI_VERSE_DATA_EXTENSION_ENGINE_PATH.split("/"),
    );
    const engine = await import(
      `${pathToFileURL(enginePath).href}?acceptance=1`
    ) as {
      describe(): unknown;
      handleRequest(input: unknown): Promise<unknown>;
    };

    assert.deepEqual(engine.describe(), {
      protocol: AI_VERSE_DATA_HOST_PROTOCOL,
      actorBinding: "human:local-operator",
      authorizationBinding: "local-operator",
      workspaceInitialization: "explicit",
      dataProtocol: "ai-verse-data/0.1",
    });

    const missing = await engine.handleRequest({
      protocol: AI_VERSE_DATA_HOST_PROTOCOL,
      operation: "workspace.discover",
      rootPath: f.rootPath,
      workspaceId: "sales",
    }) as { state: string };
    assert.equal(missing.state, "missing");

    await assert.rejects(
      () =>
        engine.handleRequest({
          protocol: AI_VERSE_DATA_HOST_PROTOCOL,
          operation: "data.request",
          rootPath: f.rootPath,
          workspaceId: "sales",
          data: {
            operation: "data.space.list",
            payload: {},
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof AiVerseDataHostBridgeError);
        assert.equal(error.code, "HOST_DATA_NOT_INITIALIZED");
        return true;
      },
    );

    const initialized = await engine.handleRequest({
      protocol: AI_VERSE_DATA_HOST_PROTOCOL,
      operation: "workspace.init",
      rootPath: f.rootPath,
      workspaceId: "sales",
    }) as { status: string };
    assert.equal(initialized.status, "created");

    const space = await engine.handleRequest({
      protocol: AI_VERSE_DATA_HOST_PROTOCOL,
      operation: "data.request",
      rootPath: f.rootPath,
      workspaceId: "sales",
      data: {
        operation: "data.space.create",
        payload: {
          spaceId: "crm",
          name: "CRM",
          authority: "local_canonical",
        },
      },
    }) as {
      ok: boolean;
      actor: { kind: string; id: string };
      authorization: { mode: string };
    };
    assert.equal(space.ok, true);
    assert.deepEqual(space.actor, {
      kind: "human",
      id: "local-operator",
    });
    assert.equal(space.authorization.mode, "local-operator");

    const schema = await engine.handleRequest({
      protocol: AI_VERSE_DATA_HOST_PROTOCOL,
      operation: "data.request",
      rootPath: f.rootPath,
      workspaceId: "sales",
      data: {
        operation: "data.schema.create",
        payload: {
          spaceId: "crm",
          entity: "deals",
          name: "Deals",
          fields: {
            title: { type: "string", required: true },
            value: { type: "number", min: 0, default: 0 },
          },
        },
      },
    }) as { ok: boolean };
    assert.equal(schema.ok, true);

    const record = await engine.handleRequest({
      protocol: AI_VERSE_DATA_HOST_PROTOCOL,
      operation: "data.request",
      rootPath: f.rootPath,
      workspaceId: "sales",
      data: {
        operation: "data.record.create",
        payload: {
          spaceId: "crm",
          entity: "deals",
          idempotencyKey: "host:deal:1",
          data: { title: "Host deal", value: 125 },
        },
      },
    }) as { ok: boolean };
    assert.equal(record.ok, true);

    const queried = await engine.handleRequest({
      protocol: AI_VERSE_DATA_HOST_PROTOCOL,
      operation: "data.request",
      rootPath: f.rootPath,
      workspaceId: "sales",
      data: {
        operation: "data.query",
        payload: {
          spaceId: "crm",
          entity: "deals",
          where: { field: "value", op: "gte", value: 100 },
          limit: 10,
        },
      },
    }) as {
      ok: boolean;
      result: { items: readonly unknown[] };
    };
    assert.equal(queried.ok, true);
    assert.equal(queried.result.items.length, 1);

    await assert.rejects(
      () =>
        engine.handleRequest({
          protocol: AI_VERSE_DATA_HOST_PROTOCOL,
          operation: "data.request",
          rootPath: f.rootPath,
          workspaceId: "sales",
          actor: { kind: "bot", id: "forged" },
          data: {
            operation: "data.space.list",
            payload: {},
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof AiVerseDataHostBridgeError);
        assert.equal(error.code, "HOST_REQUEST_INVALID");
        return true;
      },
    );
  } finally {
    f.cleanup();
  }
});
