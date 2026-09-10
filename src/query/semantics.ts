import type {
  AggregateMetric,
  AggregatePayload,
  EntitySchemaDefinition,
  FieldDefinition,
  JsonValue,
  QueryFilter,
  QueryOperator,
  QueryOrder,
  QueryPayload,
} from "../protocol/index.js";
import { DataQueryError } from "./errors.js";

function fieldDefinition(
  schema: EntitySchemaDefinition,
  field: string,
): FieldDefinition {
  const definition = schema.fields[field];
  if (definition === undefined) {
    throw new DataQueryError(
      "QUERY_INVALID",
      `Field '${field}' is not declared by schema '${schema.spaceId}/${schema.entity}'.`,
      { field },
    );
  }
  return definition;
}

function isComparableType(type: FieldDefinition["type"]): boolean {
  return (
    type === "string" ||
    type === "number" ||
    type === "integer" ||
    type === "date" ||
    type === "datetime"
  );
}

function isScalarEqualityType(type: FieldDefinition["type"]): boolean {
  return type !== "json";
}

function validateScalarValue(
  definition: FieldDefinition,
  value: JsonValue,
  field: string,
): void {
  if (value === null) {
    throw new DataQueryError(
      "QUERY_INVALID",
      `Field '${field}' comparisons to null must use is_null/is_not_null.`,
      { field },
    );
  }

  switch (definition.type) {
    case "string":
      if (typeof value !== "string") invalidType(field, "string");
      return;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        invalidType(field, "finite number");
      }
      return;
    case "integer":
      if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        invalidType(field, "integer");
      }
      return;
    case "boolean":
      if (typeof value !== "boolean") invalidType(field, "boolean");
      return;
    case "date":
      if (typeof value !== "string" || !isValidIsoDate(value)) {
        invalidType(field, "YYYY-MM-DD date");
      }
      return;
    case "datetime":
      if (
        typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
        Number.isNaN(Date.parse(value))
      ) {
        invalidType(field, "timezone-qualified ISO datetime");
      }
      return;
    case "enum":
      if (
        typeof value !== "string" ||
        !definition.values.includes(value)
      ) {
        throw new DataQueryError(
          "QUERY_INVALID",
          `Field '${field}' query value must be a declared enum member.`,
          { field },
        );
      }
      return;
    case "reference":
    case "attachment_ref":
      if (
        typeof value !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
      ) {
        invalidType(field, "safe identifier");
      }
      return;
    case "json":
      throw new DataQueryError(
        "QUERY_INVALID",
        `JSON field '${field}' only supports is_null/is_not_null in v0.1.`,
        { field },
      );
  }
}

function invalidType(field: string, expected: string): never {
  throw new DataQueryError(
    "QUERY_INVALID",
    `Query value for field '${field}' must be ${expected}.`,
    { field },
  );
}

function validateCondition(
  filter: Extract<QueryFilter, { readonly field: string }>,
  schema: EntitySchemaDefinition,
): void {
  const definition = fieldDefinition(schema, filter.field);
  const op = filter.op;

  if (op === "is_null" || op === "is_not_null") return;

  if (op === "contains" || op === "starts_with") {
    if (definition.type !== "string") {
      throw invalidOperator(filter.field, op, definition.type);
    }
    if (typeof filter.value !== "string") invalidType(filter.field, "string");
    return;
  }

  if (op === "lt" || op === "lte" || op === "gt" || op === "gte") {
    if (!isComparableType(definition.type)) {
      throw invalidOperator(filter.field, op, definition.type);
    }
    validateScalarValue(definition, filter.value as JsonValue, filter.field);
    return;
  }

  if (op === "in" || op === "not_in") {
    if (!isScalarEqualityType(definition.type)) {
      throw invalidOperator(filter.field, op, definition.type);
    }
    if (!Array.isArray(filter.value)) {
      invalidType(filter.field, "array");
    }
    for (const value of filter.value) {
      validateScalarValue(definition, value, filter.field);
    }
    return;
  }

  if (op === "eq" || op === "neq") {
    if (!isScalarEqualityType(definition.type)) {
      throw invalidOperator(filter.field, op, definition.type);
    }
    validateScalarValue(definition, filter.value as JsonValue, filter.field);
    return;
  }

  const exhaustive: never = op;
  throw new DataQueryError(
    "QUERY_INVALID",
    `Unsupported query operator '${String(exhaustive)}'.`,
  );
}

