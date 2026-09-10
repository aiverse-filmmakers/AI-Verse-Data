import {
  ACTOR_KINDS,
  AGGREGATE_OPERATORS,
  AUTHORIZATION_MODES,
  DATA_AUTHORITY_CLASSES,
  DATA_ERROR_CODES,
  DATA_OPERATIONS,
  DATA_PROTOCOL_LIMITS,
  DATA_PROTOCOL_VERSION,
  FIELD_TYPES,
  QUERY_OPERATORS,
  SORT_DIRECTIONS,
} from "./constants.js";
import type {
  AggregateMetric,
  AggregatePayload,
  DataErrorCode,
  DataOperation,
  DataRequestEnvelope,
  DataResponseEnvelope,
  DataSpaceDefinition,
  EntitySchemaDefinition,
  FieldDefinition,
  JsonObject,
  JsonValue,
  QueryFilter,
  QueryPayload,
  QueryOrder,
  SchemaChange,
  SchemaUpdatePayload,
  TransactionExecutePayload,
} from "./types.js";

const SLUG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const OPAQUE_PREFIX_RE = /^(req|evt|txn|rcpt)_[A-Za-z0-9][A-Za-z0-9_-]*$/;
const FIELD_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export class DataProtocolValidationError extends Error {
  readonly code: "REQUEST_INVALID" | "OPERATION_UNSUPPORTED" | "PAYLOAD_INVALID";
  readonly path: string;

  constructor(
    code: DataProtocolValidationError["code"],
    path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "DataProtocolValidationError";
    this.code = code;
    this.path = path;
  }
}

function fail(
  path: string,
  message: string,
  code: DataProtocolValidationError["code"] = "PAYLOAD_INVALID",
): never {
  throw new DataProtocolValidationError(code, path, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) fail(path, "must be a plain object");
  return value;
}

function keysOnly(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) fail(`${path}.${key}`, "unknown field");
  }
}

function string(
  value: unknown,
  path: string,
  min: number = 1,
  max: number = DATA_PROTOCOL_LIMITS.maxDescriptionLength,
): string {
  if (typeof value !== "string") fail(path, "must be a string");
  if (value.length < min || value.length > max) {
    fail(path, `length must be ${min}..${max}`);
  }
  if (value.includes("\u0000")) fail(path, "must not contain NUL");
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "must be a boolean");
  return value;
}

function positiveInt(
  value: unknown,
  path: string,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > max) {
    fail(path, `must be an integer in 1..${max}`);
  }
  return value as number;
}

function nonNegativeInt(
  value: unknown,
  path: string,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) {
    fail(path, `must be an integer in 0..${max}`);
  }
  return value as number;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, "must be a finite number");
  }
  return value;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
): T[number] {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    fail(path, `must be one of: ${allowed.join(", ")}`);
  }
  return value as T[number];
}

function safeId(value: unknown, path: string): string {
  const result = string(value, path, 1, DATA_PROTOCOL_LIMITS.maxIdLength);
  if (!SAFE_ID_RE.test(result) || result === "." || result === "..") {
    fail(path, "must be a safe identifier without path separators");
  }
  return result;
}

function slug(value: unknown, path: string): string {
  const result = string(value, path, 1, 64);
  if (!SLUG_RE.test(result)) {
    fail(path, "must be a lowercase slug using letters, digits, and hyphens");
  }
  return result;
}

function fieldName(value: unknown, path: string): string {
  const result = string(value, path, 1, DATA_PROTOCOL_LIMITS.maxFieldNameLength);
  if (!FIELD_NAME_RE.test(result)) {
    fail(
      path,
      "must start with a letter/underscore and contain only letters, digits, underscores",
    );
  }
  return result;
}

function opaqueId(
  value: unknown,
  path: string,
  prefix: "req" | "evt" | "txn" | "rcpt",
): string {
  const result = string(value, path, 5, DATA_PROTOCOL_LIMITS.maxIdLength);
  if (!OPAQUE_PREFIX_RE.test(result) || !result.startsWith(`${prefix}_`)) {
    fail(path, `must be an opaque ${prefix}_ identifier`);
  }
  return result;
}

