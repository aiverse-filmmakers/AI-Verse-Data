import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAppsDataKit, isAppsDataError } from "../src/apps/index.js";
import { createBotsDataAdapter, isBotsDataAdapterError } from "../src/bots/index.js";
import { createDataClient } from "../src/client/index.js";
import { createDashboardProjection } from "../src/dashboard/index.js";
import { createMemoryBridge } from "../src/memory/index.js";
import { createConnectionsAuthority } from "../src/connections/index.js";
import { createAutomationEvents } from "../src/automation/index.js";
import { isMemoryBridgeError } from "../src/memory/errors.js";
import { isDataRecordError } from "../src/records/index.js";
import { TrustedDataRoot, createWorkspaceDataScope } from "../src/scope/index.js";

function fixture(workspaceId = "audit") {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-audit-"));
  mkdirSync(join(rootPath, "workspaces", workspaceId, "data"), { recursive: true });
  const scope = createWorkspaceDataScope(
    TrustedDataRoot.fromExistingDirectory(rootPath),
    workspaceId,
  );
  return {
    rootPath,
    scope,
    cleanup(): void {
      rmSync(rootPath, { recursive: true, force: true });
    },
  };
}

function createSpaceAndSchema(
  client: ReturnType<typeof createDataClient>,
  spaceId: string,
  entity: string,
): void {
  if (!client.spaces.list().result.some((space) => space.spaceId === spaceId)) {
    client.spaces.create({ spaceId, name: spaceId, authority: "local_canonical" });
  }
  client.schemas.create({
    spaceId,
    entity,
    name: entity,
    fields: { title: { type: "string", required: true } },
  });
}

