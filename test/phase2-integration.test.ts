import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { DataBackup } from "../src/backup/index.js";
import { DataBulk, DataBulkError } from "../src/bulk/index.js";
import { DataCatalog } from "../src/catalog/index.js";
import { DataIdempotencyError } from "../src/idempotency/index.js";
import type { BulkMutationOperation } from "../src/protocol/index.js";
import { DataProvenance } from "../src/provenance/index.js";
import { DataRecovery } from "../src/recovery/index.js";
import { DataRecordError, DataRecords } from "../src/records/index.js";
import {
  DataSchemaMigrationError,
  DataSchemaMigrations,
} from "../src/schema-migrations/index.js";
import {
  TrustedDataRoot,
  createWorkspaceDataScope,
  openScopedDataDatabase,
  type DataDatabaseScope,
  type ScopedDatabaseHandle,
} from "../src/scope/index.js";
import {
  DataStorageError,
  SqliteStorageDriver,
  quarantineMarkerPath,
} from "../src/storage/index.js";

const human = { kind: "human", id: "phase2-owner" } as const;
const bot = { kind: "bot", id: "phase2-bot" } as const;

interface WorkspaceFixture {
  readonly rootPath: string;
  readonly scope: DataDatabaseScope;
}

function workspaceFixture(workspaceId = "sales"): WorkspaceFixture {
  const rootPath = realpathSync(mkdtempSync(join(tmpdir(), "ai-verse-data-phase2-gate-")));
  mkdirSync(join(rootPath, "workspaces", workspaceId, "data"), {
    recursive: true,
  });
  const root = TrustedDataRoot.fromExistingDirectory(rootPath);
  return {
    rootPath,
    scope: createWorkspaceDataScope(root, workspaceId),
  };
}

function openFresh(
  driver: SqliteStorageDriver,
  fixture: WorkspaceFixture,
): ScopedDatabaseHandle {
  return openScopedDataDatabase(driver, fixture.scope);
}

function bootstrap(catalog: DataCatalog): void {
  catalog.createSpace({
    spaceId: "crm",
    name: "CRM",
    authority: "local_canonical",
  });
  catalog.createSchema({
    spaceId: "crm",
    entity: "companies",
    name: "Companies",
    fields: {
      name: { type: "string", required: true },
    },
  });
  catalog.createSchema({
    spaceId: "crm",
    entity: "deals",
    name: "Deals",
    fields: {
      title: { type: "string", required: true },
      value: { type: "number", min: 0, default: 0 },
      stage: {
        type: "enum",
        values: ["lead", "proposal", "won"],
        default: "lead",
      },
      company: {
        type: "reference",
        entity: "companies",
        required: true,
      },
    },
  });
}

function downgradeToV1(databasePath: string): void {
  const raw = new Database(databasePath);
  try {
    raw.exec("DROP TABLE IF EXISTS _schema_migrations");
    raw
      .prepare(
        "DELETE FROM _aiverse_meta WHERE key = 'migration_framework_version'",
      )
      .run();
    raw
      .prepare(
        "UPDATE _aiverse_meta SET value = '1' WHERE key = 'format_version'",
      )
      .run();
    raw.pragma("user_version = 1");
  } finally {
    raw.close();
  }
}

function corruptFirstEventDigest(databasePath: string): void {
  const raw = new Database(databasePath);
  try {
    raw.exec("DROP TRIGGER IF EXISTS _events_no_update");
    raw
      .prepare(
        "UPDATE _events SET event_digest = ? WHERE event_sequence = 1",
      )
      .run("0".repeat(64));
  } finally {
    raw.close();
  }
}

function assertRecordError(
  error: unknown,
  code: DataRecordError["code"],
): boolean {
  assert.ok(error instanceof DataRecordError);
  assert.equal(error.code, code);
  return true;
}

function assertStorageError(
  error: unknown,
  code: DataStorageError["code"],
): boolean {
  assert.ok(error instanceof DataStorageError);
  assert.equal(error.code, code);
  return true;
}

