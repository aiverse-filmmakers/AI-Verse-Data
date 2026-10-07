import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDataClient } from "../src/client/index.js";
import {
  PURPOSE_CURRENT_VALUE_MAX_REFS,
  PurposeCurrentValueReadError,
  createPurposeCurrentValueReader,
  type PurposeCurrentValueRef,
} from "../src/purpose/index.js";
import {
  TrustedDataRoot,
  createWorkspaceDataScope,
} from "../src/scope/index.js";

function setup() {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-purpose-"));
  mkdirSync(join(rootPath, "workspaces", "film", "data"), { recursive: true });
  const root = TrustedDataRoot.fromExistingDirectory(rootPath);
  const client = createDataClient({
    scope: createWorkspaceDataScope(root, "film"),
    actor: { kind: "bot", id: "purpose-reader" },
    authorization: { mode: "host-bound", capabilityRefs: ["data:metrics:read"] },
  });
  client.spaces.create({
    spaceId: "metrics",
    name: "Metrics",
    authority: "local_canonical",
  });
  client.schemas.create({
    spaceId: "metrics",
    entity: "snapshots",
    name: "Metric snapshots",
    fields: {
      signups: { type: "integer", required: true },
      conversion: { type: "number", required: true },
      enabled: { type: "boolean", required: true },
      label: { type: "string", required: true },
      detail: { type: "json", required: true },
    },
  });
  return {
    rootPath,
    client,
    cleanup(): void {
      client.close();
      rmSync(rootPath, { recursive: true, force: true });
    },
  };
}

function valueRef(recordId: string, field: string): PurposeCurrentValueRef {
  return {
    owner: "ai-verse-data",
    spaceId: "metrics",
    entity: "snapshots",
    recordId,
    field,
  };
}

test("Purpose reads only exact referenced primitive current values", () => {
  const fix = setup();
  try {
    const created = fix.client.records.create({
      spaceId: "metrics",
      entity: "snapshots",
      idempotencyKey: "purpose:metric:1",
      data: {
        signups: 42,
        conversion: 0.125,
        enabled: false,
        label: "October",
        detail: { internal: "not a scalar current value" },
      },
    });
    const reader = createPurposeCurrentValueReader(fix.client);
    const refs = [
      valueRef(created.result.recordId, "signups"),
      valueRef(created.result.recordId, "conversion"),
      valueRef(created.result.recordId, "enabled"),
    ];

    assert.deepEqual(reader.read(refs), {
      values: [
        { ref: refs[0], value: 42 },
        { ref: refs[1], value: 0.125 },
        { ref: refs[2], value: false },
      ],
    });
    assert.equal(
      (reader as unknown as Record<string, unknown>)["query"],
      undefined,
    );
    assert.equal(
      (reader as unknown as Record<string, unknown>)["aggregate"],
      undefined,
    );
    assert.equal(
      (reader as unknown as Record<string, unknown>)["list"],
      undefined,
    );
  } finally {
    fix.cleanup();
  }
});

test("Purpose current-value surface enforces exact refs and hard ceilings", () => {
  const fix = setup();
  try {
    const created = fix.client.records.create({
      spaceId: "metrics",
      entity: "snapshots",
      idempotencyKey: "purpose:metric:limits",
      data: {
        signups: 1,
        conversion: 0,
        enabled: true,
        label: "x".repeat(20_000),
        detail: { secret: true },
      },
    });
    const reader = createPurposeCurrentValueReader(fix.client);
    const signups = valueRef(created.result.recordId, "signups");

    assert.throws(
      () => reader.read([]),
      (error: unknown) =>
        error instanceof PurposeCurrentValueReadError &&
        error.code === "PURPOSE_CURRENT_VALUE_INVALID",
    );
    assert.throws(
      () => reader.read(Array.from({ length: PURPOSE_CURRENT_VALUE_MAX_REFS + 1 }, () => signups)),
      (error: unknown) =>
        error instanceof PurposeCurrentValueReadError &&
        error.code === "PURPOSE_CURRENT_VALUE_LIMIT_EXCEEDED",
    );
    assert.throws(
      () => reader.read([signups, signups]),
      (error: unknown) =>
        error instanceof PurposeCurrentValueReadError &&
        error.code === "PURPOSE_CURRENT_VALUE_INVALID",
    );
    assert.throws(
      () => reader.read([{ ...signups, owner: "ai-verse-brain" } as unknown as PurposeCurrentValueRef]),
      (error: unknown) =>
        error instanceof PurposeCurrentValueReadError &&
        error.code === "PURPOSE_CURRENT_VALUE_INVALID",
    );
    assert.throws(
      () => reader.read([valueRef(created.result.recordId, "detail")]),
      (error: unknown) =>
        error instanceof PurposeCurrentValueReadError &&
        error.code === "PURPOSE_CURRENT_VALUE_INVALID",
    );
    assert.throws(
      () => reader.read([valueRef(created.result.recordId, "label")]),
      (error: unknown) =>
        error instanceof PurposeCurrentValueReadError &&
        error.code === "PURPOSE_CURRENT_VALUE_LIMIT_EXCEEDED",
    );
  } finally {
    fix.cleanup();
  }
});

test("Purpose reader fails closed when exact record or field is unavailable", () => {
  const fix = setup();
  try {
    const created = fix.client.records.create({
      spaceId: "metrics",
      entity: "snapshots",
      idempotencyKey: "purpose:metric:unavailable",
      data: {
        signups: 7,
        conversion: 0.5,
        enabled: true,
        label: "ok",
        detail: {},
      },
    });
    const reader = createPurposeCurrentValueReader(fix.client);

    assert.throws(
      () => reader.read([valueRef("missing-record", "signups")]),
      (error: unknown) =>
        error instanceof PurposeCurrentValueReadError &&
        error.code === "PURPOSE_CURRENT_VALUE_UNAVAILABLE",
    );
    assert.throws(
      () => reader.read([valueRef(created.result.recordId, "missing-field")]),
      (error: unknown) =>
        error instanceof PurposeCurrentValueReadError &&
        error.code === "PURPOSE_CURRENT_VALUE_UNAVAILABLE",
    );

    fix.client.close();
    assert.equal(reader.closed, true);
    assert.throws(
      () => reader.read([valueRef(created.result.recordId, "signups")]),
      (error: unknown) =>
        error instanceof PurposeCurrentValueReadError &&
        error.code === "PURPOSE_CURRENT_VALUE_UNAVAILABLE",
    );
  } finally {
    rmSync(fix.rootPath, { recursive: true, force: true });
  }
});
