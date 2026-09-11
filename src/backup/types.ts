import type { DataDatabaseScope, ScopedDatabaseHandle } from "../scope/index.js";
import type {
  StorageDatabaseBinding,
  StoredDataEvent,
  StoredDataSpace,
  StoredEntitySchemaVersion,
  StoredIdempotencyEntry,
  StoredMutationReceipt,
  StoredRecord,
  StoredRecordRelation,
} from "../storage/index.js";

export const AI_VERSE_DATA_ARTIFACT_MANIFEST_FORMAT =
  "ai-verse-data/artifact-manifest" as const;
export const AI_VERSE_DATA_ARTIFACT_RECEIPT_FORMAT =
  "ai-verse-data/artifact-receipt" as const;
export const AI_VERSE_DATA_ARTIFACT_FORMAT_VERSION = 1 as const;
export const AI_VERSE_DATA_PORTABLE_STATE_VERSION = 1 as const;

export type DataArtifactKind = "sqlite-backup" | "portable-export";

export interface DataPortableProvenanceEntry {
  readonly event: StoredDataEvent;
  readonly receipt: StoredMutationReceipt;
}

export interface DataPortableState {
  readonly version: typeof AI_VERSE_DATA_PORTABLE_STATE_VERSION;
  readonly binding: StorageDatabaseBinding;
  readonly spaces: readonly StoredDataSpace[];
  readonly schemas: readonly StoredEntitySchemaVersion[];
  readonly records: readonly StoredRecord[];
  readonly relations: readonly StoredRecordRelation[];
  readonly idempotency: readonly StoredIdempotencyEntry[];
  readonly provenance: readonly DataPortableProvenanceEntry[];
}

export interface DataStateSummary {
  readonly stateDigest: string;
  readonly spaceCount: number;
  readonly entityCount: number;
  readonly schemaVersionCount: number;
  readonly recordCount: number;
  readonly activeRecordCount: number;
  readonly relationCount: number;
  readonly idempotencyCount: number;
  readonly eventCount: number;
  readonly receiptCount: number;
}

export interface DataArtifactSource {
  readonly databaseFormat: "ai-verse-data/sqlite";
  readonly databaseFormatVersion: number;
  readonly driver: "sqlite";
  readonly databaseCreatedAt: string;
  readonly binding: StorageDatabaseBinding;
}

export interface DataArtifactPayload {
  readonly file: "database.sqlite" | "export.json";
  readonly mediaType: "application/vnd.sqlite3" | "application/json";
  readonly bytes: number;
  readonly sha256: string;
}

export interface DataArtifactManifest {
  readonly format: typeof AI_VERSE_DATA_ARTIFACT_MANIFEST_FORMAT;
  readonly formatVersion: typeof AI_VERSE_DATA_ARTIFACT_FORMAT_VERSION;
  readonly kind: DataArtifactKind;
  readonly artifactId: string;
  readonly createdAt: string;
  readonly source: DataArtifactSource;
  readonly payload: DataArtifactPayload;
  readonly state: DataStateSummary;
}

export interface DataArtifactReceipt {
  readonly format: typeof AI_VERSE_DATA_ARTIFACT_RECEIPT_FORMAT;
  readonly formatVersion: typeof AI_VERSE_DATA_ARTIFACT_FORMAT_VERSION;
  readonly kind: DataArtifactKind;
  readonly receiptId: string;
  readonly artifactId: string;
  readonly completedAt: string;
  readonly manifestSha256: string;
  readonly payloadSha256: string;
  readonly stateDigest: string;
  readonly sourceBinding: StorageDatabaseBinding;
}

export interface DataArtifactResult {
  readonly manifest: DataArtifactManifest;
  readonly receipt: DataArtifactReceipt;
}

export interface DataBackupCreateInput {
  readonly source: ScopedDatabaseHandle;
  readonly destinationDirectory: string;
}

export interface DataPortableExportInput {
  readonly source: ScopedDatabaseHandle;
  readonly destinationDirectory: string;
}

export interface DataArtifactVerifyInput {
  readonly artifactDirectory: string;
  readonly expectedBinding?: StorageDatabaseBinding;
}

export interface DataBackupRestoreInput {
  readonly artifactDirectory: string;
  readonly destination: DataDatabaseScope;
}

export interface DataPortableImportInput {
  readonly artifactDirectory: string;
  readonly destination: DataDatabaseScope;
}

export interface DataTransferReceipt {
  readonly receiptId: string;
  readonly operation: "backup.restore" | "portable.import";
  readonly artifactId: string;
  readonly completedAt: string;
  readonly destinationBinding: StorageDatabaseBinding;
  readonly stateDigest: string;
  readonly verification: "verified";
}

export interface DataBackupApi {
  createBackup(input: DataBackupCreateInput): Promise<DataArtifactResult>;
  verifyBackup(input: DataArtifactVerifyInput): Promise<DataArtifactResult>;
  restoreBackup(input: DataBackupRestoreInput): Promise<DataTransferReceipt>;
  createPortableExport(
    input: DataPortableExportInput,
  ): Promise<DataArtifactResult>;
  verifyPortableExport(
    input: DataArtifactVerifyInput,
  ): Promise<DataArtifactResult>;
  importPortableExport(
    input: DataPortableImportInput,
  ): Promise<DataTransferReceipt>;
}
