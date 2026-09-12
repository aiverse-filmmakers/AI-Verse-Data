import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDataClient } from "../src/client/index.js";
import { createConnectionsAuthority } from "../src/connections/index.js";
import {
  ConnectionsAuthorityError,
  isConnectionsAuthorityError,
} from "../src/connections/errors.js";
import {
  TrustedDataRoot,
  createWorkspaceDataScope,
} from "../src/scope/index.js";

const actor = { kind: "connection", id: "hubspot-link" } as const;
const authorization = { mode: "host-bound", capabilityRefs: [] as string[] } as unknown as {
  mode: "host-bound";
  capabilityRefs: string[];
};

function workspaceScope(workspaceId = "sales") {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-connections-"));
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

function connectionsSetup() {
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
      entity: "contacts",
      name: "Contacts",
      fields: {
        name: { type: "string", required: true },
        email: { type: "string", required: false },
        sourceRef: { type: "json", required: false },
      },
    }).ok,
    true,
  );
  return { fix, client };
}

test("local authority reported and future classes named but not built", () => {
  const { fix, client } = connectionsSetup();
  try {
    const conn = createConnectionsAuthority(client);
    const policy = conn.policy.describe();
    assert.equal(policy.ok, true);
    assert.equal(policy.result.local, "local_canonical");
    assert.deepEqual([...policy.result.external], [
      "external_canonical",
      "replicated",
      "snapshot",
      "derived",
    ]);
    assert.equal(policy.result.defaultDirection, "import-only");

    const classified = conn.authority.classify({
      spaceId: "crm",
      entity: "contacts",
    });
    assert.equal(classified.ok, true);
    assert.equal(classified.result.authority, "local_canonical");

    const notice = conn.lifecycle.syncNotice();
    assert.equal(notice.ok, true);
    assert.equal(notice.result.direction, "import-only");
    assert.equal(notice.result.rule, "no-implicit-bidirectional-sync");

    assert.equal(
      (conn as unknown as Record<string, unknown>)["syncEngine"],
      undefined,
    );
    assert.equal(
      typeof (conn as unknown as Record<string, unknown>)["replicate"],
      "undefined",
    );
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("explicit import keeps external IDs plus provenance, replay safe", () => {
  const { fix, client } = connectionsSetup();
  try {
    const conn = createConnectionsAuthority(client);
    const first = conn.records.import({
      spaceId: "crm",
      entity: "contacts",
      idempotencyKey: "conn:hubspot:contact:42",
      data: { name: "Ada", email: "ada@example.com" },
      source: {
        connectionId: "hubspot-prod",
        externalSystem: "HubSpot",
        externalId: "hs-42",
        externalVersion: "v7",
        authority: "external_canonical",
        direction: "import-only",
      },
    });
    assert.equal(first.ok, true);
    assert.equal(first.result.source.externalSystem, "HubSpot");
    assert.equal(first.result.source.externalId, "hs-42");
    assert.equal(first.result.source.externalVersion, "v7");
    assert.equal(first.result.source.authority, "external_canonical");
    assert.equal(first.result.source.sync, "import-only");
    assert.ok(
      first.result.source.uri.startsWith(
        "connections://hubspot-prod/HubSpot/hs-42?",
      ),
    );
    assert.equal(first.result.provenance.direction, "import-only");
    assert.deepEqual(first.result.provenance.scope, { workspaceId: "sales" });
    const stored = first.result.record.data as Record<string, unknown>;
    assert.deepEqual((stored["sourceRef"] as Record<string, unknown>)["externalId"], "hs-42");

    const replay = conn.records.import({
      spaceId: "crm",
      entity: "contacts",
      idempotencyKey: "conn:hubspot:contact:42",
      data: { name: "Ada", email: "ada@example.com" },
      source: {
        connectionId: "hubspot-prod",
        externalSystem: "HubSpot",
        externalId: "hs-42",
        externalVersion: "v7",
        authority: "external_canonical",
      },
    });
    assert.equal(replay.ok, true);
    assert.equal(
      replay.result.record.recordId,
      first.result.record.recordId,
    );

    const fetched = conn.records.get({
      spaceId: "crm",
      entity: "contacts",
      recordId: first.result.record.recordId,
    });
    assert.equal(fetched.ok, true);

    const page = conn.query.query({
      spaceId: "crm",
      entity: "contacts",
      limit: 10,
    });
    assert.equal(page.ok, true);
    assert.equal(page.result.items.length, 1);
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("source refs round-trip, reads stay local, sync never implied", () => {
  const { fix, client } = connectionsSetup();
  try {
    const conn = createConnectionsAuthority(client);
    const ref = conn.sources.ref({
      connectionId: "stripe-prod",
      externalSystem: "Stripe",
      externalId: "cus_123",
      authority: "snapshot",
      direction: "none",
    });
    assert.equal(ref.sync, "none");
    assert.ok(ref.uri.includes("authority=snapshot"));
    const parsed = conn.sources.parse(ref.uri);
    assert.deepEqual(parsed, ref);

    const local = conn.records.import({
      spaceId: "crm",
      entity: "contacts",
      idempotencyKey: "conn:local:1",
      data: { name: "Local only" },
      source: {
        connectionId: "sheets-prod",
        externalSystem: "Sheets",
        externalId: "row-9",
        authority: "derived",
        direction: "none",
      },
    });
    assert.equal(local.ok, true);
    assert.equal(local.result.provenance.direction, "none");
    const classified = conn.authority.classify({
      spaceId: "crm",
      entity: "contacts",
    });
    assert.equal(classified.result.authority, "local_canonical");

    assert.equal(
      typeof (conn as unknown as Record<string, unknown>)["export"],
      "undefined",
    );
    assert.throws(
      () =>
        conn.sources.ref({
          connectionId: "x",
          externalSystem: "HubSpot",
          externalId: "hs-1",
          authority: "local_canonical" as unknown as "snapshot",
        }),
      (error: unknown) => isConnectionsAuthorityError(error),
    );
    assert.throws(
      () =>
        conn.sources.ref({
          connectionId: "x",
          externalSystem: "HubSpot",
          externalId: "hs-1",
          authority: "snapshot",
          direction: "both" as unknown as "none",
        }),
      (error: unknown) => isConnectionsAuthorityError(error),
    );
  } finally {
    client.close();
    fix.cleanup();
  }
});

test("malformed refs, conflicts, closed client, and invalid adapter fail closed", () => {
  const { fix, client } = connectionsSetup();
  try {
    const conn = createConnectionsAuthority(client);
    assert.throws(
      () => conn.sources.parse("data://sales/crm/contacts/x"),
      (error: unknown) => {
        assert.ok(error instanceof ConnectionsAuthorityError);
        assert.equal(error.code, "CONNECTIONS_INVALID");
        return true;
      },
    );
    assert.throws(
      () => conn.sources.parse("connections://only-two/parts"),
      (error: unknown) => isConnectionsAuthorityError(error),
    );
    assert.throws(
      () =>
        conn.records.import({
          spaceId: "crm",
          entity: "contacts",
          idempotencyKey: "conn:bad:1",
          data: { unknownField: "Bad" },
          source: {
            connectionId: "hubspot-prod",
            externalSystem: "HubSpot",
            externalId: "hs-9",
            authority: "external_canonical",
            direction: "import-only",
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        return true;
      },
    );
    assert.throws(
      () =>
        createConnectionsAuthority(
          null as unknown as ReturnType<typeof createDataClient>,
        ),
      (error: unknown) => {
        assert.ok(error instanceof ConnectionsAuthorityError);
        return true;
      },
    );

    client.close();
    assert.equal(conn.closed, true);
    assert.throws(
      () => conn.policy.describe(),
      (error: unknown) => {
        assert.ok(error instanceof ConnectionsAuthorityError);
        assert.equal(error.code, "CONNECTIONS_CLOSED");
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
    const secondConn = createConnectionsAuthority(secondClient);
    assert.throws(
      () =>
        secondConn.records.get({
          spaceId: "crm",
          entity: "contacts",
          recordId: "whatever",
        }),
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
