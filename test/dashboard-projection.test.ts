import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDataClient } from "../src/client/index.js";
import { createDashboardProjection } from "../src/dashboard/index.js";
import {
  DashboardProjectionError,
  isDashboardProjectionError,
} from "../src/dashboard/errors.js";
import {
  TrustedDataRoot,
  createWorkspaceDataScope,
} from "../src/scope/index.js";

const actor = { kind: "human", id: "dashboard-viewer" } as const;
const authorization = { mode: "local-operator" } as const;

function workspaceScope(workspaceId = "sales") {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-dashboard-"));
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

function dashboardSetup() {
  const fix = workspaceScope();
  const client = createDataClient({
    scope: fix.scope,
    actor: { ...actor },
    authorization: { ...authorization },
  });
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
      },
    }).ok,
    true,
  );
  return { fix, client };
}

test("spaces, schemas, tables, and forms project without raw paths", () => {
  const { fix, client } = dashboardSetup();
  try {
    const company = client.records.create({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "dash:company:1",
      data: { name: "Acme" },
    });
    assert.equal(company.ok, true);
    for (const [key, value, stage] of [
      ["dash:deal:1", 40, "proposal"],
      ["dash:deal:2", 60, "won"],
    ] as const) {
      assert.equal(
        client.records.create({
          spaceId: "crm",
          entity: "deals",
          idempotencyKey: key,
          data: {
            title: `Deal ${key}`,
            value,
            stage,
            company: company.result.recordId,
          },
        }).ok,
        true,
      );
    }

    const dash = createDashboardProjection(client);
    const spaces = dash.spaces.list();
    assert.equal(spaces.ok, true);
    assert.equal(spaces.result.length, 1);
    const card = dash.spaces.card({ spaceId: "crm" });
    assert.equal(card.ok, true);
    assert.equal(card.result.schemaCount, 2);

    const schemas = dash.schemas.list({ spaceId: "crm" });
    assert.equal(schemas.ok, true);
    assert.equal(schemas.result.length, 2);
    const form = dash.schemas.form({ spaceId: "crm", entity: "deals" });
    assert.equal(form.ok, true);
    assert.ok(form.result.fields.length >= 4);
    assert.ok(
      form.result.fields.every((field) => typeof field.name === "string"),
    );

    const table = dash.tables.view({
      spaceId: "crm",
      entity: "deals",
      where: { field: "stage", op: "eq", value: "proposal" },
      orderBy: [{ field: "value", direction: "desc" }],
      limit: 10,
    });
    assert.equal(table.ok, true);
    assert.equal(table.result.page.items.length, 1);
    assert.equal(table.result.schema.entity, "deals");
    assert.equal(table.result.provenance.recordCount, 1);
    assert.deepEqual(table.result.provenance.scope, {
      workspaceId: "sales",
    });

    const serialized = JSON.stringify(table);
    assert.ok(!serialized.includes("ai-verse-data.sqlite"));
    assert.ok(!serialized.includes(fix.rootPath));
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("record details resolve relations with provenance, charts aggregate", () => {
  const { fix, client } = dashboardSetup();
  try {
    const company = client.records.create({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "dash:company:detail",
      data: { name: "Detail Co" },
    });
    assert.equal(company.ok, true);
    const deal = client.records.create({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "dash:deal:detail",
      data: {
        title: "Detail deal",
        value: 120,
        stage: "proposal",
        company: company.result.recordId,
      },
    });
    assert.equal(deal.ok, true);

    const dash = createDashboardProjection(client);
    const detail = dash.records.detail({
      spaceId: "crm",
      entity: "deals",
      recordId: deal.result.recordId,
    });
    assert.equal(detail.ok, true);
    assert.equal(detail.result.record.recordId, deal.result.recordId);
    assert.equal(detail.result.provenance.recordCount, 1);
    const companyRef = detail.result.references.find(
      (ref) => ref.field === "company",
    );
    assert.ok(companyRef !== undefined);
    assert.equal(
      companyRef.target?.recordId,
      company.result.recordId,
    );

    const chart = dash.charts.aggregate({
      spaceId: "crm",
      entity: "deals",
      metrics: [
        { op: "count", as: "dealCount" },
        { op: "sum", field: "value", as: "totalValue" },
      ],
    });
    assert.equal(chart.ok, true);
    assert.equal(chart.result.values["dealCount"], 1);
    assert.equal(chart.result.values["totalValue"], 120);

    const listed = dash.records.list({
      spaceId: "crm",
      entity: "deals",
      limit: 50,
    });
    assert.equal(listed.ok, true);
    assert.equal(listed.result.length, 1);
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("record details resolve declared cross-space references", () => {
  const { fix, client } = dashboardSetup();
  try {
    assert.equal(
      client.spaces.create({
        spaceId: "accounts",
        name: "Accounts",
        authority: "local_canonical",
      }).ok,
      true,
    );
    assert.equal(
      client.schemas.create({
        spaceId: "accounts",
        entity: "clients",
        name: "Clients",
        fields: { name: { type: "string", required: true } },
      }).ok,
      true,
    );
    assert.equal(
      client.schemas.create({
        spaceId: "crm",
        entity: "cross-deals",
        name: "Cross Deals",
        fields: {
          title: { type: "string", required: true },
          client: {
            type: "reference",
            spaceId: "accounts",
            entity: "clients",
            required: true,
          },
        },
      }).ok,
      true,
    );

    const target = client.records.create({
      spaceId: "accounts",
      entity: "clients",
      idempotencyKey: "dash:cross:client",
      data: { name: "Cross-space Co" },
    });
    assert.equal(target.ok, true);
    const source = client.records.create({
      spaceId: "crm",
      entity: "cross-deals",
      idempotencyKey: "dash:cross:deal",
      data: {
        title: "Cross-space deal",
        client: target.result.recordId,
      },
    });
    assert.equal(source.ok, true);

    const detail = createDashboardProjection(client).records.detail({
      spaceId: "crm",
      entity: "cross-deals",
      recordId: source.result.recordId,
    });
    assert.equal(detail.ok, true);
    const resolved = detail.result.references.find(
      (reference) => reference.field === "client",
    );
    assert.ok(resolved !== undefined);
    assert.equal(resolved.target?.spaceId, "accounts");
    assert.equal(resolved.target?.entity, "clients");
    assert.equal(resolved.target?.recordId, target.result.recordId);
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("events, receipts, and health stay read-only with no systemId", () => {
  const { fix, client } = dashboardSetup();
  try {
    const company = client.records.createWithReceipt({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "dash:company:evt",
      data: { name: "Evt Co" },
    });
    assert.equal(company.ok, true);

    const dash = createDashboardProjection(client);
    const history = dash.events.history({ spaceId: "crm" });
    assert.equal(history.ok, true);
    assert.ok(history.result.page.items.length >= 1);
    assert.ok(history.result.provenance.recordCount >= 1);

    const receipt = dash.receipts.byKey("dash:company:evt");
    assert.equal(receipt.ok, true);
    assert.equal(
      receipt.result.receipt.recordId,
      company.result.record.recordId,
    );
    const byId = dash.receipts.get(receipt.result.receipt.receiptId);
    assert.equal(byId.ok, true);

    const health = dash.health.summary();
    assert.equal(health.ok, true);
    assert.equal(health.result.metadata.workspaceId, "sales");
    assert.ok(health.result.diagnostics.sqliteVersion.length > 0);
    assert.equal(health.result.integrity.ok, true);
    assert.equal(health.result.migration.state, "current");
    assert.ok(
      !("systemId" in health.result.metadata) &&
        !("databasePath" in health.result.metadata),
    );
    const healthSerialized = JSON.stringify(health);
    assert.ok(!healthSerialized.includes("ai-verse-data.sqlite"));

    assert.equal(
      (dash as unknown as Record<string, unknown>)["transactions"],
      undefined,
    );
    assert.equal(
      typeof (dash as unknown as Record<string, unknown>)["bulk"],
      "undefined",
    );
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("ceilings, isolation, closed client, and invalid adapter fail closed", () => {
  const { fix, client } = dashboardSetup();
  try {
    const dash = createDashboardProjection(client);
    assert.throws(
      () =>
        dash.tables.view({ spaceId: "crm", entity: "deals", limit: 500 }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        return true;
      },
    );
    assert.throws(
      () =>
        dash.records.detail({
          spaceId: "crm",
          entity: "missing",
          recordId: "whatever",
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        return true;
      },
    );
    assert.throws(
      () =>
        createDashboardProjection(
          null as unknown as ReturnType<typeof createDataClient>,
        ),
      (error: unknown) => {
        assert.ok(error instanceof DashboardProjectionError);
        assert.equal(error.code, "DASHBOARD_INVALID");
        return true;
      },
    );

    client.close();
    assert.equal(dash.closed, true);
    assert.throws(
      () => dash.spaces.list(),
      (error: unknown) => {
        assert.ok(isDashboardProjectionError(error));
        assert.equal(
          (error as DashboardProjectionError).code,
          "DASHBOARD_CLOSED",
        );
        return true;
      },
    );
  } finally {
    fix.cleanup();
  }

  const second = workspaceScope("support");
  const secondClient = createDataClient({
    scope: second.scope,
    actor: { ...actor },
    authorization: { ...authorization },
  });
  try {
    const secondDash = createDashboardProjection(secondClient);
    assert.throws(
      () => secondDash.spaces.get({ spaceId: "crm" }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        return true;
      },
    );
  } finally {
    secondClient.close();
    second.cleanup();
  }
});
