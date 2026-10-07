import type { DataClient } from "../client/index.js";
import type { DataAuthorization, JsonPrimitive } from "../protocol/index.js";
import { isDataRecordError } from "../records/index.js";
import {
  PURPOSE_CURRENT_VALUE_MAX_OUTPUT_BYTES,
  PURPOSE_CURRENT_VALUE_MAX_REFS,
  PurposeCurrentValueReadError,
  type PurposeCurrentValueProvenance,
  type PurposeCurrentValueRef,
} from "./current-values.js";

export interface PurposeCurrentValueStatusRequest {
  readonly ref: PurposeCurrentValueRef;
  /** Caller-owned freshness policy. Canonical freshness evidence remains Data.updatedAt. */
  readonly staleAfterMs: number;
}

export interface PurposeCurrentValuePresentStatus {
  readonly state: "value";
  readonly ref: PurposeCurrentValueRef;
  readonly value: JsonPrimitive;
  readonly sourceUpdatedAt: string;
  readonly provenance: PurposeCurrentValueProvenance;
}

export interface PurposeCurrentValueStaleStatus {
  readonly state: "stale";
  readonly ref: PurposeCurrentValueRef;
  readonly value: JsonPrimitive;
  readonly sourceUpdatedAt: string;
  readonly provenance: PurposeCurrentValueProvenance;
}

export interface PurposeCurrentValueMissingStatus {
  readonly state: "missing";
  readonly ref: PurposeCurrentValueRef;
  readonly missing: "record" | "field";
}

export type PurposeCurrentValueStatus =
  | PurposeCurrentValuePresentStatus
  | PurposeCurrentValueStaleStatus
  | PurposeCurrentValueMissingStatus;

export interface PurposeCurrentValueStatusReadResult {
  readonly values: readonly PurposeCurrentValueStatus[];
}

export interface PurposeCurrentValueStatusReaderOptions {
  readonly now?: () => Date;
}

export interface PurposeCurrentValueStatusReader {
  readonly closed: boolean;
  readStatus(
    requests: readonly PurposeCurrentValueStatusRequest[],
  ): PurposeCurrentValueStatusReadResult;
}

function fail(
  code: PurposeCurrentValueReadError["code"],
  message: string,
  cause?: unknown,
): never {
  throw new PurposeCurrentValueReadError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function assertIdentifier(value: string, label: string): void {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 128 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    fail(
      "PURPOSE_CURRENT_VALUE_INVALID",
      `${label} must be a non-empty string of at most 128 non-control characters.`,
    );
  }
}

function validateRef(ref: PurposeCurrentValueRef, index: number): void {
  if (typeof ref !== "object" || ref === null || Array.isArray(ref)) {
    fail("PURPOSE_CURRENT_VALUE_INVALID", `requests[${index}].ref must be an object.`);
  }
  if (ref.owner !== "ai-verse-data") {
    fail(
      "PURPOSE_CURRENT_VALUE_INVALID",
      `requests[${index}].ref.owner must be ai-verse-data.`,
    );
  }
  assertIdentifier(ref.spaceId, `requests[${index}].ref.spaceId`);
  assertIdentifier(ref.entity, `requests[${index}].ref.entity`);
  assertIdentifier(ref.recordId, `requests[${index}].ref.recordId`);
  assertIdentifier(ref.field, `requests[${index}].ref.field`);
}

function validateRequests(
  requests: readonly PurposeCurrentValueStatusRequest[],
): void {
  if (!Array.isArray(requests) || requests.length < 1) {
    fail(
      "PURPOSE_CURRENT_VALUE_INVALID",
      "Purpose current-value status reads require at least one request.",
    );
  }
  if (requests.length > PURPOSE_CURRENT_VALUE_MAX_REFS) {
    fail(
      "PURPOSE_CURRENT_VALUE_LIMIT_EXCEEDED",
      `Purpose current-value status reads support at most ${PURPOSE_CURRENT_VALUE_MAX_REFS} requests.`,
    );
  }

  const seen = new Set<string>();
  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index];
    if (request === undefined || typeof request !== "object" || request === null) {
      fail("PURPOSE_CURRENT_VALUE_INVALID", `requests[${index}] must be an object.`);
    }
    validateRef(request.ref, index);
    if (
      !Number.isSafeInteger(request.staleAfterMs) ||
      request.staleAfterMs < 0
    ) {
      fail(
        "PURPOSE_CURRENT_VALUE_INVALID",
        `requests[${index}].staleAfterMs must be a non-negative safe integer.`,
      );
    }
    const key = [
      request.ref.owner,
      request.ref.spaceId,
      request.ref.entity,
      request.ref.recordId,
      request.ref.field,
    ].join("\u0000");
    if (seen.has(key)) {
      fail(
        "PURPOSE_CURRENT_VALUE_INVALID",
        `Duplicate Purpose current-value status ref at requests[${index}].`,
      );
    }
    seen.add(key);
  }
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function copyAuthorization(authorization: DataAuthorization): DataAuthorization {
  return authorization.capabilityRefs === undefined
    ? { mode: authorization.mode }
    : {
        mode: authorization.mode,
        capabilityRefs: [...authorization.capabilityRefs],
      };
}