function validateJsonInternal(
  value: unknown,
  path: string,
  depth: number,
  seen: Set<object>,
): JsonValue {
  if (depth > DATA_PROTOCOL_LIMITS.maxJsonDepth) {
    fail(path, `JSON depth exceeds ${DATA_PROTOCOL_LIMITS.maxJsonDepth}`);
  }

  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, "JSON numbers must be finite");
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length > DATA_PROTOCOL_LIMITS.maxArrayItems) {
      fail(path, `array exceeds ${DATA_PROTOCOL_LIMITS.maxArrayItems} items`);
    }
    if (seen.has(value)) fail(path, "cyclic JSON is not allowed");
    seen.add(value);
    const result = value.map((item, index) =>
      validateJsonInternal(item, `${path}[${index}]`, depth + 1, seen),
    );
    seen.delete(value);
    return result;
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) fail(path, "cyclic JSON is not allowed");
    seen.add(value);
    const output: Record<string, JsonValue> = Object.create(null) as Record<
      string,
      JsonValue
    >;
    for (const [key, item] of Object.entries(value)) {
      if (key.includes("\u0000")) fail(`${path}.${key}`, "key must not contain NUL");
      output[key] = validateJsonInternal(item, `${path}.${key}`, depth + 1, seen);
    }
    seen.delete(value);
    return output;
  }

  fail(path, "must contain JSON-compatible values only");
}

export function validateJsonValue(value: unknown, path = "$json"): JsonValue {
  return validateJsonInternal(value, path, 0, new Set());
}

function jsonObject(value: unknown, path: string, maxBytes?: number): JsonObject {
  const result = validateJsonValue(value, path);
  if (Array.isArray(result) || result === null || typeof result !== "object") {
    fail(path, "must be a JSON object");
  }
  if (
    maxBytes !== undefined &&
    Buffer.byteLength(JSON.stringify(result), "utf8") > maxBytes
  ) {
    fail(path, `JSON object exceeds ${maxBytes} bytes`);
  }
  return result;
}

function validateFieldDefaultCompatibility(
  definition: Record<string, unknown>,
  type: FieldDefinition["type"],
  path: string,
): void {
  if (!Object.prototype.hasOwnProperty.call(definition, "default")) return;

  const value = definition.default;
  const defaultPath = `${path}.default`;

  if (value === null) {
    if (definition.nullable !== true) {
      fail(defaultPath, "null default requires nullable: true");
    }
    return;
  }

  switch (type) {
    case "string": {
      if (typeof value !== "string") fail(defaultPath, "must be a string");
      const minLength =
        typeof definition.minLength === "number" ? definition.minLength : 0;
      const maxLength =
        typeof definition.maxLength === "number"
          ? definition.maxLength
          : 1_000_000;
      if (value.length < minLength || value.length > maxLength) {
        fail(
          defaultPath,
          `length must satisfy declared range ${minLength}..${maxLength}`,
        );
      }
      return;
    }

    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        fail(defaultPath, "must be a finite number");
      }
      if (typeof definition.min === "number" && value < definition.min) {
        fail(defaultPath, "must be greater than or equal to declared min");
      }
      if (typeof definition.max === "number" && value > definition.max) {
        fail(defaultPath, "must be less than or equal to declared max");
      }
      return;
    }

    case "integer": {
      if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        fail(defaultPath, "must be a safe integer");
      }
      if (typeof definition.min === "number" && value < definition.min) {
        fail(defaultPath, "must be greater than or equal to declared min");
      }
      if (typeof definition.max === "number" && value > definition.max) {
        fail(defaultPath, "must be less than or equal to declared max");
      }
      return;
    }

    case "boolean":
      if (typeof value !== "boolean") fail(defaultPath, "must be a boolean");
      return;

    case "date":
      if (typeof value !== "string" || !isValidIsoDate(value)) {
        fail(defaultPath, "must be a valid YYYY-MM-DD date");
      }
      return;

    case "datetime":
      if (
        typeof value !== "string" ||
        !ISO_DATETIME_RE.test(value) ||
        Number.isNaN(Date.parse(value))
      ) {
        fail(defaultPath, "must be a valid timezone-qualified ISO datetime");
      }
      return;

    case "enum":
      if (
        typeof value !== "string" ||
        !Array.isArray(definition.values) ||
        !definition.values.includes(value)
      ) {
        fail(defaultPath, "must be one of the declared enum values");
      }
      return;

    case "reference":
    case "attachment_ref":
      safeId(value, defaultPath);
      return;

    case "json":
      validateJsonValue(value, defaultPath);
      return;
  }
}

