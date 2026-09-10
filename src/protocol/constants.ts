export const DATA_PROTOCOL_VERSION = "ai-verse-data/0.1" as const;

export const DATA_OPERATIONS = [
  "data.space.list", "data.space.get", "data.space.create",
  "data.schema.list", "data.schema.get", "data.schema.create", "data.schema.update",
  "data.record.create", "data.record.get", "data.record.list", "data.record.update", "data.record.delete",
  "data.query", "data.aggregate", "data.bulk.preview", "data.bulk.execute", "data.transaction.execute", "data.events.list", "data.doctor", "data.status",
] as const;

export const ACTOR_KINDS = ["human", "bot", "worker", "app", "automation", "system", "import", "connection"] as const;
export const AUTHORIZATION_MODES = ["host-bound", "local-operator"] as const;
export const DATA_AUTHORITY_CLASSES = ["local_canonical"] as const;
export const FIELD_TYPES = ["string", "number", "integer", "boolean", "date", "datetime", "enum", "reference", "json", "attachment_ref"] as const;
export const QUERY_OPERATORS = ["eq", "neq", "lt", "lte", "gt", "gte", "in", "not_in", "contains", "starts_with", "is_null", "is_not_null"] as const;
export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export const AGGREGATE_OPERATORS = ["count", "sum", "min", "max", "avg"] as const;

export const DATA_ERROR_CODES = [
  "REQUEST_INVALID", "OPERATION_UNSUPPORTED", "PAYLOAD_INVALID",
  "DATA_NOT_INSTALLED", "DATA_DISABLED", "WORKSPACE_NOT_FOUND", "WORKSPACE_INACTIVE", "WORKSPACE_ID_MISMATCH",
  "DATA_SPACE_NOT_FOUND", "DATA_SPACE_ALREADY_EXISTS", "ENTITY_NOT_FOUND", "ENTITY_ALREADY_EXISTS", "SCHEMA_INVALID", "SCHEMA_VERSION_NOT_FOUND", "SCHEMA_VERSION_CONFLICT",
  "SCHEMA_MIGRATION_REQUIRED", "RECORD_NOT_FOUND", "RECORD_VERSION_CONFLICT", "FIELD_UNKNOWN", "FIELD_INVALID",
  "REFERENCE_INVALID", "QUERY_INVALID", "QUERY_LIMIT_EXCEEDED", "BULK_INVALID", "BULK_LIMIT_EXCEEDED", "BULK_PREVIEW_STALE", "RECEIPT_NOT_FOUND", "PERMISSION_DENIED", "APPROVAL_REQUIRED",
  "IDEMPOTENCY_CONFLICT", "TRANSACTION_INVALID", "DATABASE_UNAVAILABLE", "DATABASE_CORRUPT", "DATABASE_MIGRATION_REQUIRED",
  "DATABASE_VERSION_UNSUPPORTED", "PATH_UNSAFE", "INTERNAL_ERROR",
] as const;

export const DATA_PROTOCOL_LIMITS = Object.freeze({
  maxRequestBytes: 256 * 1024,
  maxSchemaFields: 128,
  maxFieldNameLength: 64,
  maxDescriptionLength: 4096,
  maxRecordBytes: 128 * 1024,
  maxQueryPageSize: 200,
  defaultQueryPageSize: 50,
  maxFilterDepth: 8,
  maxFilterNodes: 100,
  maxInListLength: 100,
  maxSortKeys: 4,
  maxSelectFields: 128,
  maxAggregateMetrics: 16,
  maxTransactionOperations: 50,
  maxBulkOperations: 50,
  maxBulkBytes: 256 * 1024,
  maxEventPageSize: 200,
  defaultEventPageSize: 100,
  maxAttachmentMetadataBytes: 32 * 1024,
  maxAuthorizationCapabilityRefs: 64,
  maxIdempotencyKeyLength: 256,
  maxIdLength: 128,
  maxEnumValues: 128,
  maxEnumValueLength: 128,
  maxJsonDepth: 16,
  maxArrayItems: 1000,
} as const);
