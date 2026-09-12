import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAppsDataKit } from "../src/apps/index.js";
import { createAutomationEvents } from "../src/automation/index.js";
import { createBotsDataAdapter } from "../src/bots/index.js";
import type { BotsDataCapabilityLease } from "../src/bots/errors.js";
import { createBrainDataAdapter } from "../src/brain/index.js";
import { createDataClient } from "../src/client/index.js";
import { createConnectionsAuthority } from "../src/connections/index.js";
import { createDashboardProjection } from "../src/dashboard/index.js";
import { createMemoryBridge } from "../src/memory/index.js";
import {
  TrustedDataRoot,
  createWorkspaceDataScope,
} from "../src/scope/index.js";

const APP = "production-manager";

function workspaceScope(workspaceId = "sales") {
  const rootPath = realpathSync(mkdtempSync(join(tmpdir(), "ai-verse-data-phase4-")));
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

function bootstrap(client: ReturnType<typeof createDataClient>): {
  readonly companyId: string;
  readonly dealId: string;
} {
  assert.equal(
    client.spaces.create({
      spaceId: "crm",
      name: "CRM",
      authority: "local_canonical",
    }).ok,
    true,
  );
  assert.equal(
    client.schemas.create({
      spaceId: "crm",
      entity: "companies",
      name: "Companies",
      fields: { name: { type: "string", required: true } },
    }).ok,
    true,
  );
  assert.equal(
    client.schemas.create({
      spaceId: "crm",
      entity: "deals",
      name: "Deals",
      fields: {
        title: { type: "string", required: true },
        value: { type: "number", min: 0, default: 0 },
        stage: {
          type: "enum",
          values: ["lead", "proposal", "won"],
          default: "lead",
        },
        company: { type: "reference", entity: "companies", required: true },
        sourceRef: { type: "json", required: false },
      },
    }).ok,
    true,
  );
  const company = client.records.createWithReceipt({
    spaceId: "crm",
    entity: "companies",
    idempotencyKey: "phase4:company:1",
    data: { name: "Acme" },
  });
  assert.equal(company.ok, true);
  const deal = client.records.createWithReceipt({
    spaceId: "crm",
    entity: "deals",
    idempotencyKey: "phase4:deal:1",
    data: {
      title: "Flagship",
      value: 120,
      stage: "proposal",
      company: company.result.record.recordId,
    },
  });
  assert.equal(deal.ok, true);
  return {
    companyId: company.result.record.recordId,
    dealId: deal.result.record.recordId,
  };
}

test("phase 4 adapters preserve ownership, scope, permissions, receipts, and optionality", () => {
  const fix = workspaceScope();
  const botCaps = [
    "data:crm:companies:read",
    "data:crm:companies:create",
    "data:crm:deals:read",
    "data:crm:deals:create",
    "data:crm:deals:update",
  ];
  const botClient = createDataClient({
    scope: fix.scope,
    actor: { kind: "bot", id: "pipeline-runner" },
    authorization: { mode: "host-bound", capabilityRefs: [...botCaps] },
  });
  let appClient: ReturnType<typeof createDataClient> | null = null;
  try {
    const seeded = bootstrap(botClient);
    bootstrapEventsBefore(botClient);

    // Client is the verbatim base: stable envelopes, scope, receipts.
    const page = botClient.query.query({
      spaceId: "crm",
      entity: "deals",
      where: { field: "stage", op: "eq", value: "proposal" },
      orderBy: [{ field: "value", direction: "desc" }],
      limit: 10,
    });
    assert.equal(page.ok, true);
    assert.equal(page.protocol, "ai-verse-data/0.1");
    assert.equal(page.operation, "data.query");
    assert.deepEqual(page.scope, { workspaceId: "sales" });
    assert.equal(page.result.items.length, 1);
    const aggregate = botClient.query.aggregate({
      spaceId: "crm",
      entity: "deals",
      metrics: [
        { op: "count", as: "count" },
        { op: "sum", field: "value", as: "sum" },
      ],
    });
    assert.equal(aggregate.ok, true);
    assert.equal(aggregate.result.values["count"], 1);
    assert.equal(aggregate.result.values["sum"], 120);

    // Leased Bot access: permission floor, Bot provenance, task receipts.
    const lease: BotsDataCapabilityLease = {
      workspaceId: "sales",
      principal: { kind: "bot", id: "pipeline-runner" },
      taskId: "phase4-task-1",
      artifactRef: "phase4-artifact-1",
      capabilities: [...botCaps],
    };
    const bots = createBotsDataAdapter(botClient, lease);
    const botDeal = bots.records.createWithReceipt({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "phase4:bot:deal",
      data: {
        title: "Bot follow-up",
        value: 40,
        stage: "lead",
        company: seeded.companyId,
      },
    });
    assert.equal(botDeal.ok, true);
    assert.equal(botDeal.result.receipt.taskId, "phase4-task-1");
    assert.equal(botDeal.result.receipt.artifactRef, "phase4-artifact-1");
    assert.equal(botDeal.result.receipt.receipt.actor.kind, "bot");
    assert.equal(botDeal.result.receipt.receipt.actor.id, "pipeline-runner");
    assert.throws(() =>
      bots.records.create({
        spaceId: "crm",
        entity: "companies",
        idempotencyKey: "phase4:bot:denied",
        data: { title: "Denied by model string only" },
      }),
    );

    // Model-written strings never grant access, even with a matching lease.
    assert.throws(() =>
      createBotsDataAdapter(
        botClient,
        { ...lease, capabilities: ["data:crm:deals:escalate"] },
      ),
    );
    assert.throws(() =>
      bots.records.remove({
        spaceId: "crm",
        entity: "deals",
        recordId: seeded.dealId,
        expectedVersion: 1,
        idempotencyKey: "phase4:bot:denied-delete",
      }),
    );

    // Brain answers stay read-only with question provenance and no goal copy.
    const brain = createBrainDataAdapter(botClient);
    const answer = brain.query.ask({
      spaceId: "crm",
      entity: "deals",
      where: { field: "stage", op: "eq", value: "proposal" },
      orderBy: [{ field: "value", direction: "desc" }],
      limit: 10,
    });
    assert.equal(answer.ok, true);
    assert.ok(answer.result.page.items.length >= 1);
    assert.deepEqual(answer.result.provenance.scope, {
      workspaceId: "sales",
    });
    assert.equal(answer.result.provenance.actor.kind, "bot");
    assert.ok(!("goal" in answer.result.page));
    assert.equal(
      typeof (brain.records as unknown as Record<string, unknown>)["create"],
      "undefined",
    );
    assert.equal(
      typeof (brain as unknown as Record<string, unknown>)["transactions"],
      "undefined",
    );

    // Memory bridges reference facts without copying canonical state.
    const memory = createMemoryBridge(botClient);
    const reference = memory.references.forRecord({
      spaceId: "crm",
      entity: "deals",
      recordId: seeded.dealId,
      recordVersion: 1,
    });
    assert.ok(reference.uri.startsWith("data://sales/crm/deals/"));
    assert.deepEqual(memory.references.parse(reference.uri), reference);
    const evidence = memory.evidence.lookupRecord({
      spaceId: "crm",
      entity: "deals",
      recordId: seeded.dealId,
      includeReceipt: true,
      idempotencyKey: "phase4:deal:1",
    });
    assert.equal(evidence.ok, true);
    assert.equal(evidence.result.record.recordId, seeded.dealId);
    const eventsBefore = botClient.provenance.listEvents({ spaceId: "crm" });
    assert.equal(eventsBefore.ok, true);
    const candidate = memory.candidates.proposeRecordCandidate({
      spaceId: "crm",
      entity: "deals",
      recordId: seeded.dealId,
      title: "Flagship stalled",
      summary: "Proposal for Memory recall without duplicating Data.",
    });
    assert.equal(candidate.ok, true);
    assert.equal(candidate.result.kind, "record_reference");
    const eventsAfter = botClient.provenance.listEvents({ spaceId: "crm" });
    assert.equal(eventsAfter.ok, true);
    assert.equal(
      eventsAfter.result.items.length,
      eventsBefore.result.items.length,
    );
    assert.equal(
      (memory as unknown as Record<string, unknown>)["writeMemory"],
      undefined,
    );

    // Dashboard serves bounded projections with no raw paths or systemId.
    const dashboard = createDashboardProjection(botClient);
    const table = dashboard.tables.view({
      spaceId: "crm",
      entity: "deals",
      where: { field: "stage", op: "eq", value: "proposal" },
      orderBy: [{ field: "value", direction: "desc" }],
      limit: 10,
    });
    assert.equal(table.ok, true);
    assert.ok(table.result.page.items.length >= 1);
    assert.deepEqual(table.result.provenance.scope, {
      workspaceId: "sales",
    });
    const detail = dashboard.records.detail({
      spaceId: "crm",
      entity: "deals",
      recordId: seeded.dealId,
    });
    assert.equal(detail.ok, true);
    assert.ok(
      detail.result.references.some((ref) => ref.field === "company"),
    );
    const health = dashboard.health.summary();
    assert.equal(health.ok, true);
    assert.equal(health.result.integrity.ok, true);
    assert.ok(
      !("systemId" in health.result.metadata) &&
        !("databasePath" in health.result.metadata),
    );
    const serialized = JSON.stringify({ table, detail, health });
    assert.ok(!serialized.includes("ai-verse-data.sqlite"));
    assert.ok(!serialized.includes(fix.rootPath));
    assert.equal(
      typeof (dashboard as unknown as Record<string, unknown>)["bulk"],
      "undefined",
    );

    // Apps kits scope to the manifest and preserve Data on uninstall.
    appClient = createDataClient({
      scope: fix.scope,
      actor: { kind: "app", id: APP },
      authorization: {
        mode: "host-bound",
        capabilityRefs: refsFor("crm", ["companies", "deals"], [
          "read",
          "create",
          "update",
        ]),
      },
    });
    const kit = createAppsDataKit(appClient, {
      app: APP,
      scope: "workspace",
      data: {
        spaces: { crm: { schemas: ["companies", "deals"] } },
        capabilities: ["read", "create", "update"],
      },
    });
    const appDeal = kit.records.createWithReceipt({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "phase4:app:deal",
      data: {
        title: "App upsell",
        value: 30,
        stage: "lead",
        company: seeded.companyId,
      },
    });
    assert.equal(appDeal.ok, true);
    assert.throws(() =>
      kit.records.get({
        spaceId: "crm",
        entity: "extras",
        recordId: "whatever",
      }),
    );
    assert.throws(() =>
      createAppsDataKit(appClient as ReturnType<typeof createDataClient>, {
        app: APP,
        scope: "workspace",
        data: {
          spaces: { crm: { schemas: ["deals"] } },
          // @ts-expect-error delete is never granted to Apps
          capabilities: ["delete"],
        },
      }),
    );
    const origin = kit.schemas.origin({
      spaceId: "crm",
      entity: "deals",
    });
    assert.equal(origin.ok, true);
    assert.equal(origin.result.originApp, null);
    const uninstall = kit.lifecycle.uninstallNotice();
    assert.equal(uninstall.ok, true);
    assert.equal(uninstall.result.rule, "preserve-data");
    const stillThere = botClient.records.get({
      spaceId: "crm",
      entity: "deals",
      recordId: appDeal.result.record.recordId,
    });
    assert.equal(stillThere.ok, true);

    // Connections keeps local authority with explicit one-way imports.
    const conn = createConnectionsAuthority(botClient);
    const policyOut = conn.policy.describe();
    assert.equal(policyOut.ok, true);
    assert.equal(policyOut.result.local, "local_canonical");
    assert.equal(policyOut.result.defaultDirection, "import-only");
    const imported = conn.records.import({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "phase4:conn:deal",
      data: {
        title: "Imported",
        value: 15,
        stage: "lead",
        company: seeded.companyId,
      },
      source: {
        connectionId: "hubspot-prod",
        externalSystem: "HubSpot",
        externalId: "hs-900",
        authority: "external_canonical",
        direction: "import-only",
      },
    });
    assert.equal(imported.ok, true);
    assert.equal(imported.result.source.externalId, "hs-900");
    assert.equal(imported.result.source.sync, "import-only");
    assert.equal(imported.result.provenance.direction, "import-only");
    const classified = conn.authority.classify({
      spaceId: "crm",
      entity: "deals",
    });
    assert.equal(classified.result.authority, "local_canonical");
    const syncNotice = conn.lifecycle.syncNotice();
    assert.equal(syncNotice.ok, true);
    assert.equal(syncNotice.result.rule, "no-implicit-bidirectional-sync");
    assert.equal(
      typeof (conn as unknown as Record<string, unknown>)["export"],
      "undefined",
    );
    assert.throws(() =>
      conn.sources.ref({
        connectionId: "x",
        externalSystem: "HubSpot",
        externalId: "hs-1",
        authority: "snapshot",
        direction: "both" as unknown as "none",
      }),
    );

    // Automation emits facts only; consumers decide what to do with them.
    const automation = createAutomationEvents(botClient);
    const dealsFilter = { spaceId: "crm", entity: "deals" } as const;
    const createdFilter = {
      ...dealsFilter,
      eventTypes: ["record.created"] as unknown as ["record.created"],
    };
    const poll = automation.events.poll(createdFilter);
    assert.equal(poll.ok, true);
    assert.ok(poll.result.envelopes.length >= 4);
    for (const envelope of poll.result.envelopes) {
      assert.deepEqual(envelope.scope, { workspaceId: "sales" });
      assert.ok(Date.parse(envelope.emittedAt) > 0);
    }
    const autoReceipt = automation.receipts.byKey("phase4:deal:1");
    assert.equal(autoReceipt.ok, true);
    const schedulerNotice = automation.policy.notice();
    assert.equal(schedulerNotice.ok, true);
    assert.equal(schedulerNotice.result.rule, "no-scheduler-in-data");
    const replay = botClient.records.create({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "phase4:deal:1",
      data: {
        title: "Flagship",
        value: 120,
        stage: "proposal",
        company: seeded.companyId,
      },
    });
    assert.equal(replay.ok, true);
    const repoll = automation.events.poll(createdFilter);
    assert.equal(repoll.ok, true);
    assert.equal(
      repoll.result.envelopes.length,
      poll.result.envelopes.length,
    );
    assert.equal(
      typeof (automation as unknown as Record<string, unknown>)["scheduler"],
      "undefined",
    );

    // Receipts resolve from every surface against the same canonical fact.
    const receiptId = autoReceipt.result.receiptId;
    assert.equal(
      botClient.provenance.getReceipt(receiptId).result.receiptId,
      receiptId,
    );
    assert.equal(
      brain.provenance.getReceipt(receiptId).result.receipt.receiptId,
      receiptId,
    );
    assert.equal(
      dashboard.receipts.get(receiptId).result.receipt.receiptId,
      receiptId,
    );
    assert.equal(
      automation.receipts.get(receiptId).result.receiptId,
      receiptId,
    );

    // Optionality: a consumer can be absent without blocking the base.
    assert.equal(
      typeof (memory as unknown as Record<string, unknown>)["writeMemory"],
      "undefined",
    );
    assert.equal(
      typeof (automation as unknown as Record<string, unknown>)["trigger"],
      "undefined",
    );
  } finally {
    botClient.close();
    if (appClient !== null) appClient.close();
    fix.cleanup();
  }

  // Isolation: a second workspace never sees the first workspace's facts.
  const second = workspaceScope("support");
  const secondClient = createDataClient({
    scope: second.scope,
    actor: { kind: "bot", id: "pipeline-runner" },
    authorization: { mode: "host-bound", capabilityRefs: [...botCaps] },
  });
  try {
    const secondBots = createBotsDataAdapter(secondClient, {
      workspaceId: "support",
      principal: { kind: "bot", id: "pipeline-runner" },
      taskId: "phase4-task-2",
      capabilities: [...botCaps],
    });
    assert.throws(() =>
      secondBots.records.get({
        spaceId: "crm",
        entity: "deals",
        recordId: "phase4-deal",
      }),
    );
    const secondBrain = createBrainDataAdapter(secondClient);
    assert.throws(() =>
      secondBrain.records.list({
        spaceId: "crm",
        entity: "deals",
        limit: 10,
      }),
    );
    const secondMemory = createMemoryBridge(secondClient);
    assert.throws(() =>
      secondMemory.evidence.lookupRecord({
        spaceId: "crm",
        entity: "deals",
        recordId: "phase4-deal",
      }),
    );
  } finally {
    secondClient.close();
    second.cleanup();
  }
});

test("phase 4 negative branches fail closed without mutation", () => {
  const fix = workspaceScope();
  const caps = ["data:crm:deals:read"];
  const client = createDataClient({
    scope: fix.scope,
    actor: { kind: "bot", id: "pipeline-runner" },
    authorization: { mode: "host-bound", capabilityRefs: [...caps] },
  });
  try {
    assert.equal(
      client.spaces.create({
        spaceId: "crm",
        name: "CRM",
        authority: "local_canonical",
      }).ok,
      true,
    );
    assert.equal(
      client.schemas.create({
        spaceId: "crm",
        entity: "deals",
        name: "Deals",
        fields: {
          title: { type: "string", required: true },
          value: { type: "number", min: 0, default: 0 },
          stage: {
            type: "enum",
            values: ["lead", "proposal", "won"],
            default: "lead",
          },
        },
      }).ok,
      true,
    );

    // Wrong workspace lease and principal mismatch fail at construction.
    assert.throws(() =>
      createBotsDataAdapter(client, {
        workspaceId: "support",
        principal: { kind: "bot", id: "pipeline-runner" },
        taskId: "phase4-negative",
        capabilities: [...caps],
      }),
    );
    assert.throws(() =>
      createBotsDataAdapter(client, {
        workspaceId: "sales",
        principal: { kind: "bot", id: "someone-else" },
        taskId: "phase4-negative",
        capabilities: [...caps],
      }),
    );

    // Expired leases fail closed on first use, never at rest.
    const expired = createBotsDataAdapter(client, {
      workspaceId: "sales",
      principal: { kind: "bot", id: "pipeline-runner" },
      taskId: "phase4-negative",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      capabilities: [...caps],
    });
    assert.throws(() =>
      expired.records.list({
        spaceId: "crm",
        entity: "deals",
        limit: 10,
      }),
    );

    // Read-only scopes never authorize writes, kits, or imports.
    const readBots = createBotsDataAdapter(client, {
      workspaceId: "sales",
      principal: { kind: "bot", id: "pipeline-runner" },
      taskId: "phase4-negative",
      capabilities: [...caps],
    });
    assert.throws(() =>
      readBots.records.create({
        spaceId: "crm",
        entity: "deals",
        idempotencyKey: "phase4:negative:1",
        data: { title: "No", value: 1, stage: "lead" },
      }),
    );
    const readBrain = createBrainDataAdapter(client);
    assert.throws(() =>
      readBrain.query.ask({
        spaceId: "crm",
        entity: "deals",
        limit: 500,
      }),
    );
    const readDashboard = createDashboardProjection(client);
    assert.throws(() =>
      readDashboard.tables.view({
        spaceId: "crm",
        entity: "deals",
        limit: 500,
      }),
    );

    // Malformed references, cursors, and source claims stay rejected.
    const readMemory = createMemoryBridge(client);
    assert.throws(() =>
      readMemory.references.parse("memory://sales/crm/deals/x"),
    );
    assert.throws(() =>
      readMemory.evidence.lookupByReference("data://support/crm/deals/abc@1"),
    );
    const readAutomation = createAutomationEvents(client);
    assert.throws(() => readAutomation.events.poll({ spaceId: "CRM" }));
    const readConn = createConnectionsAuthority(client);
    assert.throws(() =>
      readConn.sources.ref({
        connectionId: "x",
        externalSystem: "HubSpot",
        externalId: "hs-1",
        authority: "snapshot",
        direction: "both" as unknown as "none",
      }),
    );

    const events = client.provenance.listEvents({ spaceId: "crm" });
    assert.equal(events.ok, true);
    assert.equal(events.result.items.length, 0);
  } finally {
    client.close();
    fix.cleanup();
  }
});

function bootstrapEventsBefore(
  client: ReturnType<typeof createDataClient>,
): void {
  const events = client.provenance.listEvents({ spaceId: "crm" });
  assert.equal(events.ok, true);
  assert.ok(events.result.items.length >= 2);
}
