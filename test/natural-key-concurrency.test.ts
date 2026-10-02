import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";

import {
  AI_VERSE_DATA_HOST_PROTOCOL,
  handleAiVerseDataHostRequest,
} from "../src/native/index.js";

function fixture() {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-natural-key-"));
  writeFileSync(
    join(rootPath, "AI-VERSE.yaml"),
    'schema_version: "2.0"\narchitecture: unified-workspace\n',
    "utf8",
  );
  writeFileSync(join(rootPath, "AGENTS.md"), "# Runtime\n", "utf8");
  mkdirSync(join(rootPath, "operator"), { recursive: true });
  mkdirSync(join(rootPath, "system", "extensions"), { recursive: true });
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
      'purpose: "Natural-key concurrency regression."',
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

const actor = { kind: "system" as const, id: "ai-verse-os-host" };
const authorization = {
  mode: "host-bound" as const,
  capabilityRefs: ["os-permission:natural-key-test"],
};

async function initialize(rootPath: string): Promise<void> {
  await handleAiVerseDataHostRequest({
    protocol: AI_VERSE_DATA_HOST_PROTOCOL,
    operation: "workspace.init",
    rootPath,
    workspaceId: "alpha",
  });
  await handleAiVerseDataHostRequest({
    protocol: AI_VERSE_DATA_HOST_PROTOCOL,
    operation: "data.host_bound_request",
    rootPath,
    workspaceId: "alpha",
    actor,
    authorization,
    data: {
      operation: "data.structure.ensure",
      payload: {
        idempotencyKey: "natural-key:structure:contacts",
        space: {
          spaceId: "crm",
          name: "CRM",
          authority: "local_canonical",
        },
        schema: {
          spaceId: "crm",
          entity: "contacts",
          name: "Contacts",
          fields: {
            external_id: { type: "string", required: true },
            name: { type: "string", required: true },
          },
        },
        reason: "Natural-key concurrency regression structure.",
      },
    },
  });
}

function createRequest(
  rootPath: string,
  idempotencyKey: string,
  name: string,
) {
  return {
    protocol: AI_VERSE_DATA_HOST_PROTOCOL,
    operation: "data.host_bound_request" as const,
    rootPath,
    workspaceId: "alpha",
    actor,
    authorization,
    data: {
      operation: "data.record.create",
      payload: {
        spaceId: "crm",
        entity: "contacts",
        idempotencyKey,
        data: {
          external_id: "acct-42",
          name,
        },
        naturalKey: {
          field: "external_id",
          value: "acct-42",
        },
      },
    },
  };
}

interface ChildOutcome {
  readonly ok: boolean;
  readonly result?: {
    readonly result?: {
      readonly recordId?: string;
      readonly data?: { readonly external_id?: string; readonly name?: string };
    };
  };
  readonly name?: string;
  readonly code?: string | null;
  readonly message?: string;
}

function childCreate(
  request: ReturnType<typeof createRequest>,
  gatePath: string,
): Promise<ChildOutcome> {
  const enginePath = fileURLToPath(new URL("../src/native/index.js", import.meta.url));
  const source = [
    'import { existsSync } from "node:fs";',
    'import { pathToFileURL } from "node:url";',
    'const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));',
    'while (!existsSync(process.env.AIVERSE_NATURAL_KEY_GATE)) await sleep(5);',
    'const engine = await import(pathToFileURL(process.argv[1]).href);',
    'const request = JSON.parse(process.argv[2]);',
    'try {',
    '  const result = await engine.handleAiVerseDataHostRequest(request);',
    '  process.stdout.write(JSON.stringify({ ok: true, result }));',
    '} catch (error) {',
    '  process.stdout.write(JSON.stringify({',
    '    ok: false,',
    '    name: error?.name ?? null,',
    '    code: error?.code ?? null,',
    '    message: error?.message ?? String(error),',
    '  }));',
    '}',
  ].join("\n");

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", source, enginePath, JSON.stringify(request)],
      {
        cwd: process.cwd(),
        env: { ...process.env, AIVERSE_NATURAL_KEY_GATE: gatePath },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`natural-key child exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as ChildOutcome);
      } catch (error) {
        reject(new Error(`natural-key child returned invalid JSON: ${stdout}\n${stderr}`, { cause: error }));
      }
    });
  });
}

test("different candidate IDs racing on one natural key commit exactly one canonical record", async () => {
  const f = fixture();
  try {
    await initialize(f.rootPath);
    const gatePath = join(f.rootPath, "natural-key-start.gate");
    const left = childCreate(
      createRequest(f.rootPath, "candidate:left:record-create", "Left candidate"),
      gatePath,
    );
    const right = childCreate(
      createRequest(f.rootPath, "candidate:right:record-create", "Right candidate"),
      gatePath,
    );

    await new Promise((resolve) => setTimeout(resolve, 150));
    closeSync(openSync(gatePath, "w"));
    const outcomes = await Promise.all([left, right]);

    const successes = outcomes.filter((item) => item.ok);
    const conflicts = outcomes.filter((item) => !item.ok);
    assert.equal(successes.length, 1, outcomes);
    assert.equal(conflicts.length, 1, outcomes);
    assert.equal(conflicts[0]?.name, "DataNaturalKeyError");
    assert.equal(conflicts[0]?.code, "NATURAL_KEY_CONFLICT");

    const listed = await handleAiVerseDataHostRequest({
      protocol: AI_VERSE_DATA_HOST_PROTOCOL,
      operation: "data.host_bound_request",
      rootPath: f.rootPath,
      workspaceId: "alpha",
      actor,
      authorization,
      data: {
        operation: "data.record.list",
        payload: { spaceId: "crm", entity: "contacts", limit: 10 },
      },
    }) as { result: readonly { recordId: string; data: { external_id: string; name: string } }[] };

    assert.equal(listed.result.length, 1);
    assert.equal(listed.result[0]?.data.external_id, "acct-42");
    assert.ok(["Left candidate", "Right candidate"].includes(listed.result[0]!.data.name));
    assert.equal(successes[0]?.result?.result?.recordId, listed.result[0]?.recordId);
  } finally {
    f.cleanup();
  }
});

test("natural-key create preserves caller idempotent replay for the winning candidate", async () => {
  const f = fixture();
  try {
    await initialize(f.rootPath);
    const request = createRequest(
      f.rootPath,
      "candidate:replay:record-create",
      "Replay candidate",
    );
    const first = await handleAiVerseDataHostRequest(request) as {
      requestId: string;
      result: { recordId: string };
    };
    const replay = await handleAiVerseDataHostRequest(request) as typeof first;

    assert.equal(replay.requestId, first.requestId);
    assert.equal(replay.result.recordId, first.result.recordId);

    const listed = await handleAiVerseDataHostRequest({
      protocol: AI_VERSE_DATA_HOST_PROTOCOL,
      operation: "data.host_bound_request",
      rootPath: f.rootPath,
      workspaceId: "alpha",
      actor,
      authorization,
      data: {
        operation: "data.record.list",
        payload: { spaceId: "crm", entity: "contacts", limit: 10 },
      },
    }) as { result: readonly unknown[] };
    assert.equal(listed.result.length, 1);
  } finally {
    f.cleanup();
  }
});

test("natural-key create rejects a mismatched key/value before canonical mutation", async () => {
  const f = fixture();
  try {
    await initialize(f.rootPath);
    const request = createRequest(
      f.rootPath,
      "candidate:mismatch:record-create",
      "Mismatch candidate",
    );
    request.data.payload.naturalKey.value = "acct-other";

    await assert.rejects(
      () => handleAiVerseDataHostRequest(request),
      (error: unknown) =>
        error instanceof Error &&
        error.name === "DataNaturalKeyError" &&
        (error as { code?: string }).code === "NATURAL_KEY_INVALID",
    );

    const listed = await handleAiVerseDataHostRequest({
      protocol: AI_VERSE_DATA_HOST_PROTOCOL,
      operation: "data.host_bound_request",
      rootPath: f.rootPath,
      workspaceId: "alpha",
      actor,
      authorization,
      data: {
        operation: "data.record.list",
        payload: { spaceId: "crm", entity: "contacts", limit: 10 },
      },
    }) as { result: readonly unknown[] };
    assert.equal(listed.result.length, 0);
  } finally {
    f.cleanup();
  }
});

test("legacy local-operator record create cannot invoke natural-key owner admission", async () => {
  const f = fixture();
  try {
    await initialize(f.rootPath);
    const request = createRequest(
      f.rootPath,
      "candidate:legacy:record-create",
      "Legacy candidate",
    );
    await assert.rejects(
      () => handleAiVerseDataHostRequest({
        protocol: request.protocol,
        operation: "data.request",
        rootPath: request.rootPath,
        workspaceId: request.workspaceId,
        data: request.data,
      }),
      /trusted host-bound actor path/,
    );
  } finally {
    f.cleanup();
  }
});
