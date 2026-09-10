import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { DataCatalog, DataCatalogError } from "../src/catalog/index.js";
import { schemaDigest } from "../src/catalog/canonical.js";
import type {
  EntitySchemaDefinition,
  SchemaUpdatePayload,
} from "../src/protocol/index.js";
import { SqliteStorageDriver } from "../src/storage/index.js";

function withCatalog(
  run: (
    catalog: DataCatalog,
    databasePath: string,
    close: () => void,
  ) => void,
): void {
  const directory = mkdtempSync(join(tmpdir(), "ai-verse-data-catalog-"));
  const databasePath = join(directory, "data.sqlite");
  const database = new SqliteStorageDriver().open({ location: databasePath });
  const catalog = new DataCatalog(database);
  let closed = false;
  const close = (): void => {
    if (closed) return;
    database.close();
    closed = true;
  };

  try {
    run(catalog, databasePath, close);
  } finally {
    close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertCatalogError(
  error: unknown,
  expectedCode: DataCatalogError["code"],
): boolean {
  assert.ok(error instanceof DataCatalogError);
  assert.equal(error.code, expectedCode);
  return true;
}

function createCrm(catalog: DataCatalog): void {
  catalog.createSpace({
    spaceId: "crm",
    name: "CRM",
    description: "Customer operations",
    authority: "local_canonical",
  });
}

function dealsSchema(): EntitySchemaDefinition {
  return {
    spaceId: "crm",
    entity: "deals",
    name: "Deals",
    description: "Commercial opportunities",
    fields: {
      title: { type: "string", required: true, maxLength: 200 },
      value: { type: "number", min: 0 },
      stage: {
        type: "enum",
        values: ["lead", "proposal", "won", "lost"],
        default: "lead",
      },
    },
  };
}

test("catalog initializes only fixed schema tables and keeps record storage deferred", () => {
  withCatalog((_catalog, databasePath) => {
    const raw = new Database(databasePath, { readonly: true });
    try {
      const rows = raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as Array<{ readonly name: string }>;
      const names = rows.map((row) => row.name);

      assert.ok(names.includes("_aiverse_meta"));
      assert.ok(names.includes("_data_spaces"));
      assert.ok(names.includes("_entities"));
      assert.ok(names.includes("_entity_schema_versions"));
      assert.equal(names.includes("_records"), false);

      const tableList = raw.pragma("table_list") as Array<{
        readonly name: string;
        readonly strict: number;
      }>;
      for (const name of [
        "_data_spaces",
        "_entities",
        "_entity_schema_versions",
      ]) {
        assert.equal(
          tableList.find((row) => row.name === name)?.strict,
          1,
          `${name} must be STRICT`,
        );
      }
    } finally {
      raw.close();
    }
  });
});

test("creates, lists, and gets Data Spaces with deterministic ordering", () => {
  withCatalog((catalog) => {
    const production = catalog.createSpace({
      spaceId: "production",
      name: "Production",
      authority: "local_canonical",
    });
    const crm = catalog.createSpace({
      spaceId: "crm",
      name: "CRM",
      description: "Customer operations",
      authority: "local_canonical",
    });

    assert.equal(production.schemaCount, 0);
    assert.equal(crm.description, "Customer operations");
    assert.ok(Number.isFinite(Date.parse(crm.createdAt)));
    assert.equal(crm.createdAt, crm.updatedAt);

    assert.deepEqual(
      catalog.listSpaces().map((space) => space.spaceId),
      ["crm", "production"],
    );
    assert.equal(catalog.getSpace("crm").name, "CRM");
  });
});

test("duplicate Data Space creation fails without replacing canonical metadata", () => {
  withCatalog((catalog) => {
    createCrm(catalog);

    assert.throws(
      () =>
        catalog.createSpace({
          spaceId: "crm",
          name: "Replacement",
          authority: "local_canonical",
        }),
      (error) => assertCatalogError(error, "DATA_SPACE_ALREADY_EXISTS"),
    );

    assert.equal(catalog.getSpace("crm").name, "CRM");
  });
});

test("creates version 1 schemas, lists summaries, and updates space schema count", () => {
  withCatalog((catalog) => {
    createCrm(catalog);
    const created = catalog.createSchema(dealsSchema());

    assert.equal(created.schemaVersion, 1);
    assert.match(created.schemaDigest, /^[a-f0-9]{64}$/);
    assert.equal(created.fields.stage?.type, "enum");
    assert.ok(Number.isFinite(Date.parse(created.versionCreatedAt)));

    const summaries = catalog.listSchemas("crm");
    assert.equal(summaries.length, 1);
    assert.deepEqual(
      {
        entity: summaries[0]?.entity,
        name: summaries[0]?.name,
        version: summaries[0]?.schemaVersion,
        fields: summaries[0]?.fieldCount,
      },
      {
        entity: "deals",
        name: "Deals",
        version: 1,
        fields: 3,
      },
    );
    assert.equal(catalog.getSpace("crm").schemaCount, 1);
    assert.deepEqual(catalog.getSchema("crm", "deals"), created);
  });
});

test("schema digest is independent of object key insertion order", () => {
  const first: EntitySchemaDefinition = {
    spaceId: "crm",
    entity: "deals",
    name: "Deals",
    fields: {
      title: { type: "string", required: true },
      value: { type: "number", min: 0 },
    },
  };
  const second: EntitySchemaDefinition = {
    name: "Deals",
    entity: "deals",
    spaceId: "crm",
    fields: {
      value: { min: 0, type: "number" },
      title: { required: true, type: "string" },
    },
  };

  assert.equal(schemaDigest(first), schemaDigest(second));
});

test("catalog state and schema digest survive close and reopen", () => {
  withCatalog((catalog, databasePath, close) => {
    createCrm(catalog);
    const original = catalog.createSchema(dealsSchema());
    close();

    const reopenedDatabase = new SqliteStorageDriver().open({
      location: databasePath,
      mode: "open-existing",
    });
    try {
      const reopened = new DataCatalog(reopenedDatabase);
      assert.equal(reopened.getSpace("crm").schemaCount, 1);
      const schema = reopened.getSchema("crm", "deals");
      assert.equal(schema.schemaVersion, 1);
      assert.equal(schema.schemaDigest, original.schemaDigest);
      assert.deepEqual(schema.fields, original.fields);
    } finally {
      reopenedDatabase.close();
    }
  });
});

test("invalid field defaults are rejected before any entity is persisted", () => {
  withCatalog((catalog) => {
    createCrm(catalog);

    assert.throws(
      () =>
        catalog.createSchema({
          spaceId: "crm",
          entity: "broken",
          name: "Broken",
          fields: {
            count: { type: "integer", default: 1.5 },
          },
        }),
      (error) => assertCatalogError(error, "SCHEMA_INVALID"),
    );

    assert.deepEqual(catalog.listSchemas("crm"), []);
    assert.equal(catalog.getSpace("crm").schemaCount, 0);
  });
});

test("field defaults obey nullable, enum, range, date, and datetime constraints", () => {
  withCatalog((catalog) => {
    createCrm(catalog);

    for (const fields of [
      { x: { type: "string", maxLength: 2, default: "toolong" } },
      { x: { type: "number", min: 10, default: 5 } },
      { x: { type: "enum", values: ["a", "b"], default: "c" } },
      { x: { type: "date", default: "2026-02-31" } },
      { x: { type: "datetime", default: "2026-09-10 12:00:00" } },
      { x: { type: "string", default: null } },
    ] as const) {
      assert.throws(
        () =>
          catalog.createSchema({
            spaceId: "crm",
            entity: "invalid-default",
            name: "Invalid Default",
            fields,
          } as unknown as EntitySchemaDefinition),
        (error) => assertCatalogError(error, "SCHEMA_INVALID"),
      );
    }

    const valid = catalog.createSchema({
      spaceId: "crm",
      entity: "defaults",
      name: "Defaults",
      fields: {
        optional: { type: "string", nullable: true, default: null },
        date: { type: "date", default: "2026-09-10" },
        at: { type: "datetime", default: "2026-09-10T12:00:00Z" },
      },
    });
    assert.equal(valid.schemaVersion, 1);
  });
});

test("schema creation requires an existing Data Space and unique entity identity", () => {
  withCatalog((catalog) => {
    assert.throws(
      () => catalog.createSchema(dealsSchema()),
      (error) => assertCatalogError(error, "DATA_SPACE_NOT_FOUND"),
    );

    createCrm(catalog);
    catalog.createSchema(dealsSchema());

    assert.throws(
      () => catalog.createSchema(dealsSchema()),
      (error) => assertCatalogError(error, "ENTITY_ALREADY_EXISTS"),
    );
  });
});

test("safe additive schema update creates immutable version 2", () => {
  withCatalog((catalog) => {
    createCrm(catalog);
    const v1 = catalog.createSchema({
      spaceId: "crm",
      entity: "deals",
      name: "Deals",
      fields: {
        title: { type: "string", required: true },
      },
    });

    const update: SchemaUpdatePayload = {
      spaceId: "crm",
      entity: "deals",
      expectedSchemaVersion: 1,
      changes: [
        {
          op: "add_field",
          field: "stage",
          definition: {
            type: "enum",
            values: ["lead", "won"],
            default: "lead",
          },
        },
        { op: "set_name", name: "Sales Deals" },
        { op: "set_description", description: "Current sales pipeline" },
      ],
    };
    const v2 = catalog.updateSchema(update);

    assert.equal(v2.schemaVersion, 2);
    assert.notEqual(v2.schemaDigest, v1.schemaDigest);
    assert.equal(v2.name, "Sales Deals");
    assert.equal(v2.description, "Current sales pipeline");
    assert.equal(v2.fields.stage?.type, "enum");

    const historical = catalog.getSchema("crm", "deals", 1);
    assert.equal(historical.schemaDigest, v1.schemaDigest);
    assert.equal(historical.name, "Deals");
    assert.equal("stage" in historical.fields, false);

    assert.deepEqual(catalog.getSchema("crm", "deals", 2), v2);
    assert.deepEqual(catalog.getSchema("crm", "deals", "current"), v2);
  });
});

test("adding a required field without a default requires migration and writes nothing", () => {
  withCatalog((catalog) => {
    createCrm(catalog);
    const v1 = catalog.createSchema({
      spaceId: "crm",
      entity: "deals",
      name: "Deals",
      fields: { title: { type: "string" } },
    });

    assert.throws(
      () =>
        catalog.updateSchema({
          spaceId: "crm",
          entity: "deals",
          expectedSchemaVersion: 1,
          changes: [
            {
              op: "add_field",
              field: "owner",
              definition: { type: "string", required: true },
            },
          ],
        }),
      (error) => assertCatalogError(error, "SCHEMA_MIGRATION_REQUIRED"),
    );

    assert.equal(catalog.getSchema("crm", "deals").schemaVersion, 1);
    assert.equal(catalog.getSchema("crm", "deals").schemaDigest, v1.schemaDigest);
    assert.throws(
      () => catalog.getSchema("crm", "deals", 2),
      (error) => assertCatalogError(error, "SCHEMA_VERSION_NOT_FOUND"),
    );
  });
});

test("destructive field changes return migration-required and preserve current version", () => {
  withCatalog((catalog) => {
    createCrm(catalog);
    catalog.createSchema(dealsSchema());

    for (const change of [
      { op: "remove_field", field: "value" },
      {
        op: "replace_field",
        field: "value",
        definition: { type: "string" },
      },
      { op: "rename_field", field: "value", newField: "amount" },
    ] as const) {
      assert.throws(
        () =>
          catalog.updateSchema({
            spaceId: "crm",
            entity: "deals",
            expectedSchemaVersion: 1,
            changes: [change],
          }),
        (error) => assertCatalogError(error, "SCHEMA_MIGRATION_REQUIRED"),
      );
      assert.equal(catalog.getSchema("crm", "deals").schemaVersion, 1);
    }
  });
});

test("schema version conflicts fail before creating a new version", () => {
  withCatalog((catalog) => {
    createCrm(catalog);
    catalog.createSchema(dealsSchema());
    catalog.updateSchema({
      spaceId: "crm",
      entity: "deals",
      expectedSchemaVersion: 1,
      changes: [{ op: "set_name", name: "Deals v2" }],
    });

    assert.throws(
      () =>
        catalog.updateSchema({
          spaceId: "crm",
          entity: "deals",
          expectedSchemaVersion: 1,
          changes: [{ op: "set_name", name: "Stale writer" }],
        }),
      (error) => assertCatalogError(error, "SCHEMA_VERSION_CONFLICT"),
    );

    assert.equal(catalog.getSchema("crm", "deals").name, "Deals v2");
    assert.throws(
      () => catalog.getSchema("crm", "deals", 3),
      (error) => assertCatalogError(error, "SCHEMA_VERSION_NOT_FOUND"),
    );
  });
});

test("missing spaces, entities, and historical versions return distinct errors", () => {
  withCatalog((catalog) => {
    assert.throws(
      () => catalog.getSpace("missing"),
      (error) => assertCatalogError(error, "DATA_SPACE_NOT_FOUND"),
    );

    createCrm(catalog);
    assert.throws(
      () => catalog.getSchema("crm", "missing"),
      (error) => assertCatalogError(error, "ENTITY_NOT_FOUND"),
    );

    catalog.createSchema(dealsSchema());
    assert.throws(
      () => catalog.getSchema("crm", "deals", 99),
      (error) => assertCatalogError(error, "SCHEMA_VERSION_NOT_FOUND"),
    );
  });
});
