import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrustedDataRoot, createWorkspaceDataScope } from "../dist/src/scope/index.js";
import { createDataClient } from "../dist/src/client/index.js";

const rootPath = mkdtempSync(join(tmpdir(), "ex-backup-"));
mkdirSync(join(rootPath, "workspaces", "sales", "data"), { recursive: true });
const root = TrustedDataRoot.fromExistingDirectory(rootPath);
const scope = createWorkspaceDataScope(root, "sales");
const client = createDataClient({ scope, actor: { kind: "human", id: "owner" }, authorization: { mode: "local-operator" } });
client.spaces.create({ spaceId: "crm", name: "CRM", authority: "local_canonical" });
client.schemas.create({ spaceId: "crm", entity: "notes", name: "Notes", fields: { title: { type: "string", required: true } } });
client.records.create({ spaceId: "crm", entity: "notes", idempotencyKey: "ex:bk:1", data: { title: "Keep me" } });

const artifacts = mkdtempSync(join(tmpdir(), "ex-artifacts-"));
const backup = await client.backup.createBackup(join(artifacts, "backup"));
const verified = await client.backup.verifyBackup(join(artifacts, "backup"));
const exported = await client.backup.createPortableExport(join(artifacts, "export"));
console.log(`BACKUP-OK backup=${verified.manifest.artifactId === backup.manifest.artifactId} export=${exported.manifest.artifactId.length > 0}`);
client.close();
rmSync(rootPath, { recursive: true, force: true });
rmSync(artifacts, { recursive: true, force: true });