export function validateFieldDefinition(
  input: unknown,
  path = "$field",
): FieldDefinition {
  const value = object(input, path);
  const type = oneOf(value.type, FIELD_TYPES, `${path}.type`);
  const common = ["type", "required", "nullable", "description", "default"];

  if (value.required !== undefined) boolean(value.required, `${path}.required`);
  if (value.nullable !== undefined) boolean(value.nullable, `${path}.nullable`);
  if (value.description !== undefined) {
    string(
      value.description,
      `${path}.description`,
      0,
      DATA_PROTOCOL_LIMITS.maxDescriptionLength,
    );
  }
  if (value.default !== undefined) validateJsonValue(value.default, `${path}.default`);

  switch (type) {
    case "string":
      keysOnly(value, [...common, "minLength", "maxLength"], path);
      if (value.minLength !== undefined) {
        nonNegativeInt(value.minLength, `${path}.minLength`, 1_000_000);
      }
      if (value.maxLength !== undefined) {
        positiveInt(value.maxLength, `${path}.maxLength`, 1_000_000);
      }
      if (
        typeof value.minLength === "number" &&
        typeof value.maxLength === "number" &&
        value.minLength > value.maxLength
      ) {
        fail(path, "minLength cannot exceed maxLength");
      }
      break;

    case "number":
    case "integer":
      keysOnly(value, [...common, "min", "max"], path);
      if (value.min !== undefined) finiteNumber(value.min, `${path}.min`);
      if (value.max !== undefined) finiteNumber(value.max, `${path}.max`);
      if (
        type === "integer" &&
        value.min !== undefined &&
        !Number.isSafeInteger(value.min)
      ) {
        fail(`${path}.min`, "must be a safe integer");
      }
      if (
        type === "integer" &&
        value.max !== undefined &&
        !Number.isSafeInteger(value.max)
      ) {
        fail(`${path}.max`, "must be a safe integer");
      }
      if (
        typeof value.min === "number" &&
        typeof value.max === "number" &&
        value.min > value.max
      ) {
        fail(path, "min cannot exceed max");
      }
      break;

    case "enum": {
      keysOnly(value, [...common, "values"], path);
      if (
        !Array.isArray(value.values) ||
        value.values.length < 1 ||
        value.values.length > DATA_PROTOCOL_LIMITS.maxEnumValues
      ) {
        fail(
          `${path}.values`,
          `must contain 1..${DATA_PROTOCOL_LIMITS.maxEnumValues} values`,
        );
      }
      const seen = new Set<string>();
      value.values.forEach((item, index) => {
        const parsed = string(
          item,
          `${path}.values[${index}]`,
          1,
          DATA_PROTOCOL_LIMITS.maxEnumValueLength,
        );
        if (seen.has(parsed)) fail(`${path}.values[${index}]`, "duplicate enum value");
        seen.add(parsed);
      });
      break;
    }

    case "reference":
      keysOnly(value, [...common, "entity", "spaceId"], path);
      slug(value.entity, `${path}.entity`);
      if (value.spaceId !== undefined) slug(value.spaceId, `${path}.spaceId`);
      break;

    case "boolean":
    case "date":
    case "datetime":
    case "json":
    case "attachment_ref":
      keysOnly(value, common, path);
      break;
  }

  validateFieldDefaultCompatibility(value, type, path);
  return input as FieldDefinition;
}

function validateFields(
  input: unknown,
  path: string,
): Readonly<Record<string, FieldDefinition>> {
  const value = object(input, path);
  const entries = Object.entries(value);
  if (
    entries.length < 1 ||
    entries.length > DATA_PROTOCOL_LIMITS.maxSchemaFields
  ) {
    fail(
      path,
      `must contain 1..${DATA_PROTOCOL_LIMITS.maxSchemaFields} fields`,
    );
  }

  for (const [key, definition] of entries) {
    fieldName(key, `${path}.${key}<name>`);
    validateFieldDefinition(definition, `${path}.${key}`);
  }
  return input as Readonly<Record<string, FieldDefinition>>;
}

