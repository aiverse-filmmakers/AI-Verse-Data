import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, lstatSync, readFileSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDataClient } from "../src/client/index.js";
import { createBotsDataAdapter } from "../src/bots/index.js";
import {
  TrustedDataRoot,
  createWorkspaceDataScope,
  DataScopeError,
} from "../src/scope/index.js";
import { SqliteStorageDriver } from "../src/storage/index.js";
import {
  AiVerseDataExtensionInstaller,
} from "../src/native/index.js";
import {
  readRegistryDocument,
  validateAiVerseOsExtensionRelativePath,
} from "../src/native/extension-registry.js";

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}
function cleanup(p: string): void {
  rmSync(p, { recursive: true, force: true });
}
function scopeErrorCode(e: unknown): string {
  return e instanceof DataScopeError ? e.code : `WRONG:${String((e as Error)?.message ?? e).slice(0, 60)}`;
}
function anyCode(e: unknown): string {
  return String((e as { code?: unknown })?.code ?? (e as Error)?.message ?? e);
}

function writeHost(root: string): void {
  writeFileSync(join(root, "AI-VERSE.yaml"), 'schema_version: "2.0"\narchitecture: unified-workspace\n', "utf8");
  writeFileSync(join(root, "AGENTS.md"), "# Runtime\n", "utf8");
  mkdirSync(join(root, "operator"), { recursive: true });
  mkdirSync(join(root, "workspaces"), { recursive: true });
  mkdirSync(join(root, "system", "extensions"), { recursive: true });
  writeFileSync(join(root, "system", "extensions", "README.md"), "# Local extensions\nRegistry: .aiverse/extensions/registry.json\n", "utf8");
}

// 1. Traversal: workspace IDs + extension paths + scope segments
test("adversarial traversal segments fail closed", () => {
  const rootPath = tempDir("adv-traversal-");
  try {
    const root = TrustedDataRoot.fromExistingDirectory(rootPath);
    for (const bad of ["../other", "..", ".", "", "a/b", "a\\b", "a/b", "sales/../other", "%2e%2e/other"]) {
      assert.throws(() => createWorkspaceDataScope(root, bad), (e: unknown) => scopeErrorCode(e) === "WORKSPACE_ID_UNSAFE", bad);
    }
    for (const bad of ["../outside", "a/../outside", "/tmp/outside", "a//b", "a/./b", "a\u0000b"]) {
      assert.throws(() => validateAiVerseOsExtensionRelativePath(bad), () => true, bad);
    }
    // NUL root rejected
    assert.throws(() => TrustedDataRoot.fromExistingDirectory("a\u0000b"), (e: unknown) => scopeErrorCode(e) === "ROOT_INVALID");
  } finally { cleanup(rootPath); }
});

// 2. Symlink escape: scoped resolve refuses linked components (posix; windows covered by junction test below)
test("adversarial symlink components refuse escape", { skip: process.platform === "win32" }, () => {
  const rootPath = tempDir("adv-symlink-");
  const outside = tempDir("adv-outside-");
  try {
    mkdirSync(join(rootPath, "workspaces"), { recursive: true });
    symlinkSync(outside, join(rootPath, "workspaces", "escaped"));
    const root = TrustedDataRoot.fromExistingDirectory(rootPath);
    const scope = createWorkspaceDataScope(root, "escaped");
    assert.throws(() => scope.databasePath(), (e: unknown) => scopeErrorCode(e) === "PATH_SYMLINK_UNSAFE");
  } finally { cleanup(rootPath); cleanup(outside); }
});

// 3. Windows paths: drive, UNC, reserved names, trailing dot/space, unsafe chars
test("adversarial windows paths fail closed", () => {
  const rootPath = tempDir("adv-win-");
  try {
    const root = TrustedDataRoot.fromExistingDirectory(rootPath);
    for (const bad of ["CON", "con", "PRN", "AUX", "NUL", "COM1", "LPT1", "trailing.", "trailing ", "team:name", 'a"b', "a<b", "a|b", "C:\\x", "..\\other"]) {
      assert.throws(() => createWorkspaceDataScope(root, bad), (e: unknown) => scopeErrorCode(e) === "WORKSPACE_ID_UNSAFE", bad);
    }
    for (const bad of ["C:\\outside\\file", "C:/outside", "\\\\server\\share", "//server/share"]) {
      assert.throws(() => validateAiVerseOsExtensionRelativePath(bad), () => true, bad);
    }
  } finally { cleanup(rootPath); }
});

