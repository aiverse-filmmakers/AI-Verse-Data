import assert from "node:assert/strict";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DataBackup,
  DataBackupError,
  collectPortableState,
  portableStateDigest,
} from "../src/backup/index.js";
import { DataBulk } from "../src/bulk/index.js";
import { DataCatalog } from "../src/catalog/index.js";
import { DataProvenance } from "../src/provenance/index.js";
import { DataRecords } from "../src/records/index.js";
import {
  TrustedDataRoot,
  createWorkspaceDataScope,
  openScopedDataDatabase,
  type DataDatabaseScope,
  type ScopedDatabaseHandle,
} from "../src/scope/index.js";
import {
  SqliteStorageDriver,
  type DataStorageDatabase,
} from "../src/storage/index.js";

const human = { kind: "human", id: "operator" } as const;
const bot = { kind: "bot", id: "portability-bot" } as const;

interface SeededFixture {
  readonly rootPath: string;
  readonly scope: DataDatabaseScope;
  readonly handle: ScopedDatabaseHandle;
  readonly database: DataStorageDatabase;
  readonly catalog: DataCatalog;
  readonly records: DataRecords;
  readonly provenance: DataProvenance;
  readonly bulk: DataBulk;
  readonly replayCreateInput: {
    readonly spaceId: "crm";
    readonly entity: "companies";
    readonly idempotencyKey: "portability:company";
    readonly data: { readonly name: "Acme" };
    readonly actor: typeof human;
  };
  readonly replayCreateResult: ReturnType<DataRecords["create"]>;
  readonly bulkReplayInput: Parameters<DataBulk["execute"]>[0];
  readonly bulkReplayResult: ReturnType<DataBulk["execute"]>;
}

function newWorkspaceRoot(workspaceId = "sales"): {
  readonly rootPath: string;
  readonly scope: DataDatabaseScope;
} {
  const rootPath = mkdtempSync(join(tmpdir(), "ai-verse-data-backup-root-"));
  const trusted = TrustedDataRoot.fromExistingDirectory(rootPath);
  return {
    rootPath,
    scope: createWorkspaceDataScope(trusted, workspaceId),
  };
}

function openFreshScoped(
  scope: DataDatabaseScope,
  driver: SqliteStorageDriver,
): ScopedDatabaseHandle {
  mkdirSync(join(scope.root.canonicalPath, "workspaces", scope.workspaceId, "data"), {
    recursive: true,
  });
  return openScopedDataDatabase(driver, scope);
}

function seedFixture(driver: SqliteStorageDriver): SeededFixture {
  const { rootPath, scope } = newWorkspaceRoot();
  const handle = openFreshScoped(scope, driver);
  const database = handle.database;
  const catalog = new DataCatalog(database);
  const records = new DataRecords(database);
  const provenance = new DataProvenance(database);
  const bulk = new DataBulk(database);

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
      company: { type: "reference", entity: "companies" },
    },
  });
  catalog.createSchema({
    spaceId: "crm",
    entity: "notes",
    name: "Notes",
    fields: {
      body: { type: "string", required: true },
    },
  });

  const replayCreateInput = {
    spaceId: "crm",
    entity: "companies",
    idempotencyKey: "portability:company",
    data: { name: "Acme" },
    actor: human,
  } as const;
  const replayCreateResult = records.create(replayCreateInput);

  const deal = records.create({
    spaceId: "crm",
    entity: "deals",
    idempotencyKey: "portability:deal",
    data: {
      title: "Initial",
      company: replayCreateResult.recordId,
    },
    actor: bot,
  });

  catalog.updateSchema({
    spaceId: "crm",
    entity: "deals",
    expectedSchemaVersion: 1,
    changes: [
      {
        op: "add_field",
        field: "status",
        definition: {
          type: "enum",
          values: ["open", "won"],
          default: "open",
        },
      },
    ],
  });
  records.update({
    spaceId: "crm",
    entity: "deals",
    recordId: deal.recordId,
    expectedVersion: 1,
    idempotencyKey: "portability:deal:update",
    patch: { title: "Updated" },
    actor: human,
  });

  const note = records.create({
    spaceId: "crm",
    entity: "notes",
    idempotencyKey: "portability:note",
    data: { body: "Delete me" },
    actor: human,
  });
  records.softDelete({
    spaceId: "crm",
    entity: "notes",
    recordId: note.recordId,
    expectedVersion: 1,
    idempotencyKey: "portability:note:delete",
    reason: "portable tombstone",
    actor: bot,
  });

  const bulkOperations = [
    {
      operation: "data.record.create" as const,
      payload: {
        spaceId: "crm",
        entity: "notes",
        idempotencyKey: "portability:bulk:note",
        data: { body: "Bulk note" },
      },
    },
  ] as const;
  const preview = bulk.preview({ actor: human, operations: bulkOperations });
  const bulkReplayInput = {
    actor: human,
    requestId: "req_portability_bulk",
    idempotencyKey: "portability:bulk:outer",
    expectedPreviewDigest: preview.previewDigest,
    operations: bulkOperations,
  } as const;
  const bulkReplayResult = bulk.execute(bulkReplayInput);

  return {
    rootPath,
    scope,
    handle,
    database,
    catalog,
    records,
    provenance,
    bulk,
    replayCreateInput,
    replayCreateResult,
    bulkReplayInput,
    bulkReplayResult,
  };
}

