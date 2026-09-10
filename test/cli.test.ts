import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

interface PackageJson {
  readonly version: string;
}

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as PackageJson;
const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));

function runCli(...args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
  });
}

test("--help succeeds and identifies the Phase 2.1 concurrency boundary", () => {
  const result = runCli("--help");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /AI-Verse Data/);
  assert.match(result.stdout, /Phase 2\.1 adds race-safe optimistic concurrency/);
  assert.equal(result.stderr, "");
});

test("--version succeeds and matches package metadata", () => {
  const result = runCli("--version");
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), packageJson.version);
  assert.equal(result.stderr, "");
});

test("unknown arguments fail explicitly", () => {
  const result = runCli("records");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown argument: records/);
});
