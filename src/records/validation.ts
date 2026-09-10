import {
  ACTOR_KINDS,
  DATA_PROTOCOL_LIMITS,
  type DataActor,
  type EntitySchemaDefinition,
  type FieldDefinition,
  type JsonObject,
  type JsonValue,
  isValidIsoDate,
  validateJsonValue,
} from "../protocol/index.js";
import { DataRecordError } from "./errors.js";

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const ISO_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function own(object: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function fieldError(
  field: string,
  message: string,
  value?: JsonValue,
): never {
  throw new DataRecordError(
    "FIELD_INVALID",
    `Field '${field}' ${message}.`,
    {
      field,
      ...(value === undefined
        ? {}
        : { valueType: value === null ? "null" : Array.isArray(value) ? "array" : typeof value }),
    },
  );
}

function validateSafeId(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > DATA_PROTOCOL_LIMITS.maxIdLength ||
    value === "." ||
    value === ".." ||
    !SAFE_ID_RE.test(value)
  ) {
    fieldError(field, "must be a safe record/reference identifier");
  }
  return value;
}

function validateFieldValue(
  field: string,
  definition: FieldDefinition,
  value: JsonValue,
): void {
  if (value === null) {
    if (definition.nullable !== true) {
      fieldError(field, "does not allow null", value);
    }
    return;
  }

  switch (definition.type) {
    case "string":
      if (typeof value !== "string") fieldError(field, "must be a string", value);
      if (
        definition.minLength !== undefined &&
        value.length < definition.minLength
      ) {
        fieldError(field, `must have length at least ${definition.minLength}`, value);
      }
      if (
        definition.maxLength !== undefined &&
        value.length > definition.maxLength
      ) {
        fieldError(field, `must have length at most ${definition.maxLength}`, value);
      }
      return;

    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        fieldError(field, "must be a finite number", value);
      }
      if (definition.min !== undefined && value < definition.min) {
        fieldError(field, `must be at least ${definition.min}`, value);
      }
      if (definition.max !== undefined && value > definition.max) {
        fieldError(field, `must be at most ${definition.max}`, value);
      }
      return;

    case "integer":
      if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        fieldError(field, "must be a safe integer", value);
      }
      if (definition.min !== undefined && value < definition.min) {
        fieldError(field, `must be at least ${definition.min}`, value);
      }
      if (definition.max !== undefined && value > definition.max) {
        fieldError(field, `must be at most ${definition.max}`, value);
      }
      return;

    case "boolean":
      if (typeof value !== "boolean") fieldError(field, "must be a boolean", value);
      return;

    case "date":
      if (typeof value !== "string" || !isValidIsoDate(value)) {
        fieldError(field, "must be a valid YYYY-MM-DD date", value);
      }
      return;

    case "datetime":
      if (
        typeof value !== "string" ||
        !ISO_DATETIME_RE.test(value) ||
        Number.isNaN(Date.parse(value))
      ) {
        fieldError(field, "must be a valid timezone-qualified ISO datetime", value);
      }
      return;

    case "enum":
      if (
        typeof value !== "string" ||
        !definition.values.includes(value)
      ) {
        fieldError(field, "must be one of the declared enum values", value);
      }
      return;

    case "reference":
    case "attachment_ref":
      validateSafeId(value, field);
      return;

    case "json":
      validateJsonValue(value, `$record.${field}`);
      return;
  }
}

function ensureRecordBytes(data: JsonObject): void {
  const bytes = Buffer.byteLength(JSON.stringify(data), "utf8");
  if (bytes > DATA_PROTOCOL_LIMITS.maxRecordBytes) {
    throw new DataRecordError(
      "FIELD_INVALID",
      `Record exceeds ${DATA_PROTOCOL_LIMITS.maxRecordBytes} bytes after validation/defaults.`,
      { bytes, maxBytes: DATA_PROTOCOL_LIMITS.maxRecordBytes },
    );
  }
}

export function validateRecordActor(actor: DataActor): DataActor {
  if (
    typeof actor !== "object" ||
    actor === null ||
    !(ACTOR_KINDS as readonly string[]).includes(actor.kind) ||
    typeof actor.id !== "string" ||
    actor.id.length < 1 ||
    actor.id.length > DATA_PROTOCOL_LIMITS.maxIdLength ||
    actor.id.includes("\u0000")
  ) {
    throw new DataRecordError(
      "FIELD_INVALID",
      "Record actor is invalid.",
    );
  }

  return { kind: actor.kind, id: actor.id };
}

export function normalizeRecordData(
  schema: EntitySchemaDefinition,
  input: JsonObject,
  options: { readonly applyDefaults: boolean },
): JsonObject {
  const validated = validateJsonValue(input, "$record");
  if (validated === null || Array.isArray(validated) || typeof validated !== "object") {
    throw new DataRecordError("FIELD_INVALID", "Record data must be a JSON object.");
  }

  const output: Record<string, JsonValue> = {};

  for (const [field, value] of Object.entries(validated)) {
    const definition = schema.fields[field];
    if (definition === undefined) {
      if (schema.allowUnknownFields !== true) {
        throw new DataRecordError(
          "FIELD_UNKNOWN",
          `Field '${field}' is not declared by schema '${schema.spaceId}/${schema.entity}'.`,
          { field },
        );
      }
      output[field] = cloneJson(value);
      continue;
    }

    validateFieldValue(field, definition, value);
    output[field] = cloneJson(value);
  }

  for (const [field, definition] of Object.entries(schema.fields)) {
    if (own(output, field)) continue;

    if (options.applyDefaults && own(definition, "default")) {
      const defaultValue = cloneJson(definition.default as JsonValue);
      validateFieldValue(field, definition, defaultValue);
      output[field] = defaultValue;
      continue;
    }

    if (definition.required === true) {
      fieldError(field, "is required");
    }
  }

  ensureRecordBytes(output);
  return output;
}

export function mergeRecordPatch(
  current: JsonObject,
  patch: JsonObject,
): JsonObject {
  const validatedPatch = validateJsonValue(patch, "$patch");
  if (
    validatedPatch === null ||
    Array.isArray(validatedPatch) ||
    typeof validatedPatch !== "object"
  ) {
    throw new DataRecordError("FIELD_INVALID", "Record patch must be a JSON object.");
  }

  if (Object.keys(validatedPatch).length === 0) {
    throw new DataRecordError("FIELD_INVALID", "Record patch must not be empty.");
  }

  return {
    ...cloneJson(current),
    ...cloneJson(validatedPatch),
  };
}

export function validateRecordLimit(limit: number | undefined): number {
  const resolved = limit ?? DATA_PROTOCOL_LIMITS.defaultQueryPageSize;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < 1 ||
    resolved > DATA_PROTOCOL_LIMITS.maxQueryPageSize
  ) {
    throw new DataRecordError(
      "FIELD_INVALID",
      `Record list limit must be an integer in 1..${DATA_PROTOCOL_LIMITS.maxQueryPageSize}.`,
      { limit: resolved },
    );
  }
  return resolved;
}