function cleanupFixture(fixture: SeededFixture): void {
  fixture.database.close();
  rmSync(fixture.rootPath, { recursive: true, force: true });
}

function assertBackupError(
  error: unknown,
  code: DataBackupError["code"],
): boolean {
  assert.ok(error instanceof DataBackupError);
  assert.equal(error.code, code);
  return true;
}

test("consistent SQLite backup verifies and restores exact canonical reliability state", async () => {
  const driver = new SqliteStorageDriver();
  const source = seedFixture(driver);
  const artifactParent = mkdtempSync(join(tmpdir(), "ai-verse-data-backup-artifact-"));
  const destination = newWorkspaceRoot();

  try {
    const before = collectPortableState(source.database);
    const beforeDigest = portableStateDigest(before);
    const artifactDirectory = join(artifactParent, "backup");

    const backup = new DataBackup(driver);
    const created = await backup.createBackup({
      source: source.handle,
      destinationDirectory: artifactDirectory,
    });

    assert.equal(created.manifest.kind, "sqlite-backup");
    assert.equal(created.manifest.state.stateDigest, beforeDigest);
    assert.equal(created.receipt.stateDigest, beforeDigest);
    assert.match(created.manifest.payload.sha256, /^[0-9a-f]{64}$/);
    assert.ok(created.manifest.payload.bytes > 0);
    assert.ok(existsSync(join(artifactDirectory, "database.sqlite")));
    assert.ok(existsSync(join(artifactDirectory, "manifest.json")));
    assert.ok(existsSync(join(artifactDirectory, "receipt.json")));

    const payloadPath = join(artifactDirectory, "database.sqlite");
    const payloadBytes = readFileSync(payloadPath);
    const payloadSize = statSync(payloadPath).size;
    await backup.verifyBackup({
      artifactDirectory,
      expectedBinding: source.scope.binding,
    });
    assert.equal(statSync(payloadPath).size, payloadSize);
    assert.deepEqual(readFileSync(payloadPath), payloadBytes);

    const restoreReceipt = await backup.restoreBackup({
      artifactDirectory,
      destination: destination.scope,
    });
    assert.equal(restoreReceipt.operation, "backup.restore");
    assert.equal(restoreReceipt.stateDigest, beforeDigest);
    assert.equal(restoreReceipt.verification, "verified");

    const restored = openScopedDataDatabase(driver, destination.scope, {
      mode: "open-existing",
    });
    try {
      const after = collectPortableState(restored.database);
      assert.equal(portableStateDigest(after), beforeDigest);

      const restoredRecords = new DataRecords(restored.database);
      assert.deepEqual(
        restoredRecords.create(source.replayCreateInput),
        source.replayCreateResult,
      );

      const restoredBulk = new DataBulk(restored.database);
      assert.deepEqual(
        restoredBulk.execute(source.bulkReplayInput),
        source.bulkReplayResult,
      );

      assert.equal(
        new DataProvenance(restored.database).listEvents({ limit: 200 }).items
          .length,
        source.provenance.listEvents({ limit: 200 }).items.length,
      );
      assert.equal(portableStateDigest(collectPortableState(restored.database)), beforeDigest);
    } finally {
      restored.database.close();
    }
  } finally {
    cleanupFixture(source);
    rmSync(destination.rootPath, { recursive: true, force: true });
    rmSync(artifactParent, { recursive: true, force: true });
  }
});

