import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrustedDataRoot, createWorkspaceDataScope } from "../dist/src/scope/index.js";
import { createDataClient } from "../dist/src/client/index.js";

const rootPath = mkdtempSync(join(tmpdir(), "ex-content-"));
mkdirSync(join(rootPath, "workspaces", "studio", "data"), { recursive: true });
const root = TrustedDataRoot.fromExistingDirectory(rootPath);
const scope = createWorkspaceDataScope(root, "studio");
const client = createDataClient({ scope, actor: { kind: "human", id: "editor" }, authorization: { mode: "local-operator" } });

client.spaces.create({ spaceId: "content", name: "Content", authority: "local_canonical" });
client.schemas.create({ spaceId: "content", entity: "posts", name: "Posts", fields: { title: { type: "string", required: true }, status: { type: "enum", values: ["draft", "scheduled", "published"], default: "draft" } } });
client.records.create({ spaceId: "content", entity: "posts", idempotencyKey: "ex:post:1", data: { title: "Launch notes", status: "scheduled" } });
client.records.create({ spaceId: "content", entity: "posts", idempotencyKey: "ex:post:2", data: { title: "Recap", status: "draft" } });
const page = client.query.query({ spaceId: "content", entity: "posts", where: { field: "status", op: "eq", value: "scheduled" }, limit: 10 });
console.log(`CONTENT-OK scheduled=${page.result.items.length}`);
client.close();
rmSync(rootPath, { recursive: true, force: true });