test("Apps update authority cannot delete through transaction or bulk", () => {
  const fix = fixture();
  const client = createDataClient({
    scope: fix.scope,
    actor: { kind: "app", id: "audit-app" },
    authorization: {
      mode: "host-bound",
      capabilityRefs: [
        "data:production:items:read",
        "data:production:items:create",
        "data:production:items:update",
      ],
    },
  });
  try {
    createSpaceAndSchema(client, "production", "items");
    const record = client.records.create({
      spaceId: "production",
      entity: "items",
      idempotencyKey: "audit-app:create",
      data: { title: "keep" },
    }).result;
    const kit = createAppsDataKit(client, {
      app: "audit-app",
      scope: "workspace",
      data: {
        spaces: { production: { schemas: ["items"] } },
        capabilities: ["read", "create", "update"],
      },
    });
    const deletion = {
      operation: "data.record.delete" as const,
      payload: {
        spaceId: "production",
        entity: "items",
        recordId: record.recordId,
        expectedVersion: 1,
        idempotencyKey: "audit-app:delete",
      },
    };
    assert.throws(
      () => kit.transactions.execute({ idempotencyKey: "audit-app:txn", operations: [deletion] }),
      (error: unknown) => isAppsDataError(error) && error.code === "APPS_PERMISSION_DENIED",
    );
    assert.throws(
      () => kit.bulk.preview([deletion]),
      (error: unknown) => isAppsDataError(error) && error.code === "APPS_PERMISSION_DENIED",
    );
    assert.equal(
      client.records.get({ spaceId: "production", entity: "items", recordId: record.recordId }).result.deletedAt,
      null,
    );
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("Apps and Bots cannot read provenance outside granted entity scope", () => {
  const fix = fixture();
  const appClient = createDataClient({
    scope: fix.scope,
    actor: { kind: "app", id: "audit-app" },
    authorization: {
      mode: "host-bound",
      capabilityRefs: ["data:allowed:items:read", "data:allowed:items:create"],
    },
  });
  try {
    createSpaceAndSchema(appClient, "allowed", "items");
    createSpaceAndSchema(appClient, "secret", "items");
    const secret = appClient.records.createWithReceipt({
      spaceId: "secret",
      entity: "items",
      idempotencyKey: "secret:create",
      data: { title: "secret" },
    });
    const kit = createAppsDataKit(appClient, {
      app: "audit-app",
      scope: "workspace",
      data: {
        spaces: { allowed: { schemas: ["items"] } },
        capabilities: ["read", "create"],
      },
    });
    const allowed = appClient.records.create({
      spaceId: "allowed",
      entity: "items",
      idempotencyKey: "allowed:create",
      data: { title: "allowed" },
    });
    assert.equal(allowed.ok, true);

    let appHiddenReceiptMessage = "";
    assert.throws(
      () => kit.provenance.getReceipt(secret.result.receipt.receiptId),
      (error: unknown) => {
        if (!isAppsDataError(error) || error.code !== "APPS_PERMISSION_DENIED") return false;
        appHiddenReceiptMessage = error.message;
        return true;
      },
    );
    assert.throws(
      () => kit.provenance.getReceipt("rcpt_nonexistent"),
      (error: unknown) =>
        isAppsDataError(error) &&
        error.code === "APPS_PERMISSION_DENIED" &&
        error.message === appHiddenReceiptMessage,
    );
    assert.throws(
      () => kit.provenance.listEvents(),
      (error: unknown) => isAppsDataError(error) && error.code === "APPS_PERMISSION_DENIED",
    );
    assert.throws(
      () => kit.provenance.listEvents({ spaceId: "allowed" }),
      (error: unknown) => isAppsDataError(error) && error.code === "APPS_PERMISSION_DENIED",
    );
    assert.throws(
      () => kit.provenance.listEvents({ spaceId: "secret", entity: "items" }),
      (error: unknown) => isAppsDataError(error) && error.code === "APPS_PERMISSION_DENIED",
    );
    const allowedEvents = kit.provenance.listEvents({
      spaceId: "allowed",
      entity: "items",
      limit: 1,
    });
    assert.equal(allowedEvents.result.items.length, 1);
    assert.equal(allowedEvents.result.items[0]?.recordId, allowed.result.recordId);
    assert.equal(allowedEvents.result.hasMore, false);
    assert.equal(allowedEvents.result.nextCursor, null);
  } finally {
    appClient.close();
  }

  const botClient = createDataClient({
    scope: fix.scope,
    actor: { kind: "bot", id: "audit-bot" },
    authorization: { mode: "host-bound", capabilityRefs: ["data:allowed:items:read"] },
  });
  try {
    const secretReceipt = botClient.provenance.getReceiptByIdempotencyKey("secret:create").result;
    const bot = createBotsDataAdapter(botClient, {
      workspaceId: "audit",
      principal: { kind: "bot", id: "audit-bot" },
      taskId: "audit-task",
      capabilities: ["data:allowed:items:read"],
    });
    let botHiddenReceiptMessage = "";
    assert.throws(
      () => bot.provenance.getReceipt(secretReceipt.receiptId),
      (error: unknown) => {
        if (!isBotsDataAdapterError(error) || error.code !== "CAPABILITY_DENIED") return false;
        botHiddenReceiptMessage = error.message;
        return true;
      },
    );
    assert.throws(
      () => bot.provenance.getReceipt("rcpt_nonexistent"),
      (error: unknown) =>
        isBotsDataAdapterError(error) &&
        error.code === "CAPABILITY_DENIED" &&
        error.message === botHiddenReceiptMessage,
    );
    assert.throws(
      () => bot.provenance.listEvents(),
      (error: unknown) => isBotsDataAdapterError(error) && error.code === "CAPABILITY_DENIED",
    );
    assert.throws(
      () => bot.provenance.listEvents({ spaceId: "allowed" }),
      (error: unknown) => isBotsDataAdapterError(error) && error.code === "CAPABILITY_DENIED",
    );
    assert.throws(
      () => bot.provenance.listEvents({ spaceId: "secret", entity: "items" }),
      (error: unknown) => isBotsDataAdapterError(error) && error.code === "CAPABILITY_DENIED",
    );
    const botAllowed = bot.provenance.listEvents({
      spaceId: "allowed",
      entity: "items",
      limit: 1,
    });
    assert.equal(botAllowed.result.items.length, 1);
    assert.equal(botAllowed.result.hasMore, false);
    assert.equal(botAllowed.result.nextCursor, null);
  } finally {
    botClient.close();
    fix.cleanup();
  }
});

test("Memory resolves a real event beyond the first 200 and never fabricates evidence", () => {
  const fix = fixture();
  const client = createDataClient({
    scope: fix.scope,
    actor: { kind: "human", id: "memory-audit" },
    authorization: { mode: "local-operator" },
  });
  try {
    createSpaceAndSchema(client, "memory", "items");
    for (let index = 0; index < 205; index += 1) {
      client.records.create({
        spaceId: "memory",
        entity: "items",
        idempotencyKey: `memory:filler:${index}`,
        data: { title: `filler ${index}` },
      });
    }
    const target = client.records.createWithReceipt({
      spaceId: "memory",
      entity: "items",
      idempotencyKey: "memory:target",
      data: { title: "target" },
    }).result;
    const memory = createMemoryBridge(client);
    const found = memory.evidence.lookupEvent({ eventId: target.receipt.eventId });
    assert.equal(found.result.event.eventId, target.receipt.eventId);
    assert.equal(found.result.event.committedAt, target.receipt.committedAt);
    assert.notEqual(found.result.event.requestId, "req_unknown");

    const reference = memory.references.forRecord({
      spaceId: "memory",
      entity: "items",
      recordId: "unknown",
      eventId: target.receipt.eventId,
    });
    const reopened = memory.evidence.lookupByReference(reference);
    assert.ok("event" in reopened.result);
    if ("event" in reopened.result) {
      assert.equal(reopened.result.event.eventId, target.receipt.eventId);
      assert.notEqual(reopened.result.event.committedAt, new Date(0).toISOString());
    }
    assert.throws(
      () => memory.references.parse("data://audit/memory/items/%ZZ"),
      (error: unknown) => isMemoryBridgeError(error) && error.code === "MEMORY_INVALID",
    );
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("Dashboard resolves cross-space reference using schema spaceId", () => {
  const fix = fixture();
  const client = createDataClient({
    scope: fix.scope,
    actor: { kind: "human", id: "dashboard-audit" },
    authorization: { mode: "local-operator" },
  });
  try {
    createSpaceAndSchema(client, "crm", "companies");
    client.spaces.create({ spaceId: "sales", name: "Sales", authority: "local_canonical" });
    client.schemas.create({
      spaceId: "sales",
      entity: "deals",
      name: "Deals",
      fields: {
        title: { type: "string", required: true },
        company: { type: "reference", entity: "companies", spaceId: "crm", required: true },
      },
    });
    const company = client.records.create({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "dashboard:company",
      data: { title: "Acme" },
    }).result;
    const deal = client.records.create({
      spaceId: "sales",
      entity: "deals",
      idempotencyKey: "dashboard:deal",
      data: { title: "Deal", company: company.recordId },
    }).result;
    const detail = createDashboardProjection(client).records.detail({
      spaceId: "sales",
      entity: "deals",
      recordId: deal.recordId,
    });
    assert.equal(detail.result.references[0]?.target?.recordId, company.recordId);
    assert.equal(detail.result.references[0]?.target?.spaceId, "crm");
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("records.list rejects its reserved cursor instead of silently ignoring it", () => {
  const fix = fixture();
  const client = createDataClient({
    scope: fix.scope,
    actor: { kind: "human", id: "cursor-audit" },
    authorization: { mode: "local-operator" },
  });
  try {
    assert.equal(client.scope.workspaceId, "audit");
    createSpaceAndSchema(client, "cursor", "items");
    assert.throws(
      () => client.records.list({ spaceId: "cursor", entity: "items", cursor: "opaque" }),
      (error: unknown) => isDataRecordError(error) && error.code === "FIELD_INVALID",
    );
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("hardened wrappers preserve live closed state instead of spread snapshots", () => {
  const appFix = fixture("closed-app");
  const appClient = createDataClient({
    scope: appFix.scope,
    actor: { kind: "app", id: "closed-app" },
    authorization: { mode: "host-bound", capabilityRefs: ["data:allowed:items:read"] },
  });
  try {
    const app = createAppsDataKit(appClient, {
      app: "closed-app",
      scope: "workspace",
      data: {
        spaces: { allowed: { schemas: ["items"] } },
        capabilities: ["read"],
      },
    });
    assert.equal(app.closed, false);
    appClient.close();
    assert.equal(app.closed, true);
  } finally {
    appClient.close();
    appFix.cleanup();
  }

  const botFix = fixture("closed-bot");
  const botClient = createDataClient({
    scope: botFix.scope,
    actor: { kind: "bot", id: "closed-bot" },
    authorization: { mode: "host-bound", capabilityRefs: ["data:allowed:items:read"] },
  });
  try {
    const bot = createBotsDataAdapter(botClient, {
      workspaceId: "closed-bot",
      principal: { kind: "bot", id: "closed-bot" },
      taskId: "closed-task",
      capabilities: ["data:allowed:items:read"],
    });
    assert.equal(bot.closed, false);
    botClient.close();
    assert.equal(bot.closed, true);
  } finally {
    botClient.close();
    botFix.cleanup();
  }

  const humanFix = fixture("closed-human");
  const humanClient = createDataClient({
    scope: humanFix.scope,
    actor: { kind: "human", id: "closed-human" },
    authorization: { mode: "local-operator" },
  });
  try {
    const wrappers = [
      createMemoryBridge(humanClient),
      createDashboardProjection(humanClient),
      createConnectionsAuthority(humanClient),
      createAutomationEvents(humanClient),
    ];
    for (const wrapper of wrappers) assert.equal(wrapper.closed, false);
    humanClient.close();
    for (const wrapper of wrappers) assert.equal(wrapper.closed, true);
  } finally {
    humanClient.close();
    humanFix.cleanup();
  }
});

test("malformed App and Bot authority inputs fail with stable adapter errors", () => {
  const fix = fixture();
  const appClient = createDataClient({
    scope: fix.scope,
    actor: { kind: "app", id: "audit-app" },
    authorization: { mode: "host-bound", capabilityRefs: ["data:allowed:items:read"] },
  });
  try {
    createSpaceAndSchema(appClient, "allowed", "items");
    assert.throws(
      () => createAppsDataKit(appClient, {
        app: "audit-app",
        scope: "workspace",
        data: { spaces: { allowed: null as never }, capabilities: ["read"] },
      }),
      (error: unknown) => isAppsDataError(error) && error.code === "APPS_INVALID",
    );
  } finally {
    appClient.close();
  }
  const botClient = createDataClient({
    scope: fix.scope,
    actor: { kind: "bot", id: "audit-bot" },
    authorization: { mode: "host-bound", capabilityRefs: ["data:allowed:items:read"] },
  });
  try {
    assert.throws(
      () => createBotsDataAdapter(botClient, {
        workspaceId: "audit",
        principal: null as never,
        taskId: "audit-task",
        capabilities: ["data:allowed:items:read"],
      }),
      (error: unknown) => isBotsDataAdapterError(error) && error.code === "LEASE_INVALID",
    );
  } finally {
    botClient.close();
    fix.cleanup();
  }
});
