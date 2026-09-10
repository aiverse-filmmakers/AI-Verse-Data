/** Public package surface. */

export * from "./protocol/index.js";

export const AI_VERSE_DATA_PACKAGE = "@ai-verse/data" as const;
export const AI_VERSE_DATA_PACKAGE_VERSION = "0.1.0-alpha.0" as const;
export const AI_VERSE_DATA_FOUNDATION_PHASE = "1.2" as const;

export interface FoundationStatus {
  readonly packageName: typeof AI_VERSE_DATA_PACKAGE;
  readonly phase: typeof AI_VERSE_DATA_FOUNDATION_PHASE;
  readonly dataOperationsAvailable: false;
}

/**
 * Returns a machine-readable statement of the current implementation boundary.
 * Protocol types and validators exist, but no structured-data persistence or CRUD
 * execution is available yet.
 */
export function getFoundationStatus(): FoundationStatus {
  return {
    packageName: AI_VERSE_DATA_PACKAGE,
    phase: AI_VERSE_DATA_FOUNDATION_PHASE,
    dataOperationsAvailable: false,
  };
}
