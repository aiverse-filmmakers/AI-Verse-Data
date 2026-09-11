import type {
  DataActor,
  JsonObject,
  SchemaMigrationApproval,
  SchemaMigrationExecutePayload,
  SchemaMigrationPreviewPayload,
} from "../protocol/index.js";
import type { DataMutationReceipt } from "../provenance/index.js";

export interface SchemaMigrationPreview {
  readonly spaceId: string;
  readonly entity: string;
  readonly fromSchemaVersion: number;
  readonly toSchemaVersion: number;
  readonly fromSchemaDigest: string;
  readonly toSchemaDigest: string;
  readonly activeRecordCount: number;
  readonly rewrittenRecordCount: number;
  readonly scannedRecordBytes: number;
  readonly rewrittenRecordBytes: number;
  readonly destructive: boolean;
  readonly approvalRequired: boolean;
  readonly owner: DataActor;
  readonly changeCount: number;
  readonly backfillCount: number;
  readonly previewDigest: string;
}

export interface SchemaMigrationResult extends SchemaMigrationPreview {
  readonly migrationId: string;
  readonly completedAt: string;
  readonly executor: DataActor;
  readonly approval: SchemaMigrationApproval | null;
}

export interface SchemaMigrationPreviewInput {
  readonly actor: DataActor;
  readonly payload: SchemaMigrationPreviewPayload;
}

export interface SchemaMigrationExecuteInput {
  readonly actor: DataActor;
  readonly payload: SchemaMigrationExecutePayload;
  readonly requestId?: string;
}

export interface SchemaMigrationWithReceipt {
  readonly result: SchemaMigrationResult;
  readonly receipt: DataMutationReceipt;
}

export interface DataSchemaMigrationsApi {
  preview(input: SchemaMigrationPreviewInput): SchemaMigrationPreview;
  execute(input: SchemaMigrationExecuteInput): SchemaMigrationResult;
  executeWithReceipt(
    input: SchemaMigrationExecuteInput,
  ): SchemaMigrationWithReceipt;
}

export interface SchemaMigrationRecordRewriteSummary extends JsonObject {
  readonly recordId: string;
  readonly beforeVersion: number;
  readonly afterVersion: number;
}
