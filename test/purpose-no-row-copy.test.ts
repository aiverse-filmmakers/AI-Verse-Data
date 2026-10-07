import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDataClient } from "../src/client/index.js";
import {
  createPurposeCurrentValueReader,
  createPurposeCurrentValueStatusReader,
  type PurposeCurrentValueRef,
} from "../src/purpose/index.js";
import {
  TrustedDataRoot,
  createWorkspaceDataScope,
} from "../src/scope/index.js";

const forbiddenRowKeys = [
  "data",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "deletedAt",
  "deletedReason",
  "deletedBy",
] as const;

function assertNoDataRowCopy(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const key of forbiddenRowKeys) {
    assert.equal(
      serialized.includes(`\"${key}\"`),
      false,
      `Purpose projection must not copy Data row field ${key}`,
    );
  }
}

test("Purpose Data reads expose scalar truth and provenance without copying canonical rows", () => {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-purpose-no-row-copy-"));
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
      idempotencyKey: "purpose:no-row-copy",
      data: { signups: 27 },
    });
    const ref: PurposeCurrentValueRef = {
      owner: "ai-verse-data",
      spaceId: "metrics",
      entity: "snapshots",
      recordId: created.result.recordId,
      field: "signups",
    };

    const scalar = createPurposeCurrentValueReader(client).readWithProvenance([ref]);
    assert.equal(scalar.values[0]?.value, 27);
    assert.equal(scalar.values[0]?.ref.owner, "ai-verse-data");
    assertNoDataRowCopy(scalar);

    const status = createPurposeCurrentValueStatusReader(client, {
      now: () => new Date(Date.parse(created.result.updatedAt)),
    }).readStatus([{ ref, staleAfterMs: 60_000 }]);
    assert.equal(status.values[0]?.state, "value");
    assert.equal(status.values[0]?.value, 27);
    assert.equal(status.values[0]?.ref.owner, "ai-verse-data");
    assertNoDataRowCopy(status);
  } finally {
    client.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});
