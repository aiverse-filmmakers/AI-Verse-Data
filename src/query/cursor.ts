import { createHash } from "node:crypto";

import type { QueryPayload } from "../protocol/index.js";
import { DataQueryError } from "./errors.js";
import type { QueryCursorPayload } from "./types.js";

export const MAX_QUERY_OFFSET = 100_000 as const;

function canonicalize(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) return value.map(canonicalize);

  if (typeof value === "object" && value !== null) {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) output[key] = canonicalize(item);
    }
    return output;
  }

  throw new DataQueryError("QUERY_INVALID", "Query contains a non-JSON cursor fingerprint value.");
}

export function queryFingerprint(input: QueryPayload, limit: number): string {
  const basis = {
    spaceId: input.spaceId,
    entity: input.entity,
    select: input.select ?? null,
    where: input.where ?? null,
    orderBy: input.orderBy ?? [],
    limit,
    includeDeleted: input.includeDeleted ?? false,
  };
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(basis)), "utf8")
    .digest("hex");
}

export function encodeQueryCursor(
  offset: number,
  fingerprint: string,
): string {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_QUERY_OFFSET) {
    throw new DataQueryError(
      "QUERY_LIMIT_EXCEEDED",
      `Query cursor offset must remain within 0..${MAX_QUERY_OFFSET}.`,
      { offset, maxOffset: MAX_QUERY_OFFSET },
    );
  }

  const payload: QueryCursorPayload = {
    version: 1,
    offset,
    fingerprint,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeQueryCursor(
  cursor: string | null | undefined,
  expectedFingerprint: string,
): number {
  if (cursor === undefined || cursor === null) return 0;

  let parsed: unknown;
  try {
    const text = Buffer.from(cursor, "base64url").toString("utf8");
    parsed = JSON.parse(text);
  } catch (error) {
    throw new DataQueryError(
      "QUERY_INVALID",
      "Query cursor is malformed.",
      undefined,
      error,
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new DataQueryError("QUERY_INVALID", "Query cursor payload is invalid.");
  }

  const value = parsed as Record<string, unknown>;
  if (
    value.version !== 1 ||
    !Number.isSafeInteger(value.offset) ||
    typeof value.fingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.fingerprint)
  ) {
    throw new DataQueryError("QUERY_INVALID", "Query cursor payload is invalid.");
  }

  const offset = value.offset as number;
  if (offset < 0 || offset > MAX_QUERY_OFFSET) {
    throw new DataQueryError(
      "QUERY_LIMIT_EXCEEDED",
      `Query cursor exceeds the maximum offset of ${MAX_QUERY_OFFSET}.`,
      { offset, maxOffset: MAX_QUERY_OFFSET },
    );
  }

  if (value.fingerprint !== expectedFingerprint) {
    throw new DataQueryError(
      "QUERY_INVALID",
      "Query cursor belongs to a different query shape.",
    );
  }

  return offset;
}