function invalidOperator(
  field: string,
  op: QueryOperator,
  type: FieldDefinition["type"],
): DataQueryError {
  return new DataQueryError(
    "QUERY_INVALID",
    `Operator '${op}' is not valid for field '${field}' of type '${type}'.`,
    { field, operator: op, fieldType: type },
  );
}

function walkFilter(
  filter: QueryFilter,
  schema: EntitySchemaDefinition,
): void {
  if ("field" in filter) {
    validateCondition(filter, schema);
    return;
  }
  if ("and" in filter) {
    for (const child of filter.and) walkFilter(child, schema);
    return;
  }
  if ("or" in filter) {
    for (const child of filter.or) walkFilter(child, schema);
    return;
  }
  walkFilter(filter.not, schema);
}

function validateSelection(
  select: readonly string[] | undefined,
  schema: EntitySchemaDefinition,
): void {
  if (select === undefined) return;
  const seen = new Set<string>();
  for (const field of select) {
    fieldDefinition(schema, field);
    if (seen.has(field)) {
      throw new DataQueryError(
        "QUERY_INVALID",
        `Selected field '${field}' is duplicated.`,
        { field },
      );
    }
    seen.add(field);
  }
}

function validateOrder(
  orderBy: readonly QueryOrder[] | undefined,
  schema: EntitySchemaDefinition,
): void {
  if (orderBy === undefined) return;
  const seen = new Set<string>();
  for (const order of orderBy) {
    const definition = fieldDefinition(schema, order.field);
    if (definition.type === "json") {
      throw invalidOperator(order.field, "eq", definition.type);
    }
    if (seen.has(order.field)) {
      throw new DataQueryError(
        "QUERY_INVALID",
        `Sort field '${order.field}' is duplicated.`,
        { field: order.field },
      );
    }
    seen.add(order.field);
  }
}

function validateMetric(
  metric: AggregateMetric,
  schema: EntitySchemaDefinition,
): void {
  if (metric.op === "count") {
    if (metric.field !== undefined) {
      throw new DataQueryError(
        "QUERY_INVALID",
        `Aggregate '${metric.as}' uses count with a field; v0.1 count counts matching records and must omit field.`,
        { alias: metric.as },
      );
    }
    return;
  }

  if (metric.field === undefined) {
    throw new DataQueryError(
      "QUERY_INVALID",
      `Aggregate '${metric.as}' requires a field.`,
      { alias: metric.as },
    );
  }

  const definition = fieldDefinition(schema, metric.field);
  if (
    (metric.op === "sum" || metric.op === "avg") &&
    definition.type !== "number" &&
    definition.type !== "integer"
  ) {
    throw new DataQueryError(
      "QUERY_INVALID",
      `Aggregate '${metric.op}' requires a numeric field.`,
      { alias: metric.as, field: metric.field, fieldType: definition.type },
    );
  }

  if (
    (metric.op === "min" || metric.op === "max") &&
    !isComparableType(definition.type)
  ) {
    throw new DataQueryError(
      "QUERY_INVALID",
      `Aggregate '${metric.op}' is not supported for field type '${definition.type}'.`,
      { alias: metric.as, field: metric.field, fieldType: definition.type },
    );
  }
}

export function validateQuerySemantics(
  input: QueryPayload,
  schema: EntitySchemaDefinition,
): void {
  validateSelection(input.select, schema);
  validateOrder(input.orderBy, schema);
  if (input.where !== undefined) walkFilter(input.where, schema);
}

export function validateAggregateSemantics(
  input: AggregatePayload,
  schema: EntitySchemaDefinition,
): void {
  if (input.where !== undefined) walkFilter(input.where, schema);

  const aliases = new Set<string>();
  for (const metric of input.metrics) {
    if (aliases.has(metric.as)) {
      throw new DataQueryError(
        "QUERY_INVALID",
        `Aggregate alias '${metric.as}' is duplicated.`,
        { alias: metric.as },
      );
    }
    aliases.add(metric.as);
    validateMetric(metric, schema);
  }
}
