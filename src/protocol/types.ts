import type {
  ACTOR_KINDS,
  AGGREGATE_OPERATORS,
  AUTHORIZATION_MODES,
  DATA_AUTHORITY_CLASSES,
  DATA_ERROR_CODES,
  DATA_OPERATIONS,
  FIELD_TYPES,
  QUERY_OPERATORS,
  SORT_DIRECTIONS,
} from "./constants.js";

export type DataOperation = (typeof DATA_OPERATIONS)[number];
export type ActorKind = (typeof ACTOR_KINDS)[number];
export type AuthorizationMode = (typeof AUTHORIZATION_MODES)[number];
export type DataAuthorityClass = (typeof DATA_AUTHORITY_CLASSES)[number];
export type FieldType = (typeof FIELD_TYPES)[number];
export type QueryOperator = (typeof QUERY_OPERATORS)[number];
export type SortDirection = (typeof SORT_DIRECTIONS)[number];
export type AggregateOperator = (typeof AGGREGATE_OPERATORS)[number];
export type DataErrorCode = (typeof DATA_ERROR_CODES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type WorkspaceId = string;
export type DataSpaceId = string;
export type EntityId = string;
export type RecordId = string;
export type RequestId = string;
export type EventId = string;
export type TransactionId = string;
export type ReceiptId = string;

export interface DataScope {
  readonly workspaceId: WorkspaceId;
}

export interface DataActor {
  readonly kind: ActorKind;
  readonly id: string;
}

export interface DataAuthorization {
  readonly mode: AuthorizationMode;
  readonly capabilityRefs?: readonly string[];
}

export interface BaseFieldDefinition {
  readonly required?: boolean;
  readonly nullable?: boolean;
  readonly description?: string;
  readonly default?: JsonValue;
}

export interface StringFieldDefinition extends BaseFieldDefinition {
  readonly type: "string";
  readonly minLength?: number;
  readonly maxLength?: number;
}

export interface NumberFieldDefinition extends BaseFieldDefinition {
  readonly type: "number";
  readonly min?: number;
  readonly max?: number;
}

export interface IntegerFieldDefinition extends BaseFieldDefinition {
  readonly type: "integer";
  readonly min?: number;
  readonly max?: number;
}

export interface BooleanFieldDefinition extends BaseFieldDefinition {
  readonly type: "boolean";
}

export interface DateFieldDefinition extends BaseFieldDefinition {
  readonly type: "date";
}

export interface DateTimeFieldDefinition extends BaseFieldDefinition {
  readonly type: "datetime";
}

export interface EnumFieldDefinition extends BaseFieldDefinition {
  readonly type: "enum";
  readonly values: readonly string[];
}

export interface ReferenceFieldDefinition extends BaseFieldDefinition {
  readonly type: "reference";
  readonly entity: EntityId;
  readonly spaceId?: DataSpaceId;
}

export interface JsonFieldDefinition extends BaseFieldDefinition {
  readonly type: "json";
}

export interface AttachmentRefFieldDefinition extends BaseFieldDefinition {
  readonly type: "attachment_ref";
}

export type FieldDefinition =
  | StringFieldDefinition
  | NumberFieldDefinition
  | IntegerFieldDefinition
  | BooleanFieldDefinition
  | DateFieldDefinition
  | DateTimeFieldDefinition
  | EnumFieldDefinition
  | ReferenceFieldDefinition
  | JsonFieldDefinition
  | AttachmentRefFieldDefinition;

export interface EntitySchemaDefinition {
  readonly spaceId: DataSpaceId;
  readonly entity: EntityId;
  readonly name: string;
  readonly description?: string;
  readonly fields: Readonly<Record<string, FieldDefinition>>;
  readonly allowUnknownFields?: boolean;
}

export interface DataSpaceDefinition {
  readonly spaceId: DataSpaceId;
  readonly name: string;
  readonly description?: string;
  readonly authority: DataAuthorityClass;
}

export interface DataRecord {
  readonly spaceId: DataSpaceId;
  readonly entity: EntityId;
  readonly recordId: RecordId;
  readonly schemaVersion: number;
  readonly version: number;
  readonly data: JsonObject;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: DataActor;
  readonly updatedBy: DataActor;
  readonly deletedAt: string | null;
  readonly deletedReason: string | null;
  readonly deletedBy: DataActor | null;
}

export interface QueryCondition {
  readonly field: string;
  readonly op: QueryOperator;
  readonly value?: JsonValue;
}

export interface QueryAnd {
  readonly and: readonly QueryFilter[];
}

export interface QueryOr {
  readonly or: readonly QueryFilter[];
}

export interface QueryNot {
  readonly not: QueryFilter;
}

export type QueryFilter = QueryCondition | QueryAnd | QueryOr | QueryNot;

export interface QueryOrder {
  readonly field: string;
  readonly direction: SortDirection;
}

export interface AggregateMetric {
  readonly op: AggregateOperator;
  readonly field?: string;
  readonly as: string;
}

export type EmptyPayload = Readonly<Record<string, never>>;
export type SpaceListPayload = EmptyPayload;

export interface SpaceGetPayload {
  readonly spaceId: DataSpaceId;
}
export type SpaceCreatePayload = DataSpaceDefinition;

export interface SchemaListPayload {
  readonly spaceId: DataSpaceId;
}

export interface SchemaGetPayload {
  readonly spaceId: DataSpaceId;
  readonly entity: EntityId;
  readonly version?: "current" | number;
}

export type SchemaCreatePayload = EntitySchemaDefinition;

export type SchemaChange =
  | { readonly op: "add_field"; readonly field: string; readonly definition: FieldDefinition }
  | { readonly op: "set_name"; readonly name: string }
  | { readonly op: "set_description"; readonly description: string }
  | { readonly op: "remove_field"; readonly field: string }
  | {
      readonly op: "replace_field";
      readonly field: string;
      readonly definition: FieldDefinition;
    }
  | {
      readonly op: "rename_field";
      readonly field: string;
      readonly newField: string;
    };

export interface SchemaUpdatePayload {
  readonly spaceId: DataSpaceId;
  readonly entity: EntityId;
  readonly expectedSchemaVersion: number;
  readonly changes: readonly SchemaChange[];
}

export type SchemaMigrationBackfillMode = "set_if_missing" | "set";

export interface SchemaMigrationBackfill {
  readonly field: string;
  readonly mode: SchemaMigrationBackfillMode;
  readonly value: JsonValue;
}

export interface SchemaMigrationApproval {
  readonly approvalRef: string;
  readonly approvedBy: DataActor;
  readonly approvedAt: string;
  readonly reason?: string;
}

export interface SchemaMigrationPreviewPayload {
  readonly spaceId: DataSpaceId;
  readonly entity: EntityId;
  readonly expectedSchemaVersion: number;
  readonly changes: readonly SchemaChange[];
  readonly backfills?: readonly SchemaMigrationBackfill[];
  readonly owner: DataActor;
  readonly reason?: string;
}

export interface SchemaMigrationExecutePayload extends SchemaMigrationPreviewPayload {
  readonly idempotencyKey: string;
  readonly expectedPreviewDigest: string;
  readonly approval?: SchemaMigrationApproval;
}

export interface RecordCreatePayload {
  readonly spaceId: DataSpaceId;
  readonly entity: EntityId;
  readonly idempotencyKey: string;
  readonly data: JsonObject;
  readonly clientRef?: string;
}

export interface RecordGetPayload {
  readonly spaceId: DataSpaceId;
  readonly entity: EntityId;
  readonly recordId: RecordId;
  readonly includeDeleted?: boolean;
}

export interface RecordListPayload {
  readonly spaceId: DataSpaceId;
  readonly entity: EntityId;
  readonly limit?: number;
  readonly includeDeleted?: boolean;
}

export interface RecordUpdatePayload {
  readonly spaceId: DataSpaceId;
  readonly entity: EntityId;
  readonly recordId: RecordId;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly patch: JsonObject;
}

export interface RecordDeletePayload {
  readonly spaceId: DataSpaceId;
  readonly entity: EntityId;
  readonly recordId: RecordId;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly reason?: string;
}

export interface QueryPayload {
  readonly spaceId: DataSpaceId;
  readonly entity: EntityId;
  readonly select?: readonly string[];
  readonly where?: QueryFilter;
  readonly orderBy?: readonly QueryOrder[];
  readonly limit?: number;
  readonly cursor?: string | null;
  readonly includeDeleted?: boolean;
}

export interface AggregatePayload {
  readonly spaceId: DataSpaceId;
  readonly entity: EntityId;
  readonly where?: QueryFilter;
  readonly metrics: readonly AggregateMetric[];
}

export type TransactionMutationOperation =
  | "data.record.create"
  | "data.record.update"
  | "data.record.delete";

export type TransactionOperation =
  | {
      readonly operation: "data.record.create";
      readonly payload: RecordCreatePayload;
    }
  | {
      readonly operation: "data.record.update";
      readonly payload: RecordUpdatePayload;
    }
  | {
      readonly operation: "data.record.delete";
      readonly payload: RecordDeletePayload;
    };

export interface TransactionExecutePayload {
  readonly idempotencyKey: string;
  readonly operations: readonly TransactionOperation[];
}

export type BulkMutationOperation = TransactionOperation;

export interface BulkPreviewPayload {
  readonly operations: readonly BulkMutationOperation[];
}

export interface BulkExecutePayload {
  readonly idempotencyKey: string;
  readonly expectedPreviewDigest: string;
  readonly operations: readonly BulkMutationOperation[];
}

export interface EventsListPayload {
  readonly spaceId?: DataSpaceId;
  readonly entity?: EntityId;
  readonly recordId?: RecordId;
  readonly after?: string | null;
  readonly limit?: number;
}

export interface DataOperationPayloadMap {
  readonly "data.space.list": SpaceListPayload;
  readonly "data.space.get": SpaceGetPayload;
  readonly "data.space.create": SpaceCreatePayload;
  readonly "data.schema.list": SchemaListPayload;
  readonly "data.schema.get": SchemaGetPayload;
  readonly "data.schema.create": SchemaCreatePayload;
  readonly "data.schema.update": SchemaUpdatePayload;
  readonly "data.schema.migration.preview": SchemaMigrationPreviewPayload;
  readonly "data.schema.migration.execute": SchemaMigrationExecutePayload;
  readonly "data.record.create": RecordCreatePayload;
  readonly "data.record.get": RecordGetPayload;
  readonly "data.record.list": RecordListPayload;
  readonly "data.record.update": RecordUpdatePayload;
  readonly "data.record.delete": RecordDeletePayload;
  readonly "data.query": QueryPayload;
  readonly "data.aggregate": AggregatePayload;
  readonly "data.bulk.preview": BulkPreviewPayload;
  readonly "data.bulk.execute": BulkExecutePayload;
  readonly "data.transaction.execute": TransactionExecutePayload;
  readonly "data.events.list": EventsListPayload;
  readonly "data.doctor": EmptyPayload;
  readonly "data.status": EmptyPayload;
}

export type DataRequestFor<O extends DataOperation> = {
  readonly protocol: "ai-verse-data/0.1";
  readonly requestId: RequestId;
  readonly operation: O;
  readonly scope: DataScope;
  readonly actor: DataActor;
  readonly authorization: DataAuthorization;
  readonly payload: DataOperationPayloadMap[O];
};

export type DataRequestEnvelope = {
  [O in DataOperation]: DataRequestFor<O>;
}[DataOperation];

export interface DataProtocolError {
  readonly code: DataErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: JsonObject;
}

export interface DataSuccessResponse<T extends JsonValue = JsonValue> {
  readonly protocol: "ai-verse-data/0.1";
  readonly requestId: RequestId;
  readonly ok: true;
  readonly result: T;
  readonly warnings: readonly string[];
}

export interface DataFailureResponse {
  readonly protocol: "ai-verse-data/0.1";
  readonly requestId: RequestId;
  readonly ok: false;
  readonly error: DataProtocolError;
}

export type DataResponseEnvelope<T extends JsonValue = JsonValue> =
  | DataSuccessResponse<T>
  | DataFailureResponse;