function requiredOwnerMigration() {
  return {
    spaceId: "crm",
    entity: "deals",
    expectedSchemaVersion: 1,
    changes: [
      {
        op: "add_field" as const,
        field: "owner",
        definition: {
          type: "string" as const,
          required: true,
        },
      },
    ],
    backfills: [
      {
        field: "owner",
        mode: "set_if_missing" as const,
        value: "unassigned",
      },
    ],
    owner: human,
    reason: "Phase 2 acceptance owner backfill",
  };
}

test("Phase 2 integrated reliability lifecycle survives replay, bulk, schema migration, backup, export, and reopen", async () => {
  const driver = new SqliteStorageDriver();
  const fixture = workspaceFixture();
  const artifacts = realpathSync(mkdtempSync(join(tmpdir(), "ai-verse-data-phase2-artifacts-")));
  let opened = openFresh(driver, fixture);

  try {
    const catalog = new DataCatalog(opened.database);
    const records = new DataRecords(opened.database);
    const provenance = new DataProvenance(opened.database);
    const bulk = new DataBulk(opened.database);
    const schemaMigrations = new DataSchemaMigrations(opened.database);
    bootstrap(catalog);

    const company = records.create({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "phase2:company:create",
      data: { name: "Acme" },
      actor: human,
    });

    const dealInput = {
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "phase2:deal:create",
      data: {
        title: "Integrated",
        value: 100,
        stage: "proposal",
        company: company.recordId,
      },
      actor: human,
    } as const;

    const created = records.createWithReceipt({
      ...dealInput,
      requestId: "req_phase2_create_first",
    });
    const createReplay = records.createWithReceipt({
      ...dealInput,
      requestId: "req_phase2_create_retry",
    });
    assert.deepEqual(createReplay, created);
    assert.equal(createReplay.receipt.requestId, "req_phase2_create_first");

    assert.throws(
      () =>
        records.update({
          spaceId: "crm",
          entity: "deals",
          recordId: created.record.recordId,
          expectedVersion: 99,
          idempotencyKey: "phase2:stale-update",
          patch: { value: 999 },
          actor: human,
        }),
      (error) => assertRecordError(error, "RECORD_VERSION_CONFLICT"),
    );

    const updated = records.updateWithReceipt({
      spaceId: "crm",
      entity: "deals",
      recordId: created.record.recordId,
      expectedVersion: 1,
      idempotencyKey: "phase2:deal:update",
      patch: { value: 120 },
      actor: human,
      requestId: "req_phase2_update",
    });
    assert.equal(updated.record.version, 2);

    const operations: readonly BulkMutationOperation[] = [
      {
        operation: "data.record.create",
        payload: {
          spaceId: "crm",
          entity: "deals",
          idempotencyKey: "phase2:bulk:create",
          data: {
            title: "Bulk created",
            value: 50,
            company: company.recordId,
          },
        },
      },
      {
        operation: "data.record.update",
        payload: {
          spaceId: "crm",
          entity: "deals",
          recordId: created.record.recordId,
          expectedVersion: 2,
          idempotencyKey: "phase2:bulk:update",
          patch: { value: 150, stage: "won" },
        },
      },
    ];

    const beforePreviewEvents = provenance.listEvents({ limit: 200 }).items.length;
    const bulkPreview = bulk.preview({ actor: bot, operations });
    assert.equal(
      provenance.listEvents({ limit: 200 }).items.length,
      beforePreviewEvents,
    );

    const bulkResult = bulk.execute({
      actor: bot,
      requestId: "req_phase2_bulk_first",
      idempotencyKey: "phase2:bulk:outer",
      expectedPreviewDigest: bulkPreview.previewDigest,
      operations,
    });
    const afterBulkEvents = provenance.listEvents({ limit: 200 }).items.length;
    const bulkReplay = bulk.execute({
      actor: bot,
      requestId: "req_phase2_bulk_retry",
      idempotencyKey: "phase2:bulk:outer",
      expectedPreviewDigest: bulkPreview.previewDigest,
      operations,
    });
    assert.deepEqual(bulkReplay, bulkResult);
    assert.equal(
      provenance.listEvents({ limit: 200 }).items.length,
      afterBulkEvents,
    );

    const migration = requiredOwnerMigration();
    const migrationPreview = schemaMigrations.preview({
      actor: bot,
      payload: migration,
    });
    const migrationPayload = {
      ...migration,
      idempotencyKey: "phase2:schema:outer",
      expectedPreviewDigest: migrationPreview.previewDigest,
    };
    const migrated = schemaMigrations.executeWithReceipt({
      actor: bot,
      requestId: "req_phase2_schema_first",
      payload: migrationPayload,
    });
    const afterMigrationEvents = provenance.listEvents({ limit: 200 }).items.length;
    const migrationReplay = schemaMigrations.executeWithReceipt({
      actor: bot,
      requestId: "req_phase2_schema_retry",
      payload: migrationPayload,
    });
    assert.deepEqual(migrationReplay, migrated);
    assert.equal(
      provenance.listEvents({ limit: 200 }).items.length,
      afterMigrationEvents,
    );

    assert.equal(catalog.getSchema("crm", "deals").schemaVersion, 2);
    const activeDeals = records.list({
      spaceId: "crm",
      entity: "deals",
      limit: 20,
    });
    assert.equal(activeDeals.length, 2);
    assert.ok(
      activeDeals.every(
        (record) =>
          record.schemaVersion === 2 &&
          record.data.owner === "unassigned",
      ),
    );

    const backup = new DataBackup(driver);
    const backupDir = join(artifacts, "backup");
    const exportDir = join(artifacts, "export");
    const physical = await backup.createBackup({
      source: opened,
      destinationDirectory: backupDir,
    });
    const portable = await backup.createPortableExport({
      source: opened,
      destinationDirectory: exportDir,
    });
    const verifiedPhysical = await backup.verifyBackup({
      artifactDirectory: backupDir,
      expectedBinding: fixture.scope.binding,
    });
    const verifiedPortable = await backup.verifyPortableExport({
      artifactDirectory: exportDir,
      expectedBinding: fixture.scope.binding,
    });
    assert.equal(
      verifiedPhysical.manifest.state.stateDigest,
      physical.manifest.state.stateDigest,
    );
    assert.equal(
      verifiedPortable.manifest.state.stateDigest,
      portable.manifest.state.stateDigest,
    );

    const healthBefore = await new DataRecovery(driver).inspect({
      source: fixture.scope,
    });
    assert.equal(healthBefore.state, "healthy");

    opened.database.close();
    opened = openScopedDataDatabase(driver, fixture.scope, {
      mode: "open-existing",
    });

    const reopenedRecords = new DataRecords(opened.database);
    const reopenedProvenance = new DataProvenance(opened.database);
    const reopenedMigrations = new DataSchemaMigrations(opened.database);
    const beforeReplay = reopenedProvenance.listEvents({ limit: 200 }).items.length;

    assert.deepEqual(
      reopenedRecords.createWithReceipt({
        ...dealInput,
        requestId: "req_phase2_create_after_reopen",
      }),
      created,
    );
    assert.deepEqual(
      reopenedMigrations.executeWithReceipt({
        actor: bot,
        requestId: "req_phase2_schema_after_reopen",
        payload: migrationPayload,
      }),
      migrated,
    );
    assert.equal(
      reopenedProvenance.listEvents({ limit: 200 }).items.length,
      beforeReplay,
    );

    const healthAfter = await new DataRecovery(driver).inspect({
      source: fixture.scope,
    });
    assert.equal(healthAfter.state, "healthy");
    assert.equal(
      healthAfter.stateSummary?.stateDigest,
      healthBefore.stateSummary?.stateDigest,
    );
  } finally {
    opened.database.close();
    rmSync(fixture.rootPath, { recursive: true, force: true });
    rmSync(artifacts, { recursive: true, force: true });
  }
});