function enforceOutputLimit(value: unknown): void {
  if (
    Buffer.byteLength(JSON.stringify(value), "utf8") >
    PURPOSE_CURRENT_VALUE_MAX_OUTPUT_BYTES
  ) {
    fail(
      "PURPOSE_CURRENT_VALUE_LIMIT_EXCEEDED",
      `Purpose current-value status output exceeds ${PURPOSE_CURRENT_VALUE_MAX_OUTPUT_BYTES} bytes.`,
    );
  }
}

export function createPurposeCurrentValueStatusReader(
  client: DataClient,
  options: PurposeCurrentValueStatusReaderOptions = {},
): PurposeCurrentValueStatusReader {
  if (typeof client !== "object" || client === null) {
    fail("PURPOSE_CURRENT_VALUE_INVALID", "A Data client is required.");
  }
  const clock = options.now ?? (() => new Date());

  return {
    get closed(): boolean {
      return client.closed;
    },
    readStatus(
      requests: readonly PurposeCurrentValueStatusRequest[],
    ): PurposeCurrentValueStatusReadResult {
      if (client.closed) {
        fail(
          "PURPOSE_CURRENT_VALUE_UNAVAILABLE",
          "Bound Data client is closed and cannot answer Purpose current-value status reads.",
        );
      }
      validateRequests(requests);
      const nowMs = clock().getTime();
      if (!Number.isFinite(nowMs)) {
        fail("PURPOSE_CURRENT_VALUE_INVALID", "Purpose status clock must return a valid Date.");
      }

      const values: PurposeCurrentValueStatus[] = [];
      for (const request of requests) {
        const ref = request.ref;
        let out;
        try {
          out = client.records.get({
            spaceId: ref.spaceId,
            entity: ref.entity,
            recordId: ref.recordId,
          });
        } catch (error) {
          if (isDataRecordError(error) && error.code === "RECORD_NOT_FOUND") {
            values.push({ state: "missing", ref: { ...ref }, missing: "record" });
            continue;
          }
          fail(
            "PURPOSE_CURRENT_VALUE_UNAVAILABLE",
            `Purpose current-value status ref could not be resolved: ${ref.spaceId}/${ref.entity}/${ref.recordId}.`,
            error,
          );
        }

        const record = out.result;
        if (!Object.prototype.hasOwnProperty.call(record.data, ref.field)) {
          values.push({ state: "missing", ref: { ...ref }, missing: "field" });
          continue;
        }
        const value = record.data[ref.field];
        if (!isJsonPrimitive(value)) {
          fail(
            "PURPOSE_CURRENT_VALUE_INVALID",
            `Purpose current-value field must resolve to a JSON primitive: ${ref.spaceId}/${ref.entity}/${ref.recordId}#${ref.field}.`,
          );
        }
        const updatedMs = Date.parse(record.updatedAt);
        if (!Number.isFinite(updatedMs)) {
          fail(
            "PURPOSE_CURRENT_VALUE_UNAVAILABLE",
            `Purpose current-value source timestamp is invalid: ${ref.spaceId}/${ref.entity}/${ref.recordId}.`,
          );
        }
        const base = {
          ref: { ...ref },
          value,
          sourceUpdatedAt: record.updatedAt,
          provenance: {
            scope: { ...out.scope },
            actor: { ...out.actor },
            authorization: copyAuthorization(out.authorization),
            schemaVersion: record.schemaVersion,
            recordVersion: record.version,
          },
        };
        values.push(
          nowMs - updatedMs > request.staleAfterMs
            ? { state: "stale", ...base }
            : { state: "value", ...base },
        );
      }

      const result = { values };
      enforceOutputLimit(result);
      return result;
    },
  };
}
