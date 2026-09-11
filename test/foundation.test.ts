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
  readonly exports: Record<string, unknown>;
  readonly dependencies: Record<string, string>;
}

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as PackageJson;

test("package metadata exposes package, CLI, protocol, storage, scope, catalog, records, query, transactions, idempotency, provenance, bulk, and backup subpaths", () => {
  assert.equal(packageJson.name, "@ai-verse/data");
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.bin["ai-verse-data"], "dist/src/cli.js");
  assert.equal(packageJson.engines.node, ">=22.0.0");
  assert.match(packageJson.version, /^0\.1\.0-alpha\.0$/);
  assert.ok("./protocol" in packageJson.exports);
  assert.ok("./storage" in packageJson.exports);
  assert.ok("./scope" in packageJson.exports);
  assert.ok("./catalog" in packageJson.exports);
  assert.ok("./records" in packageJson.exports);
  assert.ok("./query" in packageJson.exports);
  assert.ok("./transactions" in packageJson.exports);
  assert.ok("./idempotency" in packageJson.exports);
  assert.ok("./provenance" in packageJson.exports);
  assert.ok("./bulk" in packageJson.exports);
  assert.ok("./backup" in packageJson.exports);
  assert.equal(packageJson.dependencies["better-sqlite3"], "13.0.3");
});

test("foundation surface reports Phase 2.7 user-schema migration safety", () => {
  assert.equal(AI_VERSE_DATA_PACKAGE, "@ai-verse/data");
  assert.equal(AI_VERSE_DATA_FOUNDATION_PHASE, "2.7");
  assert.deepEqual(getFoundationStatus(), {
    packageName: "@ai-verse/data",
    phase: "2.7",
    protocolAvailable: true,
    storageAvailable: true,
    scopeAvailable: true,
    catalogAvailable: true,
    recordOperationsAvailable: true,
    queryOperationsAvailable: true,
    relationOperationsAvailable: true,
    transactionOperationsAvailable: true,
    optimisticConcurrencyAvailable: true,
    idempotentMutationsAvailable: true,
    provenanceAvailable: true,
    mutationEventsAvailable: true,
    mutationReceiptsAvailable: true,
    bulkOperationsAvailable: true,
    bulkPreviewAvailable: true,
    consistentBackupAvailable: true,
    portableExportAvailable: true,
    portableImportAvailable: true,
    internalMigrationsAvailable: true,
    userSchemaMigrationsAvailable: true,
    schemaMigrationPreviewAvailable: true,
  });
});
