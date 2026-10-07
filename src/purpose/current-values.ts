import type { DataClient } from "../client/index.js";
import type { JsonPrimitive } from "../protocol/index.js";

export const PURPOSE_CURRENT_VALUE_MAX_REFS = 32 as const;
export const PURPOSE_CURRENT_VALUE_MAX_OUTPUT_BYTES = 16_384 as const;

export interface PurposeCurrentValueRef {
  readonly owner: "ai-verse-data";
  readonly spaceId: string;
  readonly entity: string;
  readonly recordId: string;
  readonly field: string;
}

export interface PurposeCurrentValue {
  readonly ref: PurposeCurrentValueRef;
  readonly value: JsonPrimitive;
}

export interface PurposeCurrentValueReadResult {
  readonly values: readonly PurposeCurrentValue[];
}

export class PurposeCurrentValueReadError extends Error {
  readonly code:
    | "PURPOSE_CURRENT_VALUE_INVALID"
    | "PURPOSE_CURRENT_VALUE_LIMIT_EXCEEDED"
    | "PURPOSE_CURRENT_VALUE_UNAVAILABLE";

  constructor(
    code: PurposeCurrentValueReadError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PurposeCurrentValueReadError";
    this.code = code;
  }
}

export interface PurposeCurrentValueReader {
  readonly closed: boolean;
  read(refs: readonly PurposeCurrentValueRef[]): PurposeCurrentValueReadResult;
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
    fail("PURPOSE_CURRENT_VALUE_INVALID", `refs[${index}] must be an object.`);
  }
  if (ref.owner !== "ai-verse-data") {
    fail(
      "PURPOSE_CURRENT_VALUE_INVALID",
      `refs[${index}].owner must be ai-verse-data.`,
    );
  }
  assertIdentifier(ref.spaceId, `refs[${index}].spaceId`);
  assertIdentifier(ref.entity, `refs[${index}].entity`);
  assertIdentifier(ref.recordId, `refs[${index}].recordId`);
  assertIdentifier(ref.field, `refs[${index}].field`);
}

function refKey(ref: PurposeCurrentValueRef): string {
  return [ref.owner, ref.spaceId, ref.entity, ref.recordId, ref.field].join("\u0000");
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

export function createPurposeCurrentValueReader(
  client: DataClient,
): PurposeCurrentValueReader {
  if (typeof client !== "object" || client === null) {
    fail("PURPOSE_CURRENT_VALUE_INVALID", "A Data client is required.");
  }

  return {
    get closed(): boolean {
      return client.closed;
    },
    read(refs: readonly PurposeCurrentValueRef[]): PurposeCurrentValueReadResult {
      if (client.closed) {
        fail(
          "PURPOSE_CURRENT_VALUE_UNAVAILABLE",
          "Bound Data client is closed and cannot answer Purpose current-value reads.",
        );
      }
      if (!Array.isArray(refs) || refs.length < 1) {
        fail(
          "PURPOSE_CURRENT_VALUE_INVALID",
          "Purpose current-value reads require at least one exact Data ref.",
        );
      }
      if (refs.length > PURPOSE_CURRENT_VALUE_MAX_REFS) {
        fail(
          "PURPOSE_CURRENT_VALUE_LIMIT_EXCEEDED",
          `Purpose current-value reads support at most ${PURPOSE_CURRENT_VALUE_MAX_REFS} refs.`,
        );
      }

      const seen = new Set<string>();
      const values: PurposeCurrentValue[] = [];
      for (let index = 0; index < refs.length; index += 1) {
        const ref = refs[index];
        if (ref === undefined) {
          fail("PURPOSE_CURRENT_VALUE_INVALID", `refs[${index}] is required.`);
        }
        validateRef(ref, index);
        const key = refKey(ref);
        if (seen.has(key)) {
          fail(
            "PURPOSE_CURRENT_VALUE_INVALID",
            `Duplicate Purpose current-value ref at refs[${index}].`,
          );
        }
        seen.add(key);

        let record;
        try {
          record = client.records.get({
            spaceId: ref.spaceId,
            entity: ref.entity,
            recordId: ref.recordId,
          }).result;
        } catch (error) {
          fail(
            "PURPOSE_CURRENT_VALUE_UNAVAILABLE",
            `Purpose current-value ref could not be resolved: ${ref.spaceId}/${ref.entity}/${ref.recordId}.`,
            error,
          );
        }

        if (!Object.prototype.hasOwnProperty.call(record.data, ref.field)) {
          fail(
            "PURPOSE_CURRENT_VALUE_UNAVAILABLE",
            `Purpose current-value field is unavailable: ${ref.spaceId}/${ref.entity}/${ref.recordId}#${ref.field}.`,
          );
        }
        const value = record.data[ref.field];
        if (!isJsonPrimitive(value)) {
          fail(
            "PURPOSE_CURRENT_VALUE_INVALID",
            `Purpose current-value field must resolve to a JSON primitive: ${ref.spaceId}/${ref.entity}/${ref.recordId}#${ref.field}.`,
          );
        }
        values.push({ ref: { ...ref }, value });

        const outputBytes = Buffer.byteLength(JSON.stringify({ values }), "utf8");
        if (outputBytes > PURPOSE_CURRENT_VALUE_MAX_OUTPUT_BYTES) {
          fail(
            "PURPOSE_CURRENT_VALUE_LIMIT_EXCEEDED",
            `Purpose current-value output exceeds ${PURPOSE_CURRENT_VALUE_MAX_OUTPUT_BYTES} bytes.`,
          );
        }
      }

      return { values };
    },
  };
}