test("Phase 2 verified backup recovers migrated/idempotent/provenance state without touching quarantined source", async () => {
  const driver = new SqliteStorageDriver();
  const sourceFixture = workspaceFixture("sales");
  const destinationFixture = workspaceFixture("sales");
  const artifacts = realpathSync(mkdtempSync(join(tmpdir(), "ai-verse-data-phase2-recovery-")));
  const source = openFresh(driver, sourceFixture);

  try {
    const catalog = new DataCatalog(source.database);
    const records = new DataRecords(source.database);
    const migrations = new DataSchemaMigrations(source.database);
    bootstrap(catalog);

    const company = records.create({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "phase2:recovery:company",
      data: { name: "Recovery Corp" },
      actor: human,
    });
    const dealInput = {
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "phase2:recovery:deal",
      data: {
        title: "Recover me",
        value: 42,
        company: company.recordId,
      },
      actor: human,
    } as const;
    const deal = records.createWithReceipt(dealInput);

    const migration = requiredOwnerMigration();
    const preview = migrations.preview({ actor: bot, payload: migration });
    const migrationPayload = {
      ...migration,
      idempotencyKey: "phase2:recovery:schema",
      expectedPreviewDigest: preview.previewDigest,
    };
    const migrationResult = migrations.executeWithReceipt({
      actor: bot,
      payload: migrationPayload,
    });

    const artifactDirectory = join(artifacts, "backup");
    await new DataBackup(driver).createBackup({
      source,
      destinationDirectory: artifactDirectory,
    });

    source.database.close();
    corruptFirstEventDigest(sourceFixture.scope.databasePath());

    const recovery = new DataRecovery(driver);
    const corrupt = await recovery.inspect({ source: sourceFixture.scope });
    assert.equal(corrupt.state, "quarantined");
    assert.equal(existsSync(quarantineMarkerPath(sourceFixture.scope.databasePath())), true);

    const staged = await recovery.stageBackupRecovery({
      source: sourceFixture.scope,
      artifactDirectory,
      destination: destinationFixture.scope,
    });
    assert.equal(staged.source.state, "quarantined");
    assert.equal(staged.destination.state, "healthy");
    assert.equal(staged.promotion, "manual-explicit-not-implemented");

    const recovered = openScopedDataDatabase(driver, destinationFixture.scope, {
      mode: "open-existing",
    });
    try {
      const recoveredRecords = new DataRecords(recovered.database);
      const recoveredMigrations = new DataSchemaMigrations(recovered.database);
      const recoveredProvenance = new DataProvenance(recovered.database);
      const beforeReplay = recoveredProvenance.listEvents({ limit: 200 }).items.length;

      assert.deepEqual(recoveredRecords.createWithReceipt(dealInput), deal);
      assert.deepEqual(
        recoveredMigrations.executeWithReceipt({
          actor: bot,
          payload: migrationPayload,
        }),
        migrationResult,
      );
      assert.equal(
        recoveredProvenance.listEvents({ limit: 200 }).items.length,
        beforeReplay,
      );
    } finally {
      recovered.database.close();
    }

    const rawSource = new Database(sourceFixture.scope.databasePath(), {
      readonly: true,
    });
    try {
      const row = rawSource
        .prepare("SELECT event_digest FROM _events WHERE event_sequence = 1")
        .get() as { readonly event_digest: string };
      assert.equal(row.event_digest, "0".repeat(64));
    } finally {
      rawSource.close();
    }
  } finally {
    try {
      source.database.close();
    } catch {
      // Source may already be closed for corruption staging.
    }
    rmSync(sourceFixture.rootPath, { recursive: true, force: true });
    rmSync(destinationFixture.rootPath, { recursive: true, force: true });
    rmSync(artifacts, { recursive: true, force: true });
  }
});