test("portable export verifies, reimports, and preserves schema history, tombstones, replay, and provenance", async () => {
  const driver = new SqliteStorageDriver();
  const source = seedFixture(driver);
  const artifactParent = mkdtempSync(join(tmpdir(), "ai-verse-data-export-artifact-"));
  const destination = newWorkspaceRoot();

  try {
    const before = collectPortableState(source.database);
    const beforeDigest = portableStateDigest(before);
    const artifactDirectory = join(artifactParent, "export");
    const backup = new DataBackup(driver);

    const created = await backup.createPortableExport({
      source: source.handle,
      destinationDirectory: artifactDirectory,
    });
    assert.equal(created.manifest.kind, "portable-export");
    assert.equal(created.manifest.state.stateDigest, beforeDigest);
    assert.equal(
      created.manifest.payload.sha256,
      created.manifest.state.stateDigest,
    );

    await backup.verifyPortableExport({
      artifactDirectory,
      expectedBinding: source.scope.binding,
    });

    const receipt = await backup.importPortableExport({
      artifactDirectory,
      destination: destination.scope,
    });
    assert.equal(receipt.operation, "portable.import");
    assert.equal(receipt.stateDigest, beforeDigest);

    const imported = openScopedDataDatabase(driver, destination.scope, {
      mode: "open-existing",
    });
    try {
      const state = collectPortableState(imported.database);
      assert.equal(portableStateDigest(state), beforeDigest);
      assert.equal(
        new DataCatalog(imported.database).getSchema("crm", "deals").schemaVersion,
        2,
      );

      const notes = new DataRecords(imported.database).list({
        spaceId: "crm",
        entity: "notes",
        includeDeleted: true,
      });
      assert.equal(notes.filter((record) => record.deletedAt !== null).length, 1);

      assert.deepEqual(
        new DataRecords(imported.database).create(source.replayCreateInput),
        source.replayCreateResult,
      );
      assert.deepEqual(
        new DataBulk(imported.database).execute(source.bulkReplayInput),
        source.bulkReplayResult,
      );
      assert.equal(portableStateDigest(collectPortableState(imported.database)), beforeDigest);
    } finally {
      imported.database.close();
    }
  } finally {
    cleanupFixture(source);
    rmSync(destination.rootPath, { recursive: true, force: true });
    rmSync(artifactParent, { recursive: true, force: true });
  }
});

test("backup verification fails closed after payload tampering", async () => {
  const driver = new SqliteStorageDriver();
  const source = seedFixture(driver);
  const artifactParent = mkdtempSync(join(tmpdir(), "ai-verse-data-backup-tamper-"));

  try {
    const artifactDirectory = join(artifactParent, "backup");
    const backup = new DataBackup(driver);
    await backup.createBackup({
      source: source.handle,
      destinationDirectory: artifactDirectory,
    });

    appendFileSync(join(artifactDirectory, "database.sqlite"), Buffer.from([0]));

    await assert.rejects(
      () => backup.verifyBackup({ artifactDirectory }),
      (error) => assertBackupError(error, "ARTIFACT_DIGEST_MISMATCH"),
    );
    assert.equal(
      portableStateDigest(collectPortableState(source.database)),
      portableStateDigest(collectPortableState(source.database)),
    );
  } finally {
    cleanupFixture(source);
    rmSync(artifactParent, { recursive: true, force: true });
  }
});

test("portable export verification fails closed after payload tampering", async () => {
  const driver = new SqliteStorageDriver();
  const source = seedFixture(driver);
  const artifactParent = mkdtempSync(join(tmpdir(), "ai-verse-data-export-tamper-"));

  try {
    const artifactDirectory = join(artifactParent, "export");
    const backup = new DataBackup(driver);
    await backup.createPortableExport({
      source: source.handle,
      destinationDirectory: artifactDirectory,
    });

    appendFileSync(join(artifactDirectory, "export.json"), " ");

    await assert.rejects(
      () => backup.verifyPortableExport({ artifactDirectory }),
      (error) => assertBackupError(error, "ARTIFACT_DIGEST_MISMATCH"),
    );
  } finally {
    cleanupFixture(source);
    rmSync(artifactParent, { recursive: true, force: true });
  }
});

