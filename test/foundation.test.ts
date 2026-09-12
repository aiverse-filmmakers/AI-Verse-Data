import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AI_VERSE_DATA_FOUNDATION_PHASE,
  AI_VERSE_DATA_PACKAGE,
  AI_VERSE_DATA_EXTENSION_VERSION,
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

test("package metadata exposes all implemented Phase 3.2 public subpaths", () => {
  assert.equal(packageJson.name, "@ai-verse/data");
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.bin["ai-verse-data"], "dist/src/cli.js");
  assert.equal(packageJson.engines.node, ">=22.0.0");
  assert.match(packageJson.version, /^0\.1\.0-alpha\.0$/);
  assert.equal(AI_VERSE_DATA_EXTENSION_VERSION, packageJson.version);
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
  assert.ok("./schema-migrations" in packageJson.exports);
  assert.ok("./recovery" in packageJson.exports);
  assert.ok("./client" in packageJson.exports);
  assert.ok("./bots" in packageJson.exports);
  assert.ok("./brain" in packageJson.exports);
  assert.ok("./memory" in packageJson.exports);
  assert.ok("./dashboard" in packageJson.exports);
  assert.ok("./apps" in packageJson.exports);
  assert.ok("./connections" in packageJson.exports);
  assert.ok("./automation" in packageJson.exports);
  assert.ok("./native" in packageJson.exports);
  assert.equal(packageJson.dependencies["better-sqlite3"], "13.0.3");
});

test("foundation surface reports Phase 4.1 typed client SDK", () => {
  assert.equal(AI_VERSE_DATA_PACKAGE, "@ai-verse/data");
  assert.equal(AI_VERSE_DATA_FOUNDATION_PHASE, "4.1");
  assert.deepEqual(getFoundationStatus(), {
    packageName: "@ai-verse/data",
    phase: "4.1",
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
    corruptionRecoveryAvailable: true,
    quarantineWriteBlockingAvailable: true,
    stagedRecoveryAvailable: true,
    phase2AcceptanceVerified: true,
    nativeCompatibilityAvailable: true,
    nativeExtensionMaterializationAvailable: true,
    nativeExtensionRegistrationAvailable: true,
    registryConcurrencySafetyAvailable: true,
    nativeWorkspaceResolutionAvailable: true,
    nativeWorkspaceInitAvailable: true,
    nativeWorkspaceDiscoveryAvailable: true,
    nativeInstructionDiscoveryAvailable: true,
    nativeLifecycleAvailable: true,
    nativeDoctorAvailable: true,
    typedClientAvailable: true,
    botsDataAdapterAvailable: true,
    brainDataAdapterAvailable: true,
    memoryBridgeAvailable: true,
    dashboardProjectionAvailable: true,
    appsDataContractAvailable: true,
    connectionsAuthorityAvailable: true,
    automationEventsAvailable: true,
  });
});
