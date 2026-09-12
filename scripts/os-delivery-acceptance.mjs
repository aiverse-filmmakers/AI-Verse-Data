#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const dataRoot = resolve(here, "..");

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  let osRoot = null;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--os-root") {
      osRoot = argv[++index] ?? null;
      continue;
    }
    fail(`Unknown argument: ${token}`);
  }
  if (osRoot === null) fail("--os-root is required");
  return { osRoot: resolve(osRoot) };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    fail(
      `Command failed (${command} ${args.join(" ")}): ${result.stderr || result.stdout}`,
    );
  }
  return result;
}

function runJson(command, args, input) {
  const result = run(command, args, {
    input: JSON.stringify(input),
  });
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    fail(`Command returned invalid JSON: ${error.message}\n${result.stdout}`);
  }
  return parsed;
}

function hostRequest(requestId, operation, scope, reason, data) {
  return {
    protocol: "ai-verse-os-data-host/1.0",
    request_id: requestId,
    operation,
    ...(scope === null ? {} : { scope }),
    reason,
    ...(data === undefined ? {} : { data }),
  };
}

function writeWorkspace(osRoot, workspaceId) {
  const dir = join(osRoot, "workspaces", workspaceId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "WORKSPACE.yaml"),
    [
      'schema_version: "2.0"',
      `id: "${workspaceId}"`,
      `name: "Data Delivery Acceptance"`,
      'type: "custom"',
      'status: "active"',
      'purpose: "Cross-repository AI-Verse Data delivery acceptance."',
      'approval:',
      '  external_actions: "confirm"',
      '  destructive_actions: "confirm"',
      '  high_stakes_decisions: "human-review"',
      "",
    ].join("\n"),
    "utf8",
  );
}

function main() {
  const { osRoot } = parseArgs(process.argv.slice(2));
  const cli = join(dataRoot, "dist", "src", "cli.js");
  const osHost = join(osRoot, "scripts", "data-host.mjs");
  const workspaceId = "data-delivery";
  const scope = `workspace:${workspaceId}`;

  assert.ok(existsSync(cli), "Data CLI build is missing");
  assert.ok(existsSync(osHost), "OS Data host boundary is missing");
  writeWorkspace(osRoot, workspaceId);

  const trackedBefore = {
    manifest: readFileSync(join(osRoot, "AI-VERSE.yaml"), "utf8"),
    agents: readFileSync(join(osRoot, "AGENTS.md"), "utf8"),
  };

  const install = runJson(
    process.execPath,
    [cli, "install", "--root", osRoot, "--json"],
    undefined,
  );
  assert.ok(
    install.status === "installed" || install.status === "updated" || install.status === "unchanged",
  );

  const init = runJson(
    process.execPath,
    [osHost, "--root", osRoot],
    hostRequest(
      "delivery-init",
      "init",
      scope,
      "Initialize Data explicitly for cross-repository acceptance.",
    ),
  );
  assert.equal(init.ok, true);
  assert.equal(init.result.status, "succeeded");
  assert.equal(init.result.result.status, "created");

  const createSpace = runJson(
    process.execPath,
    [osHost, "--root", osRoot],
    hostRequest(
      "delivery-space",
      "request",
      scope,
      "Create the acceptance CRM Data Space.",
      {
        operation: "data.space.create",
        payload: {
          spaceId: "crm",
          name: "CRM",
          authority: "local_canonical",
        },
      },
    ),
  );
  assert.equal(createSpace.ok, true);
  assert.equal(createSpace.result.result.ok, true);
  assert.deepEqual(createSpace.result.result.actor, {
    kind: "human",
    id: "local-operator",
  });

  const createSchema = runJson(
    process.execPath,
    [osHost, "--root", osRoot],
    hostRequest(
      "delivery-schema",
      "request",
      scope,
      "Create the acceptance deals schema.",
      {
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
    ),
  );
  assert.equal(createSchema.ok, true);
  assert.equal(createSchema.result.result.ok, true);

  const createRecord = runJson(
    process.execPath,
    [osHost, "--root", osRoot],
    hostRequest(
      "delivery-record",
      "request",
      scope,
      "Create a canonical acceptance record.",
      {
        operation: "data.record.create",
        payload: {
          spaceId: "crm",
          entity: "deals",
          idempotencyKey: "delivery:deal:1",
          data: {
            title: "Delivered through OS",
            value: 321,
          },
        },
      },
    ),
  );
  assert.equal(createRecord.ok, true);
  assert.equal(createRecord.result.result.ok, true);
  const recordId = createRecord.result.result.result.recordId;
  assert.match(recordId, /^rec_/);

  const query = runJson(
    process.execPath,
    [osHost, "--root", osRoot],
    hostRequest(
      "delivery-query",
      "request",
      scope,
      "Read the canonical acceptance record.",
      {
        operation: "data.query",
        payload: {
          spaceId: "crm",
          entity: "deals",
          where: { field: "value", op: "gte", value: 300 },
          limit: 10,
        },
      },
    ),
  );
  assert.equal(query.ok, true);
  assert.equal(query.result.result.ok, true);
  assert.equal(query.result.result.result.items.length, 1);
  assert.equal(
    query.result.result.result.items[0].recordId,
    recordId,
  );

  const blockedDelete = runJson(
    process.execPath,
    [osHost, "--root", osRoot],
    hostRequest(
      "delivery-delete",
      "request",
      scope,
      "Verify destructive Data policy blocks effects pending approval.",
      {
        operation: "data.record.delete",
        payload: {
          spaceId: "crm",
          entity: "deals",
          recordId,
          expectedVersion: 1,
          idempotencyKey: "delivery:deal:delete",
        },
      },
    ),
  );
  assert.equal(blockedDelete.ok, true);
  assert.equal(blockedDelete.result.status, "approval_required");
  assert.equal(blockedDelete.result.effect_occurred, false);

  const databasePath = join(
    osRoot,
    "workspaces",
    workspaceId,
    "data",
    "ai-verse-data.sqlite",
  );
  assert.ok(existsSync(databasePath));
  const beforeUninstall = readFileSync(databasePath);

  const uninstall = runJson(
    process.execPath,
    [cli, "uninstall", "--root", osRoot, "--json"],
    undefined,
  );
  assert.equal(uninstall.status, "uninstalled");
  assert.deepEqual(readFileSync(databasePath), beforeUninstall);

  runJson(
    process.execPath,
    [cli, "install", "--root", osRoot, "--json"],
    undefined,
  );

  const queryAfterReinstall = runJson(
    process.execPath,
    [osHost, "--root", osRoot],
    hostRequest(
      "delivery-query-reinstall",
      "request",
      scope,
      "Verify preserved canonical Data after reinstall.",
      {
        operation: "data.record.get",
        payload: {
          spaceId: "crm",
          entity: "deals",
          recordId,
        },
      },
    ),
  );
  assert.equal(queryAfterReinstall.ok, true);
  assert.equal(queryAfterReinstall.result.result.ok, true);
  assert.equal(queryAfterReinstall.result.result.result.recordId, recordId);

  assert.deepEqual(
    {
      manifest: readFileSync(join(osRoot, "AI-VERSE.yaml"), "utf8"),
      agents: readFileSync(join(osRoot, "AGENTS.md"), "utf8"),
    },
    trackedBefore,
  );

  process.stdout.write(
    JSON.stringify({
      ok: true,
      workspaceId,
      recordId,
      databasePreservedAcrossUninstall: true,
      destructiveDeleteBlockedPendingApproval: true,
    }) + "\n",
  );
}

main();
