import { createHash } from "node:crypto";

import { canonicalResultJson } from "../idempotency/fingerprint.js";
import { DataProvenanceError } from "./errors.js";

const EVENT_CURSOR_VERSION = 1 as const;
const CURSOR_PREFIX = "evc_";

interface EventCursorPayload {
  readonly v: typeof EVENT_CURSOR_VERSION;
  readonly s: number;
  readonly f: string;
}

export interface EventCursorFilter {
  readonly spaceId?: string;
  readonly entity?: string;
  readonly recordId?: string;
}

function digest(value: unknown): string {
  return createHash("sha256")
    .update(canonicalResultJson(value), "utf8")
    .digest("hex");
}

export function eventFilterFingerprint(
  filter: EventCursorFilter,
): string {
  return digest({
    spaceId: filter.spaceId ?? null,
    entity: filter.entity ?? null,
    recordId: filter.recordId ?? null,
  });
}

export function encodeEventCursor(
  sequence: number,
  filter: EventCursorFilter,
): string {
  const payload: EventCursorPayload = {
    v: EVENT_CURSOR_VERSION,
    s: sequence,
    f: eventFilterFingerprint(filter),
  };
  return CURSOR_PREFIX + Buffer
    .from(JSON.stringify(payload), "utf8")
    .toString("base64url");
}

export function decodeEventCursor(
  cursor: string,
  filter: EventCursorFilter,
): number {
  if (!cursor.startsWith(CURSOR_PREFIX)) {
    throw new DataProvenanceError(
      "QUERY_INVALID",
      "Event cursor is not an AI-Verse Data event cursor.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      Buffer.from(cursor.slice(CURSOR_PREFIX.length), "base64url").toString("utf8"),
    );
  } catch (error) {
    throw new DataProvenanceError(
      "QUERY_INVALID",
      "Event cursor cannot be decoded.",
      undefined,
      error,
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new DataProvenanceError(
      "QUERY_INVALID",
      "Event cursor payload is invalid.",
    );
  }

  const payload = parsed as Partial<EventCursorPayload>;
  if (
    payload.v !== EVENT_CURSOR_VERSION ||
    !Number.isSafeInteger(payload.s) ||
    (payload.s as number) < 0 ||
    typeof payload.f !== "string" ||
    !/^[0-9a-f]{64}$/.test(payload.f)
  ) {
    throw new DataProvenanceError(
      "QUERY_INVALID",
      "Event cursor payload is invalid.",
    );
  }

  if (payload.f !== eventFilterFingerprint(filter)) {
    throw new DataProvenanceError(
      "QUERY_INVALID",
      "Event cursor does not belong to this event query.",
    );
  }

  return payload.s as number;
}