test("Phase 2 adversarial failure classes stay distinct and commit no silent substitute", () => {
  const driver = new SqliteStorageDriver();
  const fixture = workspaceFixture();
  const opened = openFresh(driver, fixture);

  try {
    const catalog = new DataCatalog(opened.database);
    const records = new DataRecords(opened.database);
    const bulk = new DataBulk(opened.database);
    const migrations = new DataSchemaMigrations(opened.database);
    bootstrap(catalog);

    const company = records.create({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "phase2:fail:company",
      data: { name: "Failure Corp" },
      actor: human,
    });
    const deal = records.create({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "phase2:fail:deal",
      data: {
        title: "Failure matrix",
        value: 10,
        company: company.recordId,
      },
      actor: human,
    });

    assert.throws(
      () =>
        records.update({
          spaceId: "crm",
          entity: "deals",
          recordId: deal.recordId,
          expectedVersion: 99,
          idempotencyKey: "phase2:fail:occ",
          patch: { value: 11 },
          actor: human,
        }),
      (error) => assertRecordError(error, "RECORD_VERSION_CONFLICT"),
    );

    records.create({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "phase2:fail:idempotency",
      data: { name: "Original" },
      actor: human,
    });
    assert.throws(
      () =>
        records.create({
          spaceId: "crm",
          entity: "companies",
          idempotencyKey: "phase2:fail:idempotency",
          data: { name: "Changed" },
          actor: human,
        }),
      (error) => {
        assert.ok(error instanceof DataIdempotencyError);
        assert.equal(error.code, "IDEMPOTENCY_CONFLICT");
        return true;
      },
    );

    const originalBulk: readonly BulkMutationOperation[] = [
      {
        operation: "data.record.create",
        payload: {
          spaceId: "crm",
          entity: "companies",
          idempotencyKey: "phase2:fail:bulk:item",
          data: { name: "Previewed" },
        },
      },
    ];
    const bulkPreview = bulk.preview({ actor: human, operations: originalBulk });
    const changedBulk: readonly BulkMutationOperation[] = [
      {
        operation: "data.record.create",
        payload: {
          spaceId: "crm",
          entity: "companies",
          idempotencyKey: "phase2:fail:bulk:item",
          data: { name: "Changed after preview" },
        },
      },
    ];
    assert.throws(
      () =>
        bulk.execute({
          actor: human,
          idempotencyKey: "phase2:fail:bulk:outer",
          expectedPreviewDigest: bulkPreview.previewDigest,
          operations: changedBulk,
        }),
      (error) => {
        assert.ok(error instanceof DataBulkError);
        assert.equal(error.code, "BULK_PREVIEW_STALE");
        return true;
      },
    );

    const schemaMigration = requiredOwnerMigration();
    const schemaPreview = migrations.preview({
      actor: bot,
      payload: schemaMigration,
    });
    records.update({
      spaceId: "crm",
      entity: "deals",
      recordId: deal.recordId,
      expectedVersion: 1,
      idempotencyKey: "phase2:fail:state-drift",
      patch: { value: 12 },
      actor: human,
    });

    assert.throws(
      () =>
        migrations.execute({
          actor: bot,
          payload: {
            ...schemaMigration,
            idempotencyKey: "phase2:fail:schema:outer",
            expectedPreviewDigest: schemaPreview.previewDigest,
          },
        }),
      (error) => {
        assert.ok(error instanceof DataSchemaMigrationError);
        assert.equal(error.code, "SCHEMA_MIGRATION_STALE");
        return true;
      },
    );

    assert.equal(catalog.getSchema("crm", "deals").schemaVersion, 1);
    assert.equal(
      records.list({ spaceId: "crm", entity: "companies", limit: 20 }).length,
      2,
    );
  } finally {
    opened.database.close();
    rmSync(fixture.rootPath, { recursive: true, force: true });
  }
});

