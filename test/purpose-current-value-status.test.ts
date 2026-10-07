import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDataClient } from "../src/client/index.js";
import {
  PurposeCurrentValueReadError,
  createPurposeCurrentValueReader,
  createPurposeCurrentValueStatusReader,
  type PurposeCurrentValueRef,
} from "../src/purpose/index.js";
import {
  TrustedDataRoot,
  createWorkspaceDataScope,
} from "../src/scope/index.js";

function ref(recordId: string, field: string): PurposeCurrentValueRef {
  return {
    owner: "ai-verse-data",
    spaceId: "metrics",
    entity: "snapshots",
    recordId,
    field,
  };
}

test("Purpose status distinguishes missing, stale, zero, false, and null", () => {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-purpose-status-"));
  mkdirSync(join(rootPath, "workspaces", "film", "data"), { recursive: true });
  const root = TrustedDataRoot.fromExistingDirectory(rootPath);
  const client = createDataClient({
    scope: createWorkspaceDataScope(root, "film"),
    actor: { kind: "bot", id: "purpose-reader" },
    authorization: { mode: "host-bound", capabilityRefs: ["data:metrics:read"] },
  });

  try {
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
        count: { type: "integer", required: true },
        enabled: { type: "boolean", required: true },
        note: { type: "string", nullable: true },
        optional: { type: "string" },
      },
    });
    const created = client.records.create({
      spaceId: "metrics",
      entity: "snapshots",
      idempotencyKey: "purpose:status:create",
      data: { count: 0, enabled: false, note: null },
    });
    const staleCreated = client.records.create({
      spaceId: "metrics",
      entity: "snapshots",
      idempotencyKey: "purpose:status:stale",
      data: { count: 7, enabled: true, note: "old" },
    });
    const recordId = created.result.recordId;
    const staleRecordId = staleCreated.result.recordId;
    const sourceMs = Date.parse(staleCreated.result.updatedAt);
    assert.ok(Number.isFinite(sourceMs));

    const reader = createPurposeCurrentValueStatusReader(client, {
      now: () => new Date(sourceMs + 5_000),
    });
    const out = reader.readStatus([
      { ref: ref(recordId, "count"), staleAfterMs: 10_000 },
      { ref: ref(recordId, "enabled"), staleAfterMs: 10_000 },
      { ref: ref(recordId, "note"), staleAfterMs: 10_000 },
      { ref: ref(recordId, "optional"), staleAfterMs: 10_000 },
      { ref: ref("missing-record", "count"), staleAfterMs: 10_000 },
      { ref: ref(staleRecordId, "count"), staleAfterMs: 1_000 },
    ]);

    assert.equal(out.values[0]?.state, "value");
    assert.equal(out.values[0]?.value, 0);
    assert.equal(out.values[1]?.state, "value");
    assert.equal(out.values[1]?.value, false);
    assert.equal(out.values[2]?.state, "value");
    assert.equal(out.values[2]?.value, null);
    assert.deepEqual(out.values[3], {
      state: "missing",
      ref: ref(recordId, "optional"),
      missing: "field",
    });
    assert.deepEqual(out.values[4], {
      state: "missing",
      ref: ref("missing-record", "count"),
      missing: "record",
    });
    assert.equal(out.values[5]?.state, "stale");
    assert.equal(out.values[5]?.value, 7);
    if (out.values[5]?.state === "stale") {
      assert.equal(out.values[5].sourceUpdatedAt, staleCreated.result.updatedAt);
    }

    const strict = createPurposeCurrentValueReader(client);
    assert.throws(
      () => strict.read([ref("missing-record", "count")]),
      (error: unknown) =>
        error instanceof PurposeCurrentValueReadError &&
        error.code === "PURPOSE_CURRENT_VALUE_UNAVAILABLE",
    );
  } finally {
    client.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});
