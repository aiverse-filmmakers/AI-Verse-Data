import type {
  DataArtifactKind,
  DataStateSummary,
  DataTransferReceipt,
} from "../backup/index.js";
import type { DataDatabaseScope } from "../scope/index.js";
import type {
  DataQuarantineMarker,
  StorageDatabaseBinding,
  StorageMigrationStatus,
} from "../storage/index.js";

export type DataRecoveryState =
  | "healthy"
  | "quarantined"
  | "corrupt"
  | "missing"
  | "unrecognized"
  | "unsupported"
  | "scope_conflict"
  | "migration_required"
  | "migration_incomplete"
  | "unavailable";

export type DataCorruptionCategory = "physical" | "semantic";

export interface DataCorruptionFinding {
  readonly category: DataCorruptionCategory;
  readonly code: string;
  readonly message: string;
}

export interface DataRecoveryReport {
  readonly state: DataRecoveryState;
  readonly writable: boolean;
  readonly checkedAt: string;
  readonly binding: StorageDatabaseBinding | null;
  readonly databaseFormatVersion: number | null;
  readonly migration: StorageMigrationStatus | null;
  readonly quarantine: DataQuarantineMarker | null;
  readonly corruption: DataCorruptionFinding | null;
  readonly stateSummary: DataStateSummary | null;
}

export interface DataRecoveryInspectInput {
  readonly source: DataDatabaseScope;
}

export interface DataRecoveryStageInput {
  readonly source: DataDatabaseScope;
  readonly artifactDirectory: string;
  readonly destination: DataDatabaseScope;
}

export interface DataRecoveryStageResult {
  readonly artifactKind: DataArtifactKind;
  readonly artifactId: string;
  readonly source: DataRecoveryReport;
  readonly destination: DataRecoveryReport;
  readonly transferReceipt: DataTransferReceipt;
  readonly promotion: "manual-explicit-not-implemented";
}

export interface DataRecoveryApi {
  inspect(input: DataRecoveryInspectInput): Promise<DataRecoveryReport>;
  stageBackupRecovery(
    input: DataRecoveryStageInput,
  ): Promise<DataRecoveryStageResult>;
  stagePortableRecovery(
    input: DataRecoveryStageInput,
  ): Promise<DataRecoveryStageResult>;
}
