import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AI_VERSE_DATA_FOUNDATION_PHASE,
  AI_VERSE_DATA_PACKAGE,
  getFoundationStatus,
} from "../src/index.js";

interface PackageJson {
  readonly name: string;
  readonly version: string;
  readonly type: string;
  readonly bin: Record<string, string>;
  readonly engines: Record<string, string>;
}

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as PackageJson;

test("package metadata exposes the intended package and CLI", () => {
  assert.equal(packageJson.name, "@ai-verse/data");
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.bin["ai-verse-data"], "dist/src/cli.js");
  assert.equal(packageJson.engines.node, ">=22.0.0");
  assert.match(packageJson.version, /^0\.1\.0-alpha\.0$/);
});

test("foundation surface explicitly reports that data operations are not available yet", () => {
  assert.equal(AI_VERSE_DATA_PACKAGE, "@ai-verse/data");
  assert.equal(AI_VERSE_DATA_FOUNDATION_PHASE, "1.1");
  assert.deepEqual(getFoundationStatus(), {
    packageName: "@ai-verse/data",
    phase: "1.1",
    dataOperationsAvailable: false,
  });
});
