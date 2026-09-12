/** Public package surface. */

export * from "./protocol/index.js";
export * from "./storage/index.js";
export * from "./scope/index.js";
export * from "./catalog/index.js";
export * from "./records/index.js";
export * from "./query/index.js";
export * from "./transactions/index.js";
export * from "./idempotency/index.js";
export * from "./provenance/index.js";
export * from "./bulk/index.js";
export * from "./backup/index.js";
export * from "./schema-migrations/index.js";
export * from "./recovery/index.js";
export * from "./client/index.js";
export * from "./bots/index.js";
export * from "./brain/index.js";
export * from "./memory/index.js";
export * from "./dashboard/index.js";
export * from "./apps/index.js";
export * from "./connections/index.js";
export * from "./automation/index.js";
export * from "./native/index.js";

export const AI_VERSE_DATA_PACKAGE = "@ai-verse/data" as const;
export const AI_VERSE_DATA_PACKAGE_VERSION = "0.1.0-alpha.0" as const;
export const AI_VERSE_DATA_FOUNDATION_PHASE = "5.6" as const;

export interface FoundationStatus {
  readonly packageName: typeof AI_VERSE_DATA_PACKAGE;
  readonly phase: typeof AI_VERSE_DATA_FOUNDATION_PHASE;
  readonly protocolAvailable: true;
  readonly storageAvailable: true;
  readonly scopeAvailable: true;
  readonly catalogAvailable: true;
  readonly recordOperationsAvailable: true;
  readonly queryOperationsAvailable: true;
  readonly relationOperationsAvailable: true;
  readonly transactionOperationsAvailable: true;
  readonly optimisticConcurrencyAvailable: true;
  readonly idempotentMutationsAvailable: true;
  readonly provenanceAvailable: true;
  readonly mutationEventsAvailable: true;
  readonly mutationReceiptsAvailable: true;
  readonly bulkOperationsAvailable: true;
  readonly bulkPreviewAvailable: true;
  readonly consistentBackupAvailable: true;
  readonly portableExportAvailable: true;
  readonly portableImportAvailable: true;
  readonly internalMigrationsAvailable: true;
  readonly userSchemaMigrationsAvailable: true;
  readonly schemaMigrationPreviewAvailable: true;
  readonly corruptionRecoveryAvailable: true;
  readonly quarantineWriteBlockingAvailable: true;
  readonly stagedRecoveryAvailable: true;
  readonly phase2AcceptanceVerified: true;
  readonly nativeCompatibilityAvailable: true;
  readonly nativeExtensionMaterializationAvailable: true;
  readonly nativeExtensionRegistrationAvailable: true;
  readonly registryConcurrencySafetyAvailable: true;
  readonly nativeWorkspaceResolutionAvailable: true;
  readonly nativeWorkspaceInitAvailable: true;
  readonly nativeWorkspaceDiscoveryAvailable: true;
  readonly nativeInstructionDiscoveryAvailable: true;
  readonly nativeLifecycleAvailable: true;
  readonly nativeDoctorAvailable: true;
  readonly typedClientAvailable: true;
  readonly botsDataAdapterAvailable: true;
  readonly brainDataAdapterAvailable: true;
  readonly memoryBridgeAvailable: true;
  readonly dashboardProjectionAvailable: true;
  readonly appsDataContractAvailable: true;
  readonly connectionsAuthorityAvailable: true;
  readonly automationEventsAvailable: true;
}

/**
 * Machine-readable statement of the completed 5.6 release boundary.
 * The package includes the canonical protocol and SQLite engine, trusted scope,
 * schemas and records, safe query/relations, transactions, idempotency,
 * provenance, bulk operations, backup/export/import, schema and database
 * migrations, corruption recovery, native AI-Verse OS compatibility/lifecycle,
 * typed client SDK, and the Bots, Brain, Memory, Dashboard, Apps, Connections,
 * and Automation integration surfaces. Host-bound authorization remains the
 * authority source; adapters may only reduce that authority.
 */
export function getFoundationStatus(): FoundationStatus {
  return {
    packageName: AI_VERSE_DATA_PACKAGE,
    phase: AI_VERSE_DATA_FOUNDATION_PHASE,
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
  };
}
