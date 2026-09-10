import { createHash } from "node:crypto";

import type { DataActor } from "../protocol/index.js";
import {
  AI_VERSE_DATA_IDEMPOTENCY_FINGERPRINT_VERSION,
} from "../storage/index.js";
import { DataIdempotencyError } from "./errors.js";

function canonicalJson(value: unknown): string {
  if (value === null) return "null";

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new DataIdempotencyError(
        "DATABASE_CORRUPT",
        "Cannot fingerprint a non-finite numeric value.",
      );
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }

  throw new DataIdempotencyError(
    "DATABASE_CORRUPT",
    "Cannot fingerprint a non-JSON-compatible value.",
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function canonicalRequestFingerprint(
  operation: string,
  actor: DataActor,
  request: unknown,
): string {
  const material = canonicalJson({
    fingerprintVersion: AI_VERSE_DATA_IDEMPOTENCY_FINGERPRINT_VERSION,
    operation,
    actor,
    request,
  });
  return sha256(material);
}

export function idempotencyResultDigest(resultJson: string): string {
  return sha256(resultJson);
}

export function canonicalResultJson(value: unknown): string {
  return canonicalJson(value);
}
