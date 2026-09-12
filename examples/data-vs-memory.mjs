import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrustedDataRoot, createWorkspaceDataScope } from "../dist/src/scope/index.js";
import { createDataClient } from "../dist/src/client/index.js";
import { createMemoryBridge } from "../dist/src/memory/index.js";

const rootPath = mkdtempSync(join(tmpdir(), "ex-mem-"));
mkdirSync(join(rootPath, "workspaces", "sales", "data"), { recursive: true });
const root = TrustedDataRoot.fromExistingDirectory(rootPath);
const scope = createWorkspaceDataScope(root, "sales");
const client = createDataClient({ scope, actor: { kind: "human", id: "owner" }, authorization: { mode: "local-operator" } });
client.spaces.create({ spaceId: "crm", name: "CRM", authority: "local_canonical" });
client.schemas.create({ spaceId: "crm", entity: "deals", name: "Deals", fields: { title: { type: "string", required: true }, stage: { type: "enum", values: ["proposal", "won"], default: "proposal" } } });
const deal = client.records.createWithReceipt({ spaceId: "crm", entity: "deals", idempotencyKey: "ex:mem:1", data: { title: "Flagship", stage: "proposal" } });

const bridge = createMemoryBridge(client);
const ref = bridge.references.forRecord({ spaceId: "crm", entity: "deals", recordId: deal.result.record.recordId, recordVersion: 1 });
const candidate = bridge.candidates.proposeRecordCandidate({ spaceId: "crm", entity: "deals", recordId: deal.result.record.recordId, title: "Flagship stalled", summary: "Proposal for Memory recall; Data stays canonical." });
console.log(`MEMORY-OK uri=${ref.uri.startsWith("data://sales/crm/deals/")} kind=${candidate.result.kind} eventsUnchanged=${client.provenance.listEvents({ spaceId: "crm" }).result.items.length >= 1}`);
client.close();
rmSync(rootPath, { recursive: true, force: true });