function validateScope(input: unknown): void {
  const value = object(input, "$.scope");
  keysOnly(value, ["workspaceId"], "$.scope");
  safeId(value.workspaceId, "$.scope.workspaceId");
}

function validateActor(input: unknown): void {
  const value = object(input, "$.actor");
  keysOnly(value, ["kind", "id"], "$.actor");
  oneOf(value.kind, ACTOR_KINDS, "$.actor.kind");
  safeId(value.id, "$.actor.id");
}

function validateAuthorization(input: unknown): void {
  const value = object(input, "$.authorization");
  keysOnly(value, ["mode", "capabilityRefs"], "$.authorization");
  oneOf(value.mode, AUTHORIZATION_MODES, "$.authorization.mode");

  if (value.capabilityRefs !== undefined) {
    if (
      !Array.isArray(value.capabilityRefs) ||
      value.capabilityRefs.length > DATA_PROTOCOL_LIMITS.maxAuthorizationCapabilityRefs
    ) {
      fail(
        "$.authorization.capabilityRefs",
        `must be an array of at most ${DATA_PROTOCOL_LIMITS.maxAuthorizationCapabilityRefs}`,
      );
    }
    value.capabilityRefs.forEach((item, index) =>
      safeId(item, `$.authorization.capabilityRefs[${index}]`),
    );
  }
}

function requireSpaceEntity(value: Record<string, unknown>, path: string): void {
  slug(value.spaceId, `${path}.spaceId`);
  slug(value.entity, `${path}.entity`);
}

function validateIdempotency(value: unknown, path: string): void {
  string(value, path, 1, DATA_PROTOCOL_LIMITS.maxIdempotencyKeyLength);
}

function validateCursor(value: unknown, path: string): void {
  if (value !== null) string(value, path, 1, 2048);
}

function validateCondition(value: Record<string, unknown>, path: string): void {
  keysOnly(value, ["field", "op", "value"], path);
  fieldName(value.field, `${path}.field`);
  const op = oneOf(value.op, QUERY_OPERATORS, `${path}.op`);

  if (op === "is_null" || op === "is_not_null") {
    if (value.value !== undefined) {
      fail(`${path}.value`, `${op} must not include value`);
    }
  } else {
    if (value.value === undefined) fail(`${path}.value`, `is required for ${op}`);
    const parsed = validateJsonValue(value.value, `${path}.value`);
    if (
      (op === "in" || op === "not_in") &&
      (!Array.isArray(parsed) ||
        parsed.length < 1 ||
        parsed.length > DATA_PROTOCOL_LIMITS.maxInListLength)
    ) {
      fail(
        `${path}.value`,
        `must be a non-empty array up to ${DATA_PROTOCOL_LIMITS.maxInListLength} items`,
      );
    }
  }
}

function validateFilterInternal(
  input: unknown,
  path: string,
  depth: number,
  counter: { count: number },
): void {
  if (depth > DATA_PROTOCOL_LIMITS.maxFilterDepth) {
    fail(path, `filter depth exceeds ${DATA_PROTOCOL_LIMITS.maxFilterDepth}`);
  }

  counter.count += 1;
  if (counter.count > DATA_PROTOCOL_LIMITS.maxFilterNodes) {
    fail(path, `filter exceeds ${DATA_PROTOCOL_LIMITS.maxFilterNodes} nodes`);
  }

  const value = object(input, path);
  const hasField = "field" in value || "op" in value;
  const groupKeys = ["and", "or", "not"].filter((key) => key in value);

  if (hasField) {
    if (groupKeys.length > 0) {
      fail(path, "condition cannot also be a boolean group");
    }
    validateCondition(value, path);
    return;
  }

  if (groupKeys.length !== 1) {
    fail(path, "must contain exactly one of field/op condition, and, or, or not");
  }

  const key = groupKeys[0];
  if (key === "not") {
    keysOnly(value, ["not"], path);
    validateFilterInternal(value.not, `${path}.not`, depth + 1, counter);
    return;
  }

  keysOnly(value, [key as string], path);
  const list = value[key as string];
  if (!Array.isArray(list) || list.length < 1) {
    fail(`${path}.${key}`, "must be a non-empty array");
  }
  for (let index = 0; index < list.length; index += 1) {
    validateFilterInternal(
      list[index],
      `${path}.${key}[${index}]`,
      depth + 1,
      counter,
    );
  }
}

