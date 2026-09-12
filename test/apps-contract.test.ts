import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAppsDataKit } from "../src/apps/index.js";
import {
  AppsDataError,
  isAppsDataError,
} from "../src/apps/errors.js";
import type { AppsDataManifest } from "../src/apps/index.js";
import { createDataClient } from "../src/client/index.js";
import {
  TrustedDataRoot,
  createWorkspaceDataScope,
} from "../src/scope/index.js";

const APP = "production-manager";

function manifest(
  overrides?: Partial<AppsDataManifest>,
): AppsDataManifest {
  return {
    app: APP,
    scope: "workspace",
    data: {
      spaces: {
        production: { schemas: ["productions", "shoot-days", "crew"] },
      },
      capabilities: ["read", "create", "update"],
    },
    ...overrides,
  };
}

function refsFor(
  spaceId: string,
  entities: readonly string[],
  caps: readonly string[],
): string[] {
  const refs: string[] = [];
  for (const entity of entities) {
    for (const cap of caps) refs.push(`data:${spaceId}:${entity}:${cap}`);
  }
  return refs;
}

function workspaceScope(workspaceId = "sales") {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-apps-"));
  mkdirSync(join(rootPath, "workspaces", workspaceId, "data"), {
    recursive: true,
  });
  const root = TrustedDataRoot.fromExistingDirectory(rootPath);
  const scope = createWorkspaceDataScope(root, workspaceId);
  return {
    rootPath,
    scope,
    cleanup(): void {
      rmSync(rootPath, { recursive: true, force: true });
    },
  };
}

function appClient(
  scope: ReturnType<typeof createWorkspaceDataScope>,
  caps: readonly string[],
) {
  return createDataClient({
    scope,
    actor: { kind: "app", id: APP },
    authorization: { mode: "host-bound", capabilityRefs: [...caps] },
  });
}

function bootstrap(client: ReturnType<typeof createDataClient>) {
  assert.equal(
    client.spaces.create({
      spaceId: "production",
      name: "Production",
      authority: "local_canonical",
    }).ok,
    true,
  );
  for (const entity of ["productions", "shoot-days", "crew"] as const) {
    assert.equal(
      client.schemas.create({
        spaceId: "production",
        entity,
        name: entity,
        fields: { title: { type: "string", required: true } },
      }).ok,
      true,
    );
  }
}

