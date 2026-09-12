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
export * from "./native/index.js";

export const AI_VERSE_DATA_PACKAGE = "@ai-verse/data" as const;
export const AI_VERSE_DATA_PACKAGE_VERSION = "0.1.0-alpha.0" as const;
export const AI_VERSE_DATA_FOUNDATION_PHASE = "4.1" as const;

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
}

/**
 * Returns a machine-readable statement of the current implementation boundary.
 * Protocol validation, SQLite storage, trusted scoping, Data Spaces, entity
 * schemas, record CRUD, safe queries, aggregates, declared relations, bounded atomic transactions, race-safe optimistic concurrency, durable idempotent mutations, immutable mutation events, durable receipts, provenance queries, bounded bulk preview, atomic bulk execution, consistent SQLite backup, verified portable export/import, explicit internal database-format migrations, and bounded review-before-commit user-schema migrations, corruption quarantine, recovery diagnosis, and verified staged recovery are integrated and acceptance-gated through Phase 2.9. Phase 3.1 adds read-only AI-Verse OS v2 compatibility detection. Phase 3.2 adds hardened Data-owned extension materialization and local registry registration without workspace initialization. Phase 3.3 adds ID-only native workspace resolution, active-only explicit Data initialization, and seven-state existing-database discovery. Phase 3.4 adds read-only task-relevant extension instruction/runtime discovery. Phase 3.5 adds native CLI install/update/disable/uninstall composing existing primitives while preserving canonical workspace databases. Phase 3.6 adds read-only native doctor plus status composing existing primitives without mutation. Phase 4.1 adds a stable typed Data client SDK over the protocol with no new engine.
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
  };
}
