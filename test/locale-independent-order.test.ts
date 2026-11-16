import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { DataCatalog, DataCatalogError } from "../src/catalog/index.js";
import { SqliteStorageDriver } from "../src/storage/index.js";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

import { canonicalSchemaJson, schemaDigest } from "../src/catalog/canonical.js";
import { compareCodeUnits } from "../src/protocol/code-unit-order.js";
import {
  canonicalRequestFingerprint,
  canonicalResultJson,
} from "../src/idempotency/index.js";
import type { EntitySchemaDefinition } from "../src/protocol/index.js";

// Keys where localeCompare and code unit order disagree.
const TRICKY = ["z", "a", "Z", "B", "å", "aa", "ä", "I", "i", "ı", "Å"];
const CODE_UNIT_ORDER = [...TRICKY].sort();

function objectWithKeys(keys: readonly string[]): Record<string, number> {
  const output: Record<string, number> = {};
  for (const key of keys) output[key] = key.length;
  return output;
}

function keyOrder(json: string): string[] {
  return Object.keys(JSON.parse(json) as Record<string, unknown>);
}

test("compareCodeUnits matches the default code unit sort", () => {
  assert.deepEqual([...TRICKY].sort(compareCodeUnits), CODE_UNIT_ORDER);
  assert.equal(compareCodeUnits("a", "a"), 0);
  assert.equal(compareCodeUnits("B", "a"), -1);
  assert.equal(compareCodeUnits("a", "B"), 1);
});

test("schema JSON, result JSON and fingerprints use code unit key order", () => {
  const definition = objectWithKeys(TRICKY) as unknown as EntitySchemaDefinition;
  assert.deepEqual(keyOrder(canonicalSchemaJson(definition)), CODE_UNIT_ORDER);
  assert.match(schemaDigest(definition), /^[a-f0-9]{64}$/);
  assert.equal(
    canonicalRequestFingerprint("op", { type: "user" } as never, objectWithKeys(TRICKY)),
    canonicalRequestFingerprint(
      "op",
      { type: "user" } as never,
      objectWithKeys([...TRICKY].reverse()),
    ),
  );
  assert.deepEqual(
    keyOrder(canonicalResultJson(objectWithKeys([...TRICKY].reverse()))),
    CODE_UNIT_ORDER,
  );
});

test("digests are identical under different machine locales", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const canonical = pathToFileURL(join(here, "../src/catalog/canonical.js")).href;
  const script = `
    import(${JSON.stringify(canonical)}).then((m) => {
      const keys = ${JSON.stringify(TRICKY)};
      const o = {};
      keys.forEach((k, i) => { o[k] = i; });
      process.stdout.write(m.canonicalSchemaJson(o) + "|" + m.schemaDigest(o));
    });
  `;
  const outputs = new Set<string>();
  for (const locale of [
    "C",
    "en_US.UTF-8",
    "da_DK.UTF-8",
    "sv_SE.UTF-8",
    "tr_TR.UTF-8",
    "de_DE.UTF-8",
  ]) {
    const output = execFileSync(process.execPath, ["-e", script], {
      env: { ...process.env, LC_ALL: locale, LANG: locale, LANGUAGE: locale },
      encoding: "utf8",
    });
    outputs.add(output);
  }
  assert.equal(outputs.size, 1);
  const [only] = [...outputs];
  assert.deepEqual(keyOrder(only!.split("|")[0]!), CODE_UNIT_ORDER);
});

// Reproduces the key order older code used (English locale), as stored data.
function legacyJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v === "object" && v !== null) {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort((a, b) => a.localeCompare(b, "en"))) {
        out[k] = walk((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

function mixedCaseSchema(): EntitySchemaDefinition {
  const fields: Record<string, { type: "string" }> = {};
  for (const name of ["id", "firstName", "Name", "age", "_x", "created_at", "createdAt"]) {
    fields[name] = { type: "string" };
  }
  return { spaceId: "crm", entity: "people", name: "People", fields } as unknown as EntitySchemaDefinition;
}

function withStoredDigest(digest: string, run: (catalog: DataCatalog) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "ai-verse-data-legacy-"));
  const path = join(dir, "data.sqlite");
  try {
    const db = new SqliteStorageDriver().open({ location: path });
    const catalog = new DataCatalog(db);
    catalog.createSpace({ spaceId: "crm", name: "CRM", authority: "local_canonical" });
    catalog.createSchema(mixedCaseSchema());
    db.close();
    const raw = new Database(path);
    raw.prepare("UPDATE _entity_schema_versions SET schema_digest = ?").run(digest);
    raw.close();
    const reopened = new SqliteStorageDriver().open({ location: path });
    try {
      run(new DataCatalog(reopened));
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a schema digest written in the legacy English order still loads", () => {
  const definition = mixedCaseSchema();
  const legacy = createHash("sha256").update(legacyJson(definition), "utf8").digest("hex");
  assert.notEqual(legacy, schemaDigest(definition), "fixture must differ between orders");
  withStoredDigest(legacy, (catalog) => {
    assert.equal(catalog.getSchema("crm", "people").schemaDigest, legacy);
  });
});

test("a tampered schema digest is still reported as corrupt", () => {
  withStoredDigest("0".repeat(64), (catalog) => {
    assert.throws(
      () => catalog.getSchema("crm", "people"),
      (error) => error instanceof DataCatalogError && error.code === "DATABASE_CORRUPT",
    );
  });
});