export function validateQueryFilter(
  input: unknown,
  path = "$filter",
): QueryFilter {
  validateFilterInternal(input, path, 0, { count: 0 });
  return input as QueryFilter;
}

function validateOrderBy(input: unknown, path: string): readonly QueryOrder[] {
  if (!Array.isArray(input) || input.length > DATA_PROTOCOL_LIMITS.maxSortKeys) {
    fail(path, `must be an array of at most ${DATA_PROTOCOL_LIMITS.maxSortKeys}`);
  }
  input.forEach((item, index) => {
    const value = object(item, `${path}[${index}]`);
    keysOnly(value, ["field", "direction"], `${path}[${index}]`);
    fieldName(value.field, `${path}[${index}].field`);
    oneOf(value.direction, SORT_DIRECTIONS, `${path}[${index}].direction`);
  });
  return input as readonly QueryOrder[];
}

function validateMetrics(input: unknown, path: string): readonly AggregateMetric[] {
  if (
    !Array.isArray(input) ||
    input.length < 1 ||
    input.length > DATA_PROTOCOL_LIMITS.maxAggregateMetrics
  ) {
    fail(
      path,
      `must contain 1..${DATA_PROTOCOL_LIMITS.maxAggregateMetrics} metrics`,
    );
  }

  input.forEach((item, index) => {
    const value = object(item, `${path}[${index}]`);
    keysOnly(value, ["op", "field", "as"], `${path}[${index}]`);
    const op = oneOf(
      value.op,
      AGGREGATE_OPERATORS,
      `${path}[${index}].op`,
    );
    if (op !== "count" && value.field === undefined) {
      fail(`${path}[${index}].field`, `is required for ${op}`);
    }
    if (value.field !== undefined) {
      fieldName(value.field, `${path}[${index}].field`);
    }
    fieldName(value.as, `${path}[${index}].as`);
  });

  return input as readonly AggregateMetric[];
}

function validateSchemaChange(input: unknown, path: string): SchemaChange {
  const value = object(input, path);
  const op = string(value.op, `${path}.op`, 1, 64);

  if (op === "add_field") {
    keysOnly(value, ["op", "field", "definition"], path);
    fieldName(value.field, `${path}.field`);
    validateFieldDefinition(value.definition, `${path}.definition`);
  } else if (op === "set_name") {
    keysOnly(value, ["op", "name"], path);
    string(value.name, `${path}.name`, 1, 256);
  } else if (op === "set_description") {
    keysOnly(value, ["op", "description"], path);
    string(
      value.description,
      `${path}.description`,
      0,
      DATA_PROTOCOL_LIMITS.maxDescriptionLength,
    );
  } else if (op === "remove_field") {
    keysOnly(value, ["op", "field"], path);
    fieldName(value.field, `${path}.field`);
  } else if (op === "replace_field") {
    keysOnly(value, ["op", "field", "definition"], path);
    fieldName(value.field, `${path}.field`);
    validateFieldDefinition(value.definition, `${path}.definition`);
  } else if (op === "rename_field") {
    keysOnly(value, ["op", "field", "newField"], path);
    fieldName(value.field, `${path}.field`);
    fieldName(value.newField, `${path}.newField`);
  } else {
    fail(`${path}.op`, "unsupported schema change");
  }

  return input as SchemaChange;
}

export function validateDataSpaceDefinition(
  input: unknown,
  path = "$space",
): DataSpaceDefinition {
  const value = object(input, path);
  keysOnly(value, ["spaceId", "name", "description", "authority"], path);
  slug(value.spaceId, `${path}.spaceId`);
  string(value.name, `${path}.name`, 1, 256);
  if (value.description !== undefined) {
    string(
      value.description,
      `${path}.description`,
      0,
      DATA_PROTOCOL_LIMITS.maxDescriptionLength,
    );
  }
  oneOf(value.authority, DATA_AUTHORITY_CLASSES, `${path}.authority`);
  return input as DataSpaceDefinition;
}