test("restore and import reject a different workspace binding before canonical creation", async () => {
  const driver = new SqliteStorageDriver();
  const source = seedFixture(driver);
  const artifactParent = mkdtempSync(join(tmpdir(), "ai-verse-data-scope-artifact-"));
  const wrong = newWorkspaceRoot("other-workspace");

  try {
    const backupArtifact = join(artifactParent, "backup");
    const exportArtifact = join(artifactParent, "export");
    const backup = new DataBackup(driver);
    await backup.createBackup({
      source: source.handle,
      destinationDirectory: backupArtifact,
    });
    await backup.createPortableExport({
      source: source.handle,
      destinationDirectory: exportArtifact,
    });

    await assert.rejects(
      () =>
        backup.restoreBackup({
          artifactDirectory: backupArtifact,
          destination: wrong.scope,
        }),
      (error) => assertBackupError(error, "ARTIFACT_SCOPE_CONFLICT"),
    );
    assert.equal(existsSync(wrong.scope.databasePath()), false);

    await assert.rejects(
      () =>
        backup.importPortableExport({
          artifactDirectory: exportArtifact,
          destination: wrong.scope,
        }),
      (error) => assertBackupError(error, "ARTIFACT_SCOPE_CONFLICT"),
    );
    assert.equal(existsSync(wrong.scope.databasePath()), false);
  } finally {
    cleanupFixture(source);
    rmSync(wrong.rootPath, { recursive: true, force: true });
    rmSync(artifactParent, { recursive: true, force: true });
  }
});

test("restore/import never overwrite an existing canonical destination", async () => {
  const driver = new SqliteStorageDriver();
  const source = seedFixture(driver);
  const artifactParent = mkdtempSync(join(tmpdir(), "ai-verse-data-no-overwrite-"));
  const destination = newWorkspaceRoot();

  try {
    const backupArtifact = join(artifactParent, "backup");
    const exportArtifact = join(artifactParent, "export");
    const backup = new DataBackup(driver);
    await backup.createBackup({
      source: source.handle,
      destinationDirectory: backupArtifact,
    });
    await backup.createPortableExport({
      source: source.handle,
      destinationDirectory: exportArtifact,
    });

    const existing = openFreshScoped(destination.scope, driver);
    const catalog = new DataCatalog(existing.database);
    catalog.createSpace({
      spaceId: "local",
      name: "Existing",
      authority: "local_canonical",
    });
    const existingDigest = portableStateDigest(
      collectPortableState(existing.database),
    );
    existing.database.close();

    await assert.rejects(
      () =>
        backup.restoreBackup({
          artifactDirectory: backupArtifact,
          destination: destination.scope,
        }),
      (error) => assertBackupError(error, "DESTINATION_ALREADY_EXISTS"),
    );
    await assert.rejects(
      () =>
        backup.importPortableExport({
          artifactDirectory: exportArtifact,
          destination: destination.scope,
        }),
      (error) => assertBackupError(error, "DESTINATION_ALREADY_EXISTS"),
    );

    const reopened = openScopedDataDatabase(driver, destination.scope, {
      mode: "open-existing",
    });
    try {
      assert.equal(
        portableStateDigest(collectPortableState(reopened.database)),
        existingDigest,
      );
    } finally {
      reopened.database.close();
    }
  } finally {
    cleanupFixture(source);
    rmSync(destination.rootPath, { recursive: true, force: true });
    rmSync(artifactParent, { recursive: true, force: true });
  }
});

test("artifact creation never overwrites an existing directory", async () => {
  const driver = new SqliteStorageDriver();
  const source = seedFixture(driver);
  const artifactParent = mkdtempSync(join(tmpdir(), "ai-verse-data-artifact-existing-"));

  try {
    const artifactDirectory = join(artifactParent, "already-there");
    mkdirSync(artifactDirectory);
    const backup = new DataBackup(driver);

    await assert.rejects(
      () =>
        backup.createBackup({
          source: source.handle,
          destinationDirectory: artifactDirectory,
        }),
      (error) => assertBackupError(error, "ARTIFACT_ALREADY_EXISTS"),
    );
  } finally {
    cleanupFixture(source);
    rmSync(artifactParent, { recursive: true, force: true });
  }
});