test("Phase 2 internal migration preserves replay/provenance and supports post-migration writes", async () => {
  const driver = new SqliteStorageDriver();
  const fixture = workspaceFixture();
  const opened = openFresh(driver, fixture);

  let createInput;
  let created;
  let eventCount;

  try {
    const catalog = new DataCatalog(opened.database);
    const records = new DataRecords(opened.database);
    bootstrap(catalog);
    const company = records.create({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "phase2:internal:company",
      data: { name: "Migration Corp" },
      actor: human,
    });
    createInput = {
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "phase2:internal:deal",
      data: {
        title: "Migrate format",
        value: 10,
        company: company.recordId,
      },
      actor: human,
    } as const;
    created = records.create(createInput);
    eventCount = new DataProvenance(opened.database).listEvents({
      limit: 200,
    }).items.length;
  } finally {
    opened.database.close();
  }

  try {
    downgradeToV1(fixture.scope.databasePath());

    assert.equal(
      driver.inspectMigration({
        location: fixture.scope.databasePath(),
        expectedBinding: fixture.scope.binding,
      }).state,
      "required",
    );
    assert.throws(
      () =>
        openScopedDataDatabase(driver, fixture.scope, {
          mode: "open-existing",
        }),
      (error) => assertStorageError(error, "DATABASE_MIGRATION_REQUIRED"),
    );

    const migration = await driver.migrate({
      location: fixture.scope.databasePath(),
      expectedBinding: fixture.scope.binding,
      backupDirectory: join(fixture.rootPath, "migration-backup"),
    });
    assert.equal(migration.state, "migrated");

    const migrated = openScopedDataDatabase(driver, fixture.scope, {
      mode: "open-existing",
    });
    try {
      const records = new DataRecords(migrated.database);
      const provenance = new DataProvenance(migrated.database);
      assert.deepEqual(records.create(createInput), created);
      assert.equal(provenance.listEvents({ limit: 200 }).items.length, eventCount);

      const updated = records.update({
        spaceId: "crm",
        entity: "deals",
        recordId: created.recordId,
        expectedVersion: 1,
        idempotencyKey: "phase2:internal:post-migration-update",
        patch: { value: 20 },
        actor: human,
      });
      assert.equal(updated.version, 2);
      assert.equal(
        provenance.listEvents({ limit: 200 }).items.length,
        eventCount + 1,
      );
    } finally {
      migrated.database.close();
    }

    const health = await new DataRecovery(driver).inspect({
      source: fixture.scope,
    });
    assert.equal(health.state, "healthy");
  } finally {
    rmSync(fixture.rootPath, { recursive: true, force: true });
  }
});