export function validateEntitySchemaDefinition(
  input: unknown,
  path = "$schema",
): EntitySchemaDefinition {
  const value = object(input, path);
  keysOnly(
    value,
    ["spaceId", "entity", "name", "description", "fields", "allowUnknownFields"],
    path,
  );
  requireSpaceEntity(value, path);
  string(value.name, `${path}.name`, 1, 256);
  if (value.description !== undefined) {
    string(
      value.description,
      `${path}.description`,
      0,
      DATA_PROTOCOL_LIMITS.maxDescriptionLength,
    );
  }
  validateFields(value.fields, `${path}.fields`);
  if (value.allowUnknownFields !== undefined) {
    boolean(value.allowUnknownFields, `${path}.allowUnknownFields`);
  }
  return input as EntitySchemaDefinition;
}

export function validateSchemaUpdatePayload(
  input: unknown,
  path = "$schemaUpdate",
): SchemaUpdatePayload {
  const value = object(input, path);
  keysOnly(
    value,
    ["spaceId", "entity", "expectedSchemaVersion", "changes"],
    path,
  );
  requireSpaceEntity(value, path);
  positiveInt(value.expectedSchemaVersion, `${path}.expectedSchemaVersion`);
  if (
    !Array.isArray(value.changes) ||
    value.changes.length < 1 ||
    value.changes.length > DATA_PROTOCOL_LIMITS.maxSchemaFields
  ) {
    fail(
      `${path}.changes`,
      `must contain 1..${DATA_PROTOCOL_LIMITS.maxSchemaFields} changes`,
    );
  }
  value.changes.forEach((item, index) =>
    validateSchemaChange(item, `${path}.changes[${index}]`),
  );
  return input as SchemaUpdatePayload;
}

export function validateQueryPayload(
  input: unknown,
  path = "$query",
): QueryPayload {
  const value = object(input, path);
  keysOnly(
    value,
    ["spaceId", "entity", "select", "where", "orderBy", "limit", "cursor", "includeDeleted"],
    path,
  );
  requireSpaceEntity(value, path);
  if (value.select !== undefined) {
    if (
      !Array.isArray(value.select) ||
      value.select.length > DATA_PROTOCOL_LIMITS.maxSelectFields
    ) {
      fail(
        `${path}.select`,
        `must be an array of at most ${DATA_PROTOCOL_LIMITS.maxSelectFields}`,
      );
    }
    value.select.forEach((item, index) =>
      fieldName(item, `${path}.select[${index}]`),
    );
  }
  if (value.where !== undefined) validateQueryFilter(value.where, `${path}.where`);
  if (value.orderBy !== undefined) validateOrderBy(value.orderBy, `${path}.orderBy`);
  if (value.limit !== undefined) {
    positiveInt(value.limit, `${path}.limit`, DATA_PROTOCOL_LIMITS.maxQueryPageSize);
  }
  if (value.cursor !== undefined) validateCursor(value.cursor, `${path}.cursor`);
  if (value.includeDeleted !== undefined) {
    boolean(value.includeDeleted, `${path}.includeDeleted`);
  }
  return input as QueryPayload;
}

export function validateAggregatePayload(
  input: unknown,
  path = "$aggregate",
): AggregatePayload {
  const value = object(input, path);
  keysOnly(value, ["spaceId", "entity", "where", "metrics"], path);
  requireSpaceEntity(value, path);
  if (value.where !== undefined) validateQueryFilter(value.where, `${path}.where`);
  validateMetrics(value.metrics, `${path}.metrics`);
  return input as AggregatePayload;
}

