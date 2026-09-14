import type {
  AggregatePayload,
  BulkMutationOperation,
  DataActor,
  DataAuthorization,
  DataOperation,
  DataProtocolError,
  DataScope,
  DataSpaceDefinition,
  EntitySchemaDefinition,
  EventsListPayload,
  JsonObject,
  QueryPayload,
  RecordCreatePayload,
  RecordDeletePayload,
  RecordGetPayload,
  RecordListPayload,
  RecordUpdatePayload,
  SchemaGetPayload,
  SchemaListPayload,
  SchemaMigrationExecutePayload,
  SchemaMigrationPreviewPayload,
  SchemaUpdatePayload,
  SpaceGetPayload,
  TransactionExecutePayload,
} from "../protocol/index.js";
import type { DataDatabaseScope } from "../scope/index.js";
import type { DataArtifactResult } from "../backup/index.js";
import type { DataBulkExecuteResult, DataBulkPreview } from "../bulk/index.js";
import type {
  DataSpaceSnapshot,
  EntitySchemaSnapshot,
  EntitySchemaSummary,
} from "../catalog/index.js";
import type {
  DataAggregateResult,
  DataQueryPage,
} from "../query/index.js";
import type {
  DataRecordMutationWithReceipt,
  DataRecordSnapshot,
} from "../records/index.js";
import type {
  DataEventPage,
  DataMutationReceipt,
} from "../provenance/index.js";
import type {
  SchemaMigrationPreview,
  SchemaMigrationResult,
} from "../schema-migrations/index.js";
import type {
  DataTransactionResult,
  DataTransactionWithReceipt,
} from "../transactions/index.js";

export interface CreateDataClientOptions {
  readonly scope: DataDatabaseScope;
  readonly actor: DataActor;
  readonly authorization: DataAuthorization;
}

export interface DataSuccessResult<T> {
  readonly protocol: "ai-verse-data/0.1";
  readonly requestId: string;
  readonly operation: DataOperation;
  readonly scope: DataScope;
  readonly actor: DataActor;
  readonly authorization: DataAuthorization;
  readonly ok: true;
  readonly result: T;
  readonly warnings: readonly [];
}

export interface DataFailureResult {
  readonly protocol: "ai-verse-data/0.1";
  readonly requestId: string;
  readonly operation: DataOperation;
  readonly scope: DataScope;
  readonly actor: DataActor;
  readonly authorization: DataAuthorization;
  readonly ok: false;
  readonly error: DataProtocolError;
}

export type DataClientResult<T> = DataSuccessResult<T> | DataFailureResult;

export type DataClientRecordCreateInput = Omit<RecordCreatePayload, "payload"> & {
  readonly spaceId: string;
  readonly entity: string;
  readonly idempotencyKey: string;
  readonly data: JsonObject;
  readonly clientRef?: string;
};

export type BulkExecuteParams = {
  readonly idempotencyKey: string;
  readonly expectedPreviewDigest: string;
  readonly operations: readonly BulkMutationOperation[];
};

export type MigrationWithReceipt = {
  readonly result: SchemaMigrationResult;
  readonly receipt: DataMutationReceipt;
};

export interface DataStructureEnsureInput {
  readonly idempotencyKey: string;
  readonly space: DataSpaceDefinition;
  readonly schema: EntitySchemaDefinition;
  readonly reason?: string;
}

export interface DataStructureEnsureResult {
  readonly state: "created" | "evolved" | "existing";
  readonly changed: boolean;
  readonly spaceState: "created" | "existing";
  readonly schemaState: "created" | "evolved" | "existing";
  readonly addedFields: readonly string[];
  readonly space: DataSpaceSnapshot;
  readonly schema: EntitySchemaSnapshot;
}

export interface DataStructureEnsureWithReceipt {
  readonly result: DataStructureEnsureResult;
  readonly receipt: DataMutationReceipt;
}

export interface DataClientSpaces {
  create(definition: {
    readonly spaceId: string;
    readonly name: string;
    readonly authority: "local_canonical";
    readonly description?: string;
  }): DataSuccessResult<DataSpaceSnapshot>;
  list(): DataSuccessResult<readonly DataSpaceSnapshot[]>;
  get(input: SpaceGetPayload): DataSuccessResult<DataSpaceSnapshot>;
}