// 4. Malformed registries fail closed before any Data file materialization
test("adversarial malformed registries fail closed with no owned files", () => {
  const cases: Array<{ name: string; text: string }> = [
    { name: "not-json", text: "{not json\n" },
    { name: "array-doc", text: "[]\n" },
    { name: "null-doc", text: "null\n" },
    { name: "missing-schema", text: '{"extensions":{}}\n' },
    { name: "wrong-schema", text: '{"schema_version":"9.0","extensions":{}}\n' },
    { name: "extensions-array", text: '{"schema_version":"1.0","extensions":[]}\n' },
    { name: "extensions-null", text: '{"schema_version":"1.0","extensions":null}\n' },
    { name: "trailing-garbage", text: '{"schema_version":"1.0","extensions":{}} TRAILING\n' },
  ];
  for (const c of cases) {
    const dir = tempDir("adv-reg-");
    try {
      writeHost(dir);
      mkdirSync(join(dir, ".aiverse", "extensions"), { recursive: true });
      writeFileSync(join(dir, ".aiverse", "extensions", "registry.json"), c.text, "utf8");
      const root = TrustedDataRoot.fromExistingDirectory(dir);
      assert.throws(() => readRegistryDocument(root), () => true, c.name);
      // installer path also fails closed
      assert.throws(() => new AiVerseDataExtensionInstaller().install({ rootPath: dir }), () => true, c.name);
      assert.equal(existsSync(join(dir, ".aiverse", "extensions", "ai-verse-data", "extension.json")), false, c.name);
    } finally { cleanup(dir); }
  }
});

// 5. Stale locks are never stolen: fresh + artificially aged lock files both block
test("adversarial stale locks are never stolen", () => {
  const dir = tempDir("adv-lock-");
  try {
    writeHost(dir);
    mkdirSync(join(dir, ".aiverse", "extensions"), { recursive: true });
    const regText = '{"schema_version":"1.0","extensions":{}}\n';
    const lockRel = join(".aiverse", "extensions", "registry.json.lock");
    writeFileSync(join(dir, ".aiverse", "extensions", "registry.json"), regText, "utf8");
    writeFileSync(join(dir, lockRel), '{"extension_id":"other","created_at":"2000-01-01T00:00:00.000Z"}\n', "utf8");
    // age the lock 30 days to prove staleness does not grant stealing
    const old = new Date(Date.now() - 30 * 86400 * 1000);
    utimesSync(join(dir, lockRel), old, old);
    assert.throws(() => new AiVerseDataExtensionInstaller().install({ rootPath: dir }), (e: unknown) => anyCode(e).includes("BUSY"), "stale-lock");
    assert.equal(readFileSync(join(dir, ".aiverse", "extensions", "registry.json"), "utf8"), regText);
    assert.ok(lstatSync(join(dir, lockRel)).isFile(), "stale lock file preserved, not deleted");
  } finally { cleanup(dir); }
});

// 6. Oversized inputs: registry / contract / manifest / record / bulk ceilings
test("adversarial oversized inputs fail closed", () => {
  const dir = tempDir("adv-size-");
  try {
    writeHost(dir);
    const root = TrustedDataRoot.fromExistingDirectory(dir);
    const scope = createWorkspaceDataScope(root, "sales");
    mkdirSync(join(dir, "workspaces", "sales", "data"), { recursive: true });
    const client = createDataClient({ scope, actor: { kind: "human", id: "adv" }, authorization: { mode: "local-operator" } });
    try {
      assert.equal(client.spaces.create({ spaceId: "crm", name: "CRM", authority: "local_canonical" }).ok, true);
      assert.equal(client.schemas.create({ spaceId: "crm", entity: "notes", name: "Notes", fields: { title: { type: "string", required: true }, payload: { type: "json", required: false } } }).ok, true);
      // oversized registry (1 MiB + 1)
      mkdirSync(join(dir, ".aiverse", "extensions"), { recursive: true });
      const big = `{"schema_version":"1.0","extensions":{},"pad":"${"x".repeat(1024 * 1024)}"}`;
      writeFileSync(join(dir, ".aiverse", "extensions", "registry.json"), big, "utf8");
      assert.throws(() => readRegistryDocument(root), () => true, "oversize-registry");
      // oversized record (>128 KiB)
      assert.throws(() => client.records.create({ spaceId: "crm", entity: "notes", idempotencyKey: "adv:big:1", data: { title: "t", payload: "y".repeat(200 * 1024) } }), () => true, "oversize-record");
      // oversized bulk (>50 ops)
      const ops = Array.from({ length: 51 }, (_, i) => ({ operation: "data.record.create", payload: { spaceId: "crm", entity: "notes", idempotencyKey: `adv:bulk:${i}`, data: { title: `n${i}` } } }));
      assert.throws(() => client.bulk.preview(ops as unknown as Parameters<typeof client.bulk.preview>[0]), () => true, "oversize-bulk-count");
      // oversized idempotency key (>256)
      assert.throws(() => client.records.create({ spaceId: "crm", entity: "notes", idempotencyKey: "k".repeat(300), data: { title: "t" } }), () => true, "oversize-key");
    } finally { client.close(); }
  } finally { cleanup(dir); }
});