export function validateTransactionExecutePayload(
  input: unknown,
  path = "$transaction",
): TransactionExecutePayload {
  const value = object(input, path);
  keysOnly(value, ["idempotencyKey", "operations"], path);
  validateIdempotency(value.idempotencyKey, `${path}.idempotencyKey`);
  if (
    !Array.isArray(value.operations) ||
    value.operations.length < 1 ||
    value.operations.length > DATA_PROTOCOL_LIMITS.maxTransactionOperations
  ) {
    fail(
      `${path}.operations`,
      `must contain 1..${DATA_PROTOCOL_LIMITS.maxTransactionOperations} operations`,
    );
  }
  value.operations.forEach((item, index) => {
    const nested = object(item, `${path}.operations[${index}]`);
    keysOnly(nested, ["operation", "payload"], `${path}.operations[${index}]`);
    const nestedOperation = nested.operation;
    if (
      nestedOperation !== "data.record.create" &&
      nestedOperation !== "data.record.update" &&
      nestedOperation !== "data.record.delete"
    ) {
      fail(
        `${path}.operations[${index}].operation`,
        "must be a supported record mutation",
      );
    }
    validatePayload(nestedOperation, nested.payload);
  });
  return input as TransactionExecutePayload;
}

function validatePayload(operation: DataOperation, input: unknown): void {
  const path = "$.payload";
  const value = object(input, path);

  switch (operation) {
    case "data.space.list":
    case "data.doctor":
    case "data.status":
      keysOnly(value, [], path);
      return;

    case "data.space.get":
      keysOnly(value, ["spaceId"], path);
      slug(value.spaceId, `${path}.spaceId`);
      return;

    case "data.space.create":
      validateDataSpaceDefinition(value, path);
      return;

    case "data.schema.list":
      keysOnly(value, ["spaceId"], path);
      slug(value.spaceId, `${path}.spaceId`);
      return;

    case "data.schema.get":
      keysOnly(value, ["spaceId", "entity", "version"], path);
      requireSpaceEntity(value, path);
      if (value.version !== undefined && value.version !== "current") {
        positiveInt(value.version, `${path}.version`);
      }
      return;

    case "data.schema.create":
      validateEntitySchemaDefinition(value, path);
      return;

    case "data.schema.update":
      validateSchemaUpdatePayload(value, path);
      return;

    case "data.record.create":
      keysOnly(
        value,
        ["spaceId", "entity", "idempotencyKey", "data", "clientRef"],
        path,
      );
      requireSpaceEntity(value, path);
      validateIdempotency(value.idempotencyKey, `${path}.idempotencyKey`);
      jsonObject(value.data, `${path}.data`, DATA_PROTOCOL_LIMITS.maxRecordBytes);
      if (value.clientRef !== undefined) safeId(value.clientRef, `${path}.clientRef`);
      return;

    case "data.record.get":
      keysOnly(value, ["spaceId", "entity", "recordId", "includeDeleted"], path);
      requireSpaceEntity(value, path);
      safeId(value.recordId, `${path}.recordId`);
      if (value.includeDeleted !== undefined) {
        boolean(value.includeDeleted, `${path}.includeDeleted`);
      }
      return;

    case "data.record.list":
      keysOnly(
        value,
        ["spaceId", "entity", "limit", "cursor", "includeDeleted"],
        path,
      );
      requireSpaceEntity(value, path);
      if (value.limit !== undefined) {
        positiveInt(value.limit, `${path}.limit`, DATA_PROTOCOL_LIMITS.maxQueryPageSize);
      }
      if (value.cursor !== undefined) validateCursor(value.cursor, `${path}.cursor`);
      if (value.includeDeleted !== undefined) {
        boolean(value.includeDeleted, `${path}.includeDeleted`);
      }
      return;

    case "data.record.update":
      keysOnly(
        value,
        ["spaceId", "entity", "recordId", "expectedVersion", "idempotencyKey", "patch"],
        path,
      );
      requireSpaceEntity(value, path);
      safeId(value.recordId, `${path}.recordId`);
      positiveInt(value.expectedVersion, `${path}.expectedVersion`);
      validateIdempotency(value.idempotencyKey, `${path}.idempotencyKey`);
      jsonObject(value.patch, `${path}.patch`, DATA_PROTOCOL_LIMITS.maxRecordBytes);
      return;

    case "data.record.delete":
      keysOnly(
        value,
        ["spaceId", "entity", "recordId", "expectedVersion", "idempotencyKey", "reason"],
        path,
      );
      requireSpaceEntity(value, path);
      safeId(value.recordId, `${path}.recordId`);
      positiveInt(value.expectedVersion, `${path}.expectedVersion`);
      validateIdempotency(value.idempotencyKey, `${path}.idempotencyKey`);
      if (value.reason !== undefined) {
        string(value.reason, `${path}.reason`, 1, 1024);
      }
      return;

    case "data.query":
      validateQueryPayload(value, path);
      return;

    case "data.aggregate":
      validateAggregatePayload(value, path);
      return;

    case "data.transaction.execute":
      validateTransactionExecutePayload(value, path);
      return;

    case "data.events.list":
      keysOnly(value, ["spaceId", "entity", "recordId", "after", "limit"], path);
      slug(value.spaceId, `${path}.spaceId`);
      if (value.entity !== undefined) slug(value.entity, `${path}.entity`);
      if (value.recordId !== undefined) safeId(value.recordId, `${path}.recordId`);
      if (value.after !== undefined) validateCursor(value.after, `${path}.after`);
      if (value.limit !== undefined) {
        positiveInt(value.limit, `${path}.limit`, DATA_PROTOCOL_LIMITS.maxEventPageSize);
      }
      return;
  }
}

