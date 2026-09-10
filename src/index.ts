/** Public package surface. */

export * from "./protocol/index.js";
export * from "./storage/index.js";

export const AI_VERSE_DATA_PACKAGE = "@ai-verse/data" as const;
export const AI_VERSE_DATA_PACKAGE_VERSION = "0.1.0-alpha.0" as const;
export const AI_VERSE_DATA_FOUNDATION_PHASE = "1.3" as const;

export interface FoundationStatus {
  readonly packageName: typeof AI_VERSE_DATA_PACKAGE;
  readonly phase: typeof AI_VERSE_DATA_FOUNDATION_PHASE;
  readonly protocolAvailable: true;
  readonly storageAvailable: true;
  readonly dataOperationsAvailable: false;
}

/**
 * Returns a machine-readable statement of the current implementation boundary.
 * Protocol validation and the storage bootstrap exist, but Data Spaces, schemas,
 * records, queries, and CRUD execution are intentionally not implemented yet.
 */
export function getFoundationStatus(): FoundationStatus {
  return {
    packageName: AI_VERSE_DATA_PACKAGE,
    phase: AI_VERSE_DATA_FOUNDATION_PHASE,
    protocolAvailable: true,
    storageAvailable: true,
    dataOperationsAvailable: false,
  };
}
