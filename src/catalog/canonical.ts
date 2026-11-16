import { createHash } from "node:crypto";

import { compareCodeUnits } from "../protocol/code-unit-order.js";
import type { EntitySchemaDefinition, JsonValue } from "../protocol/index.js";

function normalize(
  value: unknown,
  compare: (left: string, right: string) => number = compareCodeUnits,
): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") return value;

  if (Array.isArray(value)) {
    return value.map((item) => normalize(item, compare));
  }

  if (typeof value === "object" && value !== null) {
    const output: Record<string, JsonValue> = {};
    const entries = Object.entries(value).sort(([left], [right]) =>
      compare(left, right),
    );
    for (const [key, item] of entries) {
      if (item !== undefined) output[key] = normalize(item, compare);
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

/**
 * LEGACY READ COMPATIBILITY ONLY. Older versions sorted keys with the machine
 * locale; on English machines that equals localeCompare with "en". Never use
 * this to write a digest or stored JSON. It exists only so a schema digest
 * written by older code is not reported as corrupt.
 */
function legacySchemaDigest(definition: EntitySchemaDefinition): string {
  const legacyJson = JSON.stringify(
    normalize(definition, (left, right) => left.localeCompare(right, "en")),
  );
  return createHash("sha256").update(legacyJson, "utf8").digest("hex");
}

/** True when the stored digest matches the current or the legacy key order. */
export function schemaDigestMatches(
  definition: EntitySchemaDefinition,
  storedDigest: string,
): boolean {
  return (
    schemaDigest(definition) === storedDigest ||
    legacySchemaDigest(definition) === storedDigest
  );
}