test("declared kit serves scoped reads plus writes inside the grant", () => {
  const fix = workspaceScope();
  const caps = refsFor(
    "production",
    ["productions", "shoot-days", "crew"],
    ["read", "create", "update"],
  );
  const client = appClient(fix.scope, caps);
  try {
    bootstrap(client);
    const kit = createAppsDataKit(client, manifest());
    assert.equal(kit.meta.app, APP);
    assert.equal(kit.meta.uninstallRule, "preserve-data");

    const spaces = kit.spaces.list();
    assert.equal(spaces.ok, true);
    assert.ok(spaces.result.some((space) => space.spaceId === "production"));

    const schemas = kit.schemas.list({ spaceId: "production" });
    assert.equal(schemas.ok, true);
    assert.equal(schemas.result.length, 3);

    const created = kit.records.createWithReceipt({
      spaceId: "production",
      entity: "productions",
      idempotencyKey: "apps:prod:1",
      data: { title: "Pilot" },
    });
    assert.equal(created.ok, true);
    assert.equal(created.result.record.data["title"], "Pilot");

    const fetched = kit.records.get({
      spaceId: "production",
      entity: "productions",
      recordId: created.result.record.recordId,
    });
    assert.equal(fetched.ok, true);

    const updated = kit.records.updateWithReceipt({
      spaceId: "production",
      entity: "productions",
      recordId: created.result.record.recordId,
      expectedVersion: 1,
      idempotencyKey: "apps:prod:1:update",
      patch: { title: "Pilot v2" },
    });
    assert.equal(updated.ok, true);
    assert.equal(updated.result.record.version, 2);

    const replay = kit.records.createWithReceipt({
      spaceId: "production",
      entity: "productions",
      idempotencyKey: "apps:prod:1",
      data: { title: "Pilot" },
    });
    assert.equal(replay.ok, true);
    assert.equal(
      replay.result.record.recordId,
      created.result.record.recordId,
    );

    const page = kit.query.query({
      spaceId: "production",
      entity: "productions",
      limit: 10,
    });
    assert.equal(page.ok, true);
    assert.equal(page.result.items.length, 1);

    const perms = kit.permissions.describe();
    assert.equal(perms.ok, true);
    assert.equal(perms.result.app, APP);
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("out-of-grant space, entity, and delete stay denied", () => {
  const fix = workspaceScope();
  const caps = refsFor("production", ["productions"], ["read", "create"]);
  const client = appClient(fix.scope, caps);
  try {
    bootstrap(client);
    const kit = createAppsDataKit(
      client,
      manifest({
        data: {
          spaces: { production: { schemas: ["productions"] } },
          capabilities: ["read", "create"],
        },
      }),
    );

    assert.throws(
      () =>
        kit.records.get({
          spaceId: "crm",
          entity: "deals",
          recordId: "whatever",
        }),
      (error: unknown) => {
        assert.ok(isAppsDataError(error));
        assert.equal(
          (error as AppsDataError).code,
          "APPS_PERMISSION_DENIED",
        );
        return true;
      },
    );
    assert.throws(
      () =>
        kit.records.get({
          spaceId: "production",
          entity: "crew",
          recordId: "whatever",
        }),
      (error: unknown) => isAppsDataError(error),
    );
    assert.throws(
      () =>
        kit.records.update({
          spaceId: "production",
          entity: "productions",
          recordId: "whatever",
          expectedVersion: 1,
          idempotencyKey: "apps:denied:update",
          patch: { title: "No" },
        }),
      (error: unknown) => isAppsDataError(error),
    );
    assert.throws(
      () =>
        kit.transactions.execute({
          idempotencyKey: "apps:denied:txn",
          operations: [
            {
              operation: "data.record.delete",
              payload: {
                spaceId: "production",
                entity: "productions",
                recordId: "whatever",
                expectedVersion: 1,
                idempotencyKey: "apps:denied:delete",
              },
            },
          ],
        }),
      (error: unknown) => isAppsDataError(error),
    );
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("model-written manifests never grant access", () => {
  const fix = workspaceScope();
  const client = appClient(fix.scope, refsFor("production", ["productions"], ["read"]));
  try {
    bootstrap(client);
    assert.throws(
      () =>
        createAppsDataKit(
          client,
          manifest({
            data: {
              spaces: { production: { schemas: ["productions"] } },
              capabilities: ["read", "create"],
            },
          }),
        ),
      (error: unknown) => {
        assert.ok(isAppsDataError(error));
        assert.equal(
          (error as AppsDataError).code,
          "APPS_PERMISSION_DENIED",
        );
        return true;
      },
    );
    assert.throws(
      () =>
        createAppsDataKit(
          client,
          manifest({
            data: {
              spaces: { production: { schemas: ["productions"] } },
              capabilities: ["read", "delete"] as unknown as ["read"],
            },
          }),
        ),
      (error: unknown) => isAppsDataError(error),
    );
    assert.throws(
      () =>
        createAppsDataKit(
          client,
          manifest({ app: "Evil App!" }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof AppsDataError);
        assert.equal(error.code, "APPS_INVALID");
        return true;
      },
    );
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("schema origins track without transferring record ownership", () => {
  const fix = workspaceScope();
  const caps = refsFor(
    "production",
    ["productions", "shoot-days", "crew"],
    ["read", "create", "update"],
  );
  const client = appClient(fix.scope, caps);
  try {
    bootstrap(client);
    const kit = createAppsDataKit(client, manifest(), {
      schemaOrigins: { "production/productions": APP },
    });
    const origin = kit.schemas.origin({
      spaceId: "production",
      entity: "productions",
    });
    assert.equal(origin.ok, true);
    assert.equal(origin.result.originApp, APP);
    assert.equal(origin.result.schemaVersion, 1);

    const other = kit.schemas.origin({
      spaceId: "production",
      entity: "shoot-days",
    });
    assert.equal(other.ok, true);
    assert.equal(other.result.originApp, null);

    const created = kit.records.create({
      spaceId: "production",
      entity: "productions",
      idempotencyKey: "apps:origin:1",
      data: { title: "Owned by Data" },
    });
    assert.equal(created.ok, true);
    assert.equal(created.result.spaceId, "production");

    const notice = kit.lifecycle.uninstallNotice();
    assert.equal(notice.ok, true);
    assert.equal(notice.result.rule, "preserve-data");
    assert.match(notice.result.detail, /preserve|preserve-data|canonical/i);

    const direct = client.records.get({
      spaceId: "production",
      entity: "productions",
      recordId: created.result.recordId,
    });
    assert.equal(direct.ok, true);
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("transactions, bulk, and provenance stay inside the grant", () => {
  const fix = workspaceScope();
  const caps = refsFor(
    "production",
    ["productions", "shoot-days", "crew"],
    ["read", "create", "update"],
  );
  const client = appClient(fix.scope, caps);
  try {
    bootstrap(client);
    const kit = createAppsDataKit(client, manifest());

    const txn = kit.transactions.executeWithReceipt({
      idempotencyKey: "apps:txn:1",
      operations: [
        {
          operation: "data.record.create",
          payload: {
            spaceId: "production",
            entity: "productions",
            idempotencyKey: "apps:txn:prod:1",
            data: { title: "Txn show" },
          },
        },
        {
          operation: "data.record.create",
          payload: {
            spaceId: "production",
            entity: "shoot-days",
            idempotencyKey: "apps:txn:day:1",
            data: { title: "Day 1" },
          },
        },
      ],
    });
    assert.equal(txn.ok, true);
    assert.equal(txn.result.result.operations.length, 2);

    assert.throws(
      () =>
        kit.transactions.execute({
          idempotencyKey: "apps:txn:denied",
          operations: [
            {
              operation: "data.record.create",
              payload: {
                spaceId: "production",
                entity: "extras",
                idempotencyKey: "apps:txn:extras:1",
                data: { title: "No" },
              },
            },
          ],
        }),
      (error: unknown) => isAppsDataError(error),
    );

    const preview = kit.bulk.preview([
      {
        operation: "data.record.create",
        payload: {
          spaceId: "production",
          entity: "productions",
          idempotencyKey: "apps:bulk:1",
          data: { title: "Bulk show" },
        },
      },
    ]);
    assert.equal(preview.ok, true);
    const executed = kit.bulk.execute({
      idempotencyKey: "apps:bulk:exec:1",
      expectedPreviewDigest: preview.result.previewDigest,
      operations: [
        {
          operation: "data.record.create",
          payload: {
            spaceId: "production",
            entity: "productions",
            idempotencyKey: "apps:bulk:1",
            data: { title: "Bulk show" },
          },
        },
      ],
    });
    assert.equal(executed.ok, true);

    const events = kit.provenance.listEvents({ spaceId: "production", entity: "productions" });
    assert.equal(events.ok, true);
    assert.ok(events.result.items.length >= 2);
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("malformed kits, wrong identity, and closed client fail closed", () => {
  const fix = workspaceScope();
  const caps = refsFor("production", ["productions"], ["read"]);
  const client = appClient(fix.scope, caps);
  try {
    bootstrap(client);
    assert.throws(
      () =>
        createAppsDataKit(
          client,
          manifest({
            data: {
              spaces: {},
              capabilities: ["read"],
            },
          }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof AppsDataError);
        return true;
      },
    );
    const otherClient = createDataClient({
      scope: fix.scope,
      actor: { kind: "app", id: "other-app" },
      authorization: { mode: "host-bound", capabilityRefs: [...caps] },
    });
    try {
      assert.throws(
        () => createAppsDataKit(otherClient, manifest()),
        (error: unknown) => {
          assert.ok(error instanceof AppsDataError);
          assert.equal(error.code, "APPS_INVALID");
          return true;
        },
      );
    } finally {
      otherClient.close();
    }

    const kit = createAppsDataKit(
      client,
      manifest({
        data: {
          spaces: { production: { schemas: ["productions"] } },
          capabilities: ["read"],
        },
      }),
    );
    client.close();
    assert.equal(kit.closed, true);
    assert.throws(
      () => kit.spaces.list(),
      (error: unknown) => {
        assert.ok(error instanceof AppsDataError);
        assert.equal(error.code, "APPS_CLOSED");
        return true;
      },
    );
  } finally {
    fix.cleanup();
  }
});