// 7. Corrupt databases: zero-byte, truncated header, wrong magic all quarantine/fail closed without data loss of marker semantics
test("adversarial corrupt databases fail closed and quarantine", () => {
  const variants: Array<{ name: string; bytes: Buffer }> = [
    { name: "zero-byte", bytes: Buffer.alloc(0) },
    { name: "truncated-header", bytes: Buffer.from("SQLite format 3\u0000".slice(0, 8), "utf8") },
    { name: "wrong-magic", bytes: Buffer.from("not-a-sqlite-database-but-preserve-me", "utf8") },
    { name: "random-noise", bytes: Buffer.from([0, 1, 2, 3, 255, 254, 0, 16, 32, 64]) },
  ];
  for (const v of variants) {
    const dir = tempDir("adv-corrupt-");
    try {
      const root = TrustedDataRoot.fromExistingDirectory(dir);
      const scope = createWorkspaceDataScope(root, "sales");
      mkdirSync(join(dir, "workspaces", "sales", "data"), { recursive: true });
      writeFileSync(scope.databasePath(), v.bytes);
      const driver = new SqliteStorageDriver();
      assert.throws(() => driver.open({ location: scope.databasePath() }), () => true, v.name);
      // original bytes preserved (driver must not truncate/replace on failed open)
      assert.deepEqual(readFileSync(scope.databasePath()), v.bytes, `${v.name}-preserved`);
    } finally { cleanup(dir); }
  }
});

// 8. Capability forgery: model-written strings, unknown actions, cross-space refs never grant
test("adversarial capability forgery never grants access", () => {
  const dir = tempDir("adv-cap-");
  try {
    const root = TrustedDataRoot.fromExistingDirectory(dir);
    const scope = createWorkspaceDataScope(root, "sales");
    mkdirSync(join(dir, "workspaces", "sales", "data"), { recursive: true });
    const mk = (caps: string[]) => createDataClient({ scope, actor: { kind: "bot", id: "forger" }, authorization: { mode: "host-bound", capabilityRefs: [...caps] } });
    const reader = mk(["data:crm:deals:read"]);
    try {
      assert.equal(reader.spaces.create({ spaceId: "crm", name: "CRM", authority: "local_canonical" }).ok, true);
      assert.equal(reader.schemas.create({ spaceId: "crm", entity: "deals", name: "Deals", fields: { title: { type: "string", required: true } } }).ok, true);
      // lease asks for create but host granted only read
      assert.throws(() => createBotsDataAdapter(reader, { workspaceId: "sales", principal: { kind: "bot", id: "forger" }, taskId: "t1", capabilities: ["data:crm:deals:create"] }), (e: unknown) => anyCode(e).includes("CAPABILITY_DENIED"), "escalation");
      // unknown action shape rejected at lease parse
      assert.throws(() => createBotsDataAdapter(reader, { workspaceId: "sales", principal: { kind: "bot", id: "forger" }, taskId: "t1", capabilities: ["data:crm:deals:escalate"] }), () => true, "unknown-action");
      // wildcard smuggling: lease wildcard still needs host grant
      assert.throws(() => createBotsDataAdapter(reader, { workspaceId: "sales", principal: { kind: "bot", id: "forger" }, taskId: "t1", capabilities: ["data:*:*:read"] }), (e: unknown) => anyCode(e).includes("CAPABILITY_DENIED"), "wildcard-smuggle");
      // unknown-field injection rejected by record validation, with no prototype pollution
      const polluted = JSON.parse('{"title":"x","injected":true}') as Record<string, unknown>;
      assert.throws(() => reader.records.create({ spaceId: "crm", entity: "deals", idempotencyKey: "adv:proto:1", data: polluted as unknown as { title: string } }), () => true, "unknown-field");
      assert.equal(({} as Record<string, unknown>)["polluted"], undefined);
      assert.equal(({} as Record<string, unknown>)["injected"], undefined);
      // oversized authorization refs rejected (>64)
      assert.throws(() => createDataClient({ scope, actor: { kind: "bot", id: "forger" }, authorization: { mode: "host-bound", capabilityRefs: Array.from({ length: 65 }, (_, i) => `data:crm:deals:read-${i}`) } }), () => true, "oversize-caps");
    } finally { reader.close(); }
  } finally { cleanup(dir); }
});
