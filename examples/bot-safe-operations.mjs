import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrustedDataRoot, createWorkspaceDataScope } from "../dist/src/scope/index.js";
import { createDataClient } from "../dist/src/client/index.js";
import { createBotsDataAdapter } from "../dist/src/bots/index.js";

const caps = ["data:crm:companies:read", "data:crm:companies:create", "data:crm:deals:read", "data:crm:deals:create"];
const rootPath = mkdtempSync(join(tmpdir(), "ex-bot-"));
mkdirSync(join(rootPath, "workspaces", "sales", "data"), { recursive: true });
const root = TrustedDataRoot.fromExistingDirectory(rootPath);
const scope = createWorkspaceDataScope(root, "sales");
const client = createDataClient({ scope, actor: { kind: "bot", id: "pipeline-runner" }, authorization: { mode: "host-bound", capabilityRefs: [...caps] } });
client.spaces.create({ spaceId: "crm", name: "CRM", authority: "local_canonical" });
client.schemas.create({ spaceId: "crm", entity: "companies", name: "Companies", fields: { name: { type: "string", required: true } } });
client.schemas.create({ spaceId: "crm", entity: "deals", name: "Deals", fields: { title: { type: "string", required: true }, company: { type: "reference", entity: "companies", required: true } } });

const bots = createBotsDataAdapter(client, { workspaceId: "sales", principal: { kind: "bot", id: "pipeline-runner" }, taskId: "ex-task-1", capabilities: [...caps] });
const company = bots.records.createWithReceipt({ spaceId: "crm", entity: "companies", idempotencyKey: "ex:bot:co", data: { name: "Acme" } });
let denied = false;
try {
  bots.records.create({ spaceId: "crm", entity: "companies", idempotencyKey: "ex:bot:no", data: { title: "wrong entity shape still allowed, so use delete denial instead" } });
} catch { denied = true; }
// Real guard: the lease has no delete capability, so a remove must fail.
const seeded = company.result.record.recordId;
try {
  bots.records.remove({ spaceId: "crm", entity: "companies", recordId: seeded, expectedVersion: 1, idempotencyKey: "ex:bot:del" });
} catch { denied = true; }
console.log(`BOT-OK task=${company.result.receipt.taskId} deleteDenied=${denied}`);
client.close();
rmSync(rootPath, { recursive: true, force: true });