export function validateRequestEnvelope(input: unknown): DataRequestEnvelope {
  const bytes = (() => {
    try {
      return Buffer.byteLength(JSON.stringify(input), "utf8");
    } catch {
      fail("$", "request must be JSON-serializable", "REQUEST_INVALID");
    }
  })();

  if (bytes > DATA_PROTOCOL_LIMITS.maxRequestBytes) {
    fail(
      "$",
      `request exceeds ${DATA_PROTOCOL_LIMITS.maxRequestBytes} bytes`,
      "REQUEST_INVALID",
    );
  }

  const value = object(input, "$");
  keysOnly(
    value,
    ["protocol", "requestId", "operation", "scope", "actor", "authorization", "payload"],
    "$",
  );

  if (value.protocol !== DATA_PROTOCOL_VERSION) {
    fail(
      "$.protocol",
      `must equal ${DATA_PROTOCOL_VERSION}`,
      "REQUEST_INVALID",
    );
  }

  opaqueId(value.requestId, "$.requestId", "req");

  if (
    typeof value.operation !== "string" ||
    !(DATA_OPERATIONS as readonly string[]).includes(value.operation)
  ) {
    fail("$.operation", "unsupported Data operation", "OPERATION_UNSUPPORTED");
  }

  const operation = value.operation as DataOperation;
  validateScope(value.scope);
  validateActor(value.actor);
  validateAuthorization(value.authorization);
  validatePayload(operation, value.payload);
  return input as DataRequestEnvelope;
}

export function validateResponseEnvelope(input: unknown): DataResponseEnvelope {
  const value = object(input, "$response");

  if (value.protocol !== DATA_PROTOCOL_VERSION) {
    fail(
      "$response.protocol",
      `must equal ${DATA_PROTOCOL_VERSION}`,
      "REQUEST_INVALID",
    );
  }

  opaqueId(value.requestId, "$response.requestId", "req");

  if (value.ok === true) {
    keysOnly(
      value,
      ["protocol", "requestId", "ok", "result", "warnings"],
      "$response",
    );
    validateJsonValue(value.result, "$response.result");
    if (!Array.isArray(value.warnings)) {
      fail("$response.warnings", "must be an array");
    }
    value.warnings.forEach((item, index) =>
      string(item, `$response.warnings[${index}]`, 1, 4096),
    );
  } else if (value.ok === false) {
    keysOnly(value, ["protocol", "requestId", "ok", "error"], "$response");
    const error = object(value.error, "$response.error");
    keysOnly(
      error,
      ["code", "message", "retryable", "details"],
      "$response.error",
    );
    oneOf(error.code, DATA_ERROR_CODES, "$response.error.code") as DataErrorCode;
    string(error.message, "$response.error.message", 1, 4096);
    boolean(error.retryable, "$response.error.retryable");
    if (error.details !== undefined) {
      jsonObject(error.details, "$response.error.details", 64 * 1024);
    }
  } else {
    fail("$response.ok", "must be true or false", "REQUEST_INVALID");
  }

  return input as DataResponseEnvelope;
}

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