export interface DataClientSchemas {
  ensure(
    input: DataStructureEnsureInput,
  ): DataSuccessResult<DataStructureEnsureWithReceipt>;
  create(
    definition: EntitySchemaDefinition,
  ): DataSuccessResult<EntitySchemaSnapshot>;
  list(
    input: SchemaListPayload,
  ): DataSuccessResult<readonly EntitySchemaSummary[]>;
  get(input: SchemaGetPayload): DataSuccessResult<EntitySchemaSnapshot>;
  update(input: SchemaUpdatePayload): DataSuccessResult<EntitySchemaSnapshot>;
  previewMigration(
    input: SchemaMigrationPreviewPayload,
  ): DataSuccessResult<SchemaMigrationPreview>;
  executeMigration(
    input: SchemaMigrationExecutePayload,
  ): DataSuccessResult<SchemaMigrationResult>;
  executeMigrationWithReceipt(
    input: SchemaMigrationExecutePayload,
  ): DataSuccessResult<MigrationWithReceipt>;
}

export interface DataClientRecords {
  create(
    input: DataClientRecordCreateInput,
  ): DataSuccessResult<DataRecordSnapshot>;
  createWithReceipt(
    input: DataClientRecordCreateInput,
  ): DataSuccessResult<DataRecordMutationWithReceipt>;
  get(input: RecordGetPayload): DataSuccessResult<DataRecordSnapshot>;
  list(
    input: RecordListPayload,
  ): DataSuccessResult<readonly DataRecordSnapshot[]>;
  update(input: RecordUpdatePayload): DataSuccessResult<DataRecordSnapshot>;
  updateWithReceipt(
    input: RecordUpdatePayload,
  ): DataSuccessResult<DataRecordMutationWithReceipt>;
  remove(input: RecordDeletePayload): DataSuccessResult<DataRecordSnapshot>;
  removeWithReceipt(
    input: RecordDeletePayload,
  ): DataSuccessResult<DataRecordMutationWithReceipt>;
}

export interface DataClientQuery {
  query(input: QueryPayload): DataSuccessResult<DataQueryPage>;
  aggregate(input: AggregatePayload): DataSuccessResult<DataAggregateResult>;
}

export interface DataClientTransactions {
  execute(
    input: TransactionExecutePayload,
  ): DataSuccessResult<DataTransactionResult>;
  executeWithReceipt(
    input: TransactionExecutePayload,
  ): DataSuccessResult<DataTransactionWithReceipt>;
}

export interface DataClientBulk {
  preview(
    operations: readonly BulkMutationOperation[],
  ): DataSuccessResult<DataBulkPreview>;
  execute(input: BulkExecuteParams): DataSuccessResult<DataBulkExecuteResult>;
}

export interface DataClientProvenance {
  listEvents(input?: EventsListPayload): DataSuccessResult<DataEventPage>;
  getReceipt(receiptId: string): DataSuccessResult<DataMutationReceipt>;
  getReceiptByIdempotencyKey(
    idempotencyKey: string,
  ): DataSuccessResult<DataMutationReceipt>;
  listTransactionReceipts(
    transactionId: string,
  ): DataSuccessResult<readonly DataMutationReceipt[]>;
}

export interface DataClientBackup {
  createBackup(destinationDirectory: string): Promise<DataArtifactResult>;
  createPortableExport(
    destinationDirectory: string,
  ): Promise<DataArtifactResult>;
  verifyBackup(artifactDirectory: string): Promise<DataArtifactResult>;
  verifyPortableExport(
    artifactDirectory: string,
  ): Promise<DataArtifactResult>;
}

export interface DataClientStorageFacts {
  readonly sqliteVersion: string;
  readonly journalMode: string;
  readonly foreignKeys: boolean;
  readonly strictTables: boolean;
  readonly applicationId: number;
  readonly userVersion: number;
}

export interface DataClientIntegrity {
  readonly ok: boolean;
  readonly messages: readonly string[];
}

export interface DataClientMigrationStatus {
  readonly state: "current" | "required" | "incomplete";
  readonly databaseFormatVersion: number;
  readonly targetFormatVersion: number;
  readonly pendingMigrationIds: readonly string[];
  readonly incompleteMigrationIds: readonly string[];
}

export interface DataClientHealth {
  metadata(): {
    readonly driverKind: string;
    readonly scopeKind: DataDatabaseScope["kind"];
    readonly workspaceId: string;
    readonly databasePath: string;
  };
  diagnostics(): DataSuccessResult<DataClientStorageFacts>;
  integrityCheck(): DataSuccessResult<DataClientIntegrity>;
  migrationStatus(): DataSuccessResult<DataClientMigrationStatus>;
}

export interface DataClient {
  readonly scope: DataDatabaseScope;
  readonly actor: DataActor;
  readonly authorization: DataAuthorization;
  readonly closed: boolean;
  readonly spaces: DataClientSpaces;
  readonly schemas: DataClientSchemas;
  readonly records: DataClientRecords;
  readonly query: DataClientQuery;
  readonly transactions: DataClientTransactions;
  readonly bulk: DataClientBulk;
  readonly provenance: DataClientProvenance;
  readonly backup: DataClientBackup;
  readonly health: DataClientHealth;
  close(): void;
}