test("Phase 2 failure-state reporting keeps unrecognized, migration-required, and corruption quarantine separate", async () => {
  const driver = new SqliteStorageDriver();
  const unrecognized = workspaceFixture("unknown");
  const migratable = workspaceFixture("migratable");
  const corrupt = workspaceFixture("corrupt");

  try {
    writeFileSync(unrecognized.scope.databasePath(), Buffer.alloc(0));
    const unrecognizedReport = await new DataRecovery(driver).inspect({
      source: unrecognized.scope,
    });
    assert.equal(unrecognizedReport.state, "unrecognized");
    assert.equal(unrecognizedReport.quarantine, null);

    const migratableHandle = openFresh(driver, migratable);
    const migratableCatalog = new DataCatalog(migratableHandle.database);
    bootstrap(migratableCatalog);
    migratableHandle.database.close();
    downgradeToV1(migratable.scope.databasePath());
    const migrationReport = await new DataRecovery(driver).inspect({
      source: migratable.scope,
    });
    assert.equal(migrationReport.state, "migration_required");
    assert.equal(migrationReport.quarantine, null);

    const corruptHandle = openFresh(driver, corrupt);
    const corruptCatalog = new DataCatalog(corruptHandle.database);
    bootstrap(corruptCatalog);
    const company = new DataRecords(corruptHandle.database).create({
      spaceId: "crm",
      entity: "companies",
      idempotencyKey: "phase2:classify:company",
      data: { name: "Corrupt Corp" },
      actor: human,
    });
    new DataRecords(corruptHandle.database).create({
      spaceId: "crm",
      entity: "deals",
      idempotencyKey: "phase2:classify:deal",
      data: {
        title: "Corrupt",
        company: company.recordId,
      },
      actor: human,
    });
    corruptHandle.database.close();
    corruptFirstEventDigest(corrupt.scope.databasePath());

    const corruptReport = await new DataRecovery(driver).inspect({
      source: corrupt.scope,
    });
    assert.equal(corruptReport.state, "quarantined");
    assert.equal(corruptReport.corruption?.category, "semantic");
    assert.equal(
      existsSync(quarantineMarkerPath(corrupt.scope.databasePath())),
      true,
    );

    assert.throws(
      () =>
        openScopedDataDatabase(driver, corrupt.scope, {
          mode: "open-existing",
        }),
      (error) => assertStorageError(error, "DATABASE_QUARANTINED"),
    );
  } finally {
    rmSync(unrecognized.rootPath, { recursive: true, force: true });
    rmSync(migratable.rootPath, { recursive: true, force: true });
    rmSync(corrupt.rootPath, { recursive: true, force: true });
  }
});
