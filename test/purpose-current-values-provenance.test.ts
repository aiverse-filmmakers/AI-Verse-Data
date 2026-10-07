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

function valueRef(recordId: string): PurposeCurrentValueRef {
  return {
    owner: "ai-verse-data",
    spaceId: "metrics",
    entity: "snapshots",
    recordId,
    field: "signups",
  };
}

test("Purpose current values preserve exact workspace scope and Data provenance", () => {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-purpose-provenance-"));
  mkdirSync(join(rootPath, "workspaces", "film", "data"), { recursive: true });
  const root = TrustedDataRoot.fromExistingDirectory(rootPath);
  const actor = { kind: "bot", id: "purpose-reader" } as const;
  const authorization = {
    mode: "host-bound",
    capabilityRefs: ["data:metrics:read"],
  } as const;
  const client = createDataClient({
    scope: createWorkspaceDataScope(root, "film"),
    actor,
    authorization,
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
      idempotencyKey: "purpose:provenance:1",
      data: { signups: 12 },
    });

    const reader = createPurposeCurrentValueReader(client);
    const result = reader.readWithProvenance([valueRef(created.result.recordId)]);
    const item = result.values[0];
    assert.ok(item);
    assert.equal(item.value, 12);
    assert.deepEqual(item.provenance.scope, { workspaceId: "film" });
    assert.deepEqual(item.provenance.actor, actor);
    assert.deepEqual(item.provenance.authorization, authorization);
    assert.equal(item.provenance.schemaVersion, created.result.schemaVersion);
    assert.equal(item.provenance.recordVersion, created.result.version);
    assert.equal(item.ref.owner, "ai-verse-data");
    assert.equal(item.ref.recordId, created.result.recordId);
  } finally {
    client.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});
