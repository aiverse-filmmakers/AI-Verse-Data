import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrustedDataRoot, createWorkspaceDataScope } from "../dist/src/scope/index.js";
import { createDataClient } from "../dist/src/client/index.js";

const rootPath = mkdtempSync(join(tmpdir(), "ex-crm-"));
mkdirSync(join(rootPath, "workspaces", "sales", "data"), { recursive: true });
const root = TrustedDataRoot.fromExistingDirectory(rootPath);
const scope = createWorkspaceDataScope(root, "sales");
const client = createDataClient({ scope, actor: { kind: "human", id: "crm-owner" }, authorization: { mode: "local-operator" } });

client.spaces.create({ spaceId: "crm", name: "CRM", authority: "local_canonical" });
client.schemas.create({ spaceId: "crm", entity: "companies", name: "Companies", fields: { name: { type: "string", required: true } } });
client.schemas.create({ spaceId: "crm", entity: "deals", name: "Deals", fields: { title: { type: "string", required: true }, value: { type: "number", min: 0, default: 0 }, stage: { type: "enum", values: ["lead", "proposal", "won"], default: "lead" }, company: { type: "reference", entity: "companies", required: true } } });

const company = client.records.create({ spaceId: "crm", entity: "companies", idempotencyKey: "ex:crm:co", data: { name: "Acme" } });
const deal = client.records.createWithReceipt({ spaceId: "crm", entity: "deals", idempotencyKey: "ex:crm:deal", data: { title: "Flagship", value: 120, stage: "proposal", company: company.result.recordId } });
const page = client.query.query({ spaceId: "crm", entity: "deals", where: { field: "stage", op: "eq", value: "proposal" }, limit: 10 });
const agg = client.query.aggregate({ spaceId: "crm", entity: "deals", metrics: [{ op: "count", as: "count" }, { op: "sum", field: "value", as: "sum" }] });
console.log(`CRM-OK deals=${page.result.items.length} count=${agg.result.values["count"]} receipt=${deal.result.receipt.receiptId}`);
client.close();
rmSync(rootPath, { recursive: true, force: true });
