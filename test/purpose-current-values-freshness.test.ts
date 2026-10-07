import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDataClient } from "../src/client/index.js";
import {
  createPurposeCurrentValueReader,
  type PurposeCurrentValueRef,
} from "../src/purpose/index.js";
import {
  TrustedDataRoot,
  createWorkspaceDataScope,
} from "../src/scope/index.js";

test("Purpose freshness uses canonical Data updatedAt rather than query time", () => {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-purpose-freshness-"));
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
      fields: { signups: { type: "integer", required: true } },
    });
    const created = client.records.create({
      spaceId: "metrics",
      entity: "snapshots",
      idempotencyKey: "purpose:freshness:create",
      data: { signups: 8 },
    });
    const updated = client.records.update({
      spaceId: "metrics",
      entity: "snapshots",
      recordId: created.result.recordId,
      expectedVersion: created.result.version,
      idempotencyKey: "purpose:freshness:update",
      patch: { signups: 9 },
    });

    const ref: PurposeCurrentValueRef = {
      owner: "ai-verse-data",
      spaceId: "metrics",
      entity: "snapshots",
      recordId: updated.result.recordId,
      field: "signups",
    };
    const reader = createPurposeCurrentValueReader(client);
    const first = reader.readWithProvenance([ref]).values[0];
    assert.ok(first);
    assert.equal(first.value, 9);
    assert.equal(first.freshness.sourceUpdatedAt, updated.result.updatedAt);
    assert.ok(Date.parse(first.freshness.sourceUpdatedAt) > 0);

    const second = reader.readWithProvenance([ref]).values[0];
    assert.ok(second);
    assert.equal(second.freshness.sourceUpdatedAt, first.freshness.sourceUpdatedAt);
    assert.equal(
      (second.freshness as unknown as Record<string, unknown>)["readAt"],
      undefined,
    );
    assert.equal(
      (second.freshness as unknown as Record<string, unknown>)["queriedAt"],
      undefined,
    );
  } finally {
    client.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});
