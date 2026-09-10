import { createHash } from "node:crypto";

import type { EntitySchemaDefinition, JsonValue } from "../protocol/index.js";

function normalize(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") return value;

  if (Array.isArray(value)) {
    return value.map((item) => normalize(item));
  }

  if (typeof value === "object" && value !== null) {
    const output: Record<string, JsonValue> = {};
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    for (const [key, item] of entries) {
      if (item !== undefined) output[key] = normalize(item);
    }
    return output;
  }

  throw new TypeError("Schema definition contains a non-JSON value.");
}

export function canonicalSchemaJson(
  definition: EntitySchemaDefinition,
): string {
  return JSON.stringify(normalize(definition));
}

export function schemaDigest(definition: EntitySchemaDefinition): string {
  return createHash("sha256")
    .update(canonicalSchemaJson(definition), "utf8")
    .digest("hex");
}

export function cloneSchemaDefinition(
  definition: EntitySchemaDefinition,
): EntitySchemaDefinition {
  return JSON.parse(canonicalSchemaJson(definition)) as EntitySchemaDefinition;
}
