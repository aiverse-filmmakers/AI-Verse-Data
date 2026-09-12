import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrustedDataRoot, createWorkspaceDataScope } from "../dist/src/scope/index.js";
import { createDataClient } from "../dist/src/client/index.js";
import { createAppsDataKit } from "../dist/src/apps/index.js";

const APP = "production-manager";
const rootPath = mkdtempSync(join(tmpdir(), "ex-prod-"));
mkdirSync(join(rootPath, "workspaces", "sales", "data"), { recursive: true });
const root = TrustedDataRoot.fromExistingDirectory(rootPath);
const scope = createWorkspaceDataScope(root, "sales");
const caps = ["data:production:productions:read", "data:production:productions:create", "data:production:productions:update"];
const client = createDataClient({ scope, actor: { kind: "app", id: APP }, authorization: { mode: "host-bound", capabilityRefs: [...caps] } });
client.spaces.create({ spaceId: "production", name: "Production", authority: "local_canonical" });
client.schemas.create({ spaceId: "production", entity: "productions", name: "Productions", fields: { title: { type: "string", required: true } } });

const kit = createAppsDataKit(client, { app: APP, scope: "workspace", data: { spaces: { production: { schemas: ["productions"] } }, capabilities: ["read", "create", "update"] } });
const created = kit.records.create({ spaceId: "production", entity: "productions", idempotencyKey: "ex:prod:1", data: { title: "Pilot" } });
const notice = kit.lifecycle.uninstallNotice();
console.log(`PRODUCTION-OK record=${created.result.recordId} uninstall=${notice.result.rule}`);
client.close();
rmSync(rootPath, { recursive: true, force: true });
