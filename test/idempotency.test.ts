import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import { DataCatalog } from "../src/catalog/index.js";
import {
  canonicalRequestFingerprint,
  DataIdempotencyError,
} from "../src/idempotency/index.js";
import { DataRecordError, DataRecords } from "../src/records/index.js";
import {
  SqliteStorageDriver,
  type DataStorageDatabase,
} from "../src/storage/index.js";
import { DataTransactions } from "../src/transactions/index.js";

const actor = { kind: "human", id: "operator" } as const;
const otherActor = { kind: "human", id: "other-operator" } as const;
const workerPath = fileURLToPath(
  new URL("./idempotency-worker.js", import.meta.url),
);

interface WorkerReady {
  readonly type: "ready";
}

interface WorkerResult {
  readonly type: "result";
  readonly ok: boolean;
  readonly recordId?: string;
  readonly version?: number;
  readonly createdAt?: string;
  readonly code?: string;
}

interface SpawnedWorker {
  readonly child: ChildProcess;
  readonly ready: Promise<void>;
  readonly result: Promise<WorkerResult>;
}

function bootstrap(catalog: DataCatalog): void {
  catalog.createSpace({
    spaceId: "delivery",
    name: "Delivery",
    authority: "local_canonical",
  });
  catalog.createSchema({
    spaceId: "delivery",
    entity: "items",
    name: "Items",
    fields: {
      name: { type: "string", required: true },
      value: { type: "number", required: true },
    },
  });
}

function openFixture(): {
  readonly directory: string;
  readonly databasePath: string;
  readonly database: DataStorageDatabase;
  readonly catalog: DataCatalog;
  readonly records: DataRecords;
  readonly transactions: DataTransactions;
} {
  const directory = mkdtempSync(join(tmpdir(), "ai-verse-data-idempotency-"));
  const databasePath = join(directory, "data.sqlite");
  const database = new SqliteStorageDriver().open({ location: databasePath });
  const catalog = new DataCatalog(database);
  const records = new DataRecords(database);
  const transactions = new DataTransactions(database);
  bootstrap(catalog);
  return {
    directory,
    databasePath,
    database,
    catalog,
    records,
    transactions,
  };
}

function assertIdempotencyError(
  error: unknown,
  code: DataIdempotencyError["code"],
): boolean {
  assert.ok(error instanceof DataIdempotencyError);
  assert.equal(error.code, code);
  return true;
}

function assertRecordError(
  error: unknown,
  code: DataRecordError["code"],
): boolean {
  assert.ok(error instanceof DataRecordError);
  assert.equal(error.code, code);
  return true;
}

function spawnDuplicateWorker(
  databasePath: string,
  idempotencyKey: string,
  value = 42,
): SpawnedWorker {
  const child = fork(workerPath, [databasePath, idempotencyKey, String(value)], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });

  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  let resultResolve!: (result: WorkerResult) => void;
  let resultReject!: (error: Error) => void;
  const result = new Promise<WorkerResult>((resolve, reject) => {
    resultResolve = resolve;
    resultReject = reject;
  });

  let received = false;
  const timeout = setTimeout(() => {
    child.kill();
    const error = new Error(
      `Idempotency worker timed out.${stderr.length === 0 ? "" : ` stderr: ${stderr}`}`,
    );
    readyReject(error);
    resultReject(error);
  }, 15_000);
  timeout.unref();

  child.on("message", (message: WorkerReady | WorkerResult) => {
    if (message.type === "ready") {
      readyResolve();
      return;
    }
    received = true;
    clearTimeout(timeout);
    resultResolve(message);
  });

  child.once("error", (error) => {
    clearTimeout(timeout);
    readyReject(error);
    resultReject(error);
  });

  child.once("exit", (code, signal) => {
    if (received) return;
    clearTimeout(timeout);
    const error = new Error(
      `Idempotency worker exited without a result (code=${String(code)}, signal=${String(signal)}).${
        stderr.length === 0 ? "" : ` stderr: ${stderr}`
      }`,
    );
    readyReject(error);
    resultReject(error);
  });

  return { child, ready, result };
}

async function releaseWorkers(
  workers: readonly SpawnedWorker[],
): Promise<readonly WorkerResult[]> {
  await Promise.all(workers.map((worker) => worker.ready));
  for (const worker of workers) worker.child.send({ type: "go" });
  return Promise.all(workers.map((worker) => worker.result));
}

test("canonical fingerprints ignore object key order but bind operation, actor, and semantic payload", () => {
  const first = canonicalRequestFingerprint(
    "data.record.create",
    actor,
    {
      spaceId: "delivery",
      entity: "items",
      data: { name: "A", value: 1 },
    },
  );
  const reordered = canonicalRequestFingerprint(
    "data.record.create",
    actor,
    {
      data: { value: 1, name: "A" },
      entity: "items",
      spaceId: "delivery",
    },
  );
  assert.equal(first, reordered);
  assert.match(first, /^[0-9a-f]{64}$/);

  assert.notEqual(
    first,
    canonicalRequestFingerprint(
      "data.record.update",
      actor,
      {
        spaceId: "delivery",
        entity: "items",
        data: { name: "A", value: 1 },
      },
    ),
  );
  assert.notEqual(
    first,
    canonicalRequestFingerprint(
      "data.record.create",
      otherActor,
      {
        spaceId: "delivery",
        entity: "items",
        data: { name: "A", value: 1 },
      },
    ),
  );
  assert.notEqual(
    first,
    canonicalRequestFingerprint(
      "data.record.create",
      actor,
      {
        spaceId: "delivery",
        entity: "items",
        data: { name: "A", value: 2 },
      },
    ),
  );
});

test("record create replay returns the original snapshot and does not create a duplicate", () => {
  const fixture = openFixture();
  try {
    const first = fixture.records.create({
      spaceId: "delivery",
      entity: "items",
      idempotencyKey: "create:item-a",
      data: { name: "A", value: 1 },
      actor,
    });
    const replay = fixture.records.create({
      spaceId: "delivery",
      entity: "items",
      idempotencyKey: "create:item-a",
      data: { value: 1, name: "A" },
      actor,
    });

    assert.deepEqual(replay, first);
    assert.equal(
      fixture.records.list({
        spaceId: "delivery",
        entity: "items",
      }).length,
      1,
    );
    const stored = fixture.database.idempotencyStorage().get("create:item-a");
    assert.ok(stored !== null);
    assert.equal(stored.operation, "data.record.create");
    assert.match(stored.requestFingerprint, /^[0-9a-f]{64}$/);
    assert.match(stored.resultDigest, /^[0-9a-f]{64}$/);
  } finally {
    fixture.database.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("same idempotency key with different payload is rejected without a second mutation", () => {
  const fixture = openFixture();
  try {
    fixture.records.create({
      spaceId: "delivery",
      entity: "items",
      idempotencyKey: "create:conflict",
      data: { name: "A", value: 1 },
      actor,
    });

    assert.throws(
      () =>
        fixture.records.create({
          spaceId: "delivery",
          entity: "items",
          idempotencyKey: "create:conflict",
          data: { name: "A", value: 2 },
          actor,
        }),
      (error) => assertIdempotencyError(error, "IDEMPOTENCY_CONFLICT"),
    );

    assert.equal(
      fixture.records.list({
        spaceId: "delivery",
        entity: "items",
      }).length,
      1,
    );
  } finally {
    fixture.database.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("idempotency fingerprint binds the trusted actor and operation", () => {
  const fixture = openFixture();
  try {
    const created = fixture.records.create({
      spaceId: "delivery",
      entity: "items",
      idempotencyKey: "global:key",
      data: { name: "A", value: 1 },
      actor,
    });

    assert.throws(
      () =>
        fixture.records.create({
          spaceId: "delivery",
          entity: "items",
          idempotencyKey: "global:key",
          data: { name: "A", value: 1 },
          actor: otherActor,
        }),
      (error) => assertIdempotencyError(error, "IDEMPOTENCY_CONFLICT"),
    );

    assert.throws(
      () =>
        fixture.records.update({
          spaceId: "delivery",
          entity: "items",
          recordId: created.recordId,
          expectedVersion: 1,
          idempotencyKey: "global:key",
          patch: { value: 2 },
          actor,
        }),
      (error) => assertIdempotencyError(error, "IDEMPOTENCY_CONFLICT"),
    );

    const current = fixture.records.get({
      spaceId: "delivery",
      entity: "items",
      recordId: created.recordId,
    });
    assert.equal(current.version, 1);
    assert.equal(current.data.value, 1);
  } finally {
    fixture.database.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("update replay is checked before current version and returns the original committed snapshot", () => {
  const fixture = openFixture();
  try {
    const created = fixture.records.create({
      spaceId: "delivery",
      entity: "items",
      idempotencyKey: "create:update-replay",
      data: { name: "A", value: 1 },
      actor,
    });

    const firstUpdate = fixture.records.update({
      spaceId: "delivery",
      entity: "items",
      recordId: created.recordId,
      expectedVersion: 1,
      idempotencyKey: "update:original",
      patch: { value: 2 },
      actor,
    });
    assert.equal(firstUpdate.version, 2);

    const laterUpdate = fixture.records.update({
      spaceId: "delivery",
      entity: "items",
      recordId: created.recordId,
      expectedVersion: 2,
      idempotencyKey: "update:later",
      patch: { value: 3 },
      actor,
    });
    assert.equal(laterUpdate.version, 3);

    const replay = fixture.records.update({
      spaceId: "delivery",
      entity: "items",
      recordId: created.recordId,
      expectedVersion: 1,
      idempotencyKey: "update:original",
      patch: { value: 2 },
      actor,
    });

    assert.deepEqual(replay, firstUpdate);
    const current = fixture.records.get({
      spaceId: "delivery",
      entity: "items",
      recordId: created.recordId,
    });
    assert.deepEqual(current, laterUpdate);
  } finally {
    fixture.database.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("soft-delete replay returns its original deleted snapshot without deleting twice", () => {
  const fixture = openFixture();
  try {
    const created = fixture.records.create({
      spaceId: "delivery",
      entity: "items",
      idempotencyKey: "create:delete-replay",
      data: { name: "A", value: 1 },
      actor,
    });

    const firstDelete = fixture.records.softDelete({
      spaceId: "delivery",
      entity: "items",
      recordId: created.recordId,
      expectedVersion: 1,
      idempotencyKey: "delete:original",
      actor,
      reason: "done",
    });
    const replay = fixture.records.softDelete({
      spaceId: "delivery",
      entity: "items",
      recordId: created.recordId,
      expectedVersion: 1,
      idempotencyKey: "delete:original",
      actor,
      reason: "done",
    });

    assert.deepEqual(replay, firstDelete);
    assert.equal(replay.version, 2);
    assert.ok(replay.deletedAt !== null);
    assert.equal(
      fixture.records.list({
        spaceId: "delivery",
        entity: "items",
        includeDeleted: true,
      }).length,
      1,
    );
  } finally {
    fixture.database.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("failed mutations do not reserve their idempotency key", () => {
  const fixture = openFixture();
  try {
    const created = fixture.records.create({
      spaceId: "delivery",
      entity: "items",
      idempotencyKey: "create:failed-retry",
      data: { name: "A", value: 1 },
      actor,
    });

    assert.throws(
      () =>
        fixture.records.update({
          spaceId: "delivery",
          entity: "items",
          recordId: created.recordId,
          expectedVersion: 99,
          idempotencyKey: "retry:after-failure",
          patch: { value: 2 },
          actor,
        }),
      (error) => assertRecordError(error, "RECORD_VERSION_CONFLICT"),
    );
    assert.equal(
      fixture.database.idempotencyStorage().get("retry:after-failure"),
      null,
    );

    const corrected = fixture.records.update({
      spaceId: "delivery",
      entity: "items",
      recordId: created.recordId,
      expectedVersion: 1,
      idempotencyKey: "retry:after-failure",
      patch: { value: 2 },
      actor,
    });
    assert.equal(corrected.version, 2);
    assert.equal(corrected.data.value, 2);
  } finally {
    fixture.database.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("idempotency replay survives database close and reopen", () => {
  const fixture = openFixture();
  const input = {
    spaceId: "delivery",
    entity: "items",
    idempotencyKey: "create:reopen",
    data: { name: "Persistent", value: 9 },
    actor,
  } as const;

  try {
    const original = fixture.records.create(input);
    fixture.database.close();

    const reopened = new SqliteStorageDriver().open({
      location: fixture.databasePath,
      mode: "open-existing",
    });
    try {
      const records = new DataRecords(reopened);
      const replay = records.create(input);
      assert.deepEqual(replay, original);
      assert.equal(
        records.list({
          spaceId: "delivery",
          entity: "items",
        }).length,
        1,
      );
    } finally {
      reopened.close();
    }
  } finally {
    try {
      fixture.database.close();
    } catch {
      // Already closed by the test.
    }
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("transaction replay returns identical generated record IDs without re-executing nested mutations", () => {
  const fixture = openFixture();
  try {
    const payload = {
      idempotencyKey: "transaction:create-two",
      operations: [
        {
          operation: "data.record.create" as const,
          payload: {
            spaceId: "delivery",
            entity: "items",
            idempotencyKey: "transaction:item-one",
            clientRef: "one",
            data: { name: "One", value: 1 },
          },
        },
        {
          operation: "data.record.create" as const,
          payload: {
            spaceId: "delivery",
            entity: "items",
            idempotencyKey: "transaction:item-two",
            data: { name: "Two", value: 2 },
          },
        },
      ],
    };

    const first = fixture.transactions.execute({ actor, payload });
    const replay = fixture.transactions.execute({ actor, payload });

    assert.deepEqual(replay, first);
    assert.equal(first.operations.length, 2);
    assert.equal(
      fixture.records.list({
        spaceId: "delivery",
        entity: "items",
      }).length,
      2,
    );
    assert.equal(
      fixture.database.idempotencyStorage().get("transaction:create-two")
        ?.operation,
      "data.transaction.execute",
    );
    assert.equal(
      fixture.database.idempotencyStorage().get("transaction:item-one")
        ?.operation,
      "data.record.create",
    );
  } finally {
    fixture.database.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("same transaction key with changed operations is rejected", () => {
  const fixture = openFixture();
  try {
    fixture.transactions.execute({
      actor,
      payload: {
        idempotencyKey: "transaction:conflict",
        operations: [
          {
            operation: "data.record.create",
            payload: {
              spaceId: "delivery",
              entity: "items",
              idempotencyKey: "transaction:conflict:one",
              data: { name: "One", value: 1 },
            },
          },
        ],
      },
    });

    assert.throws(
      () =>
        fixture.transactions.execute({
          actor,
          payload: {
            idempotencyKey: "transaction:conflict",
            operations: [
              {
                operation: "data.record.create",
                payload: {
                  spaceId: "delivery",
                  entity: "items",
                  idempotencyKey: "transaction:conflict:two",
                  data: { name: "Two", value: 2 },
                },
              },
            ],
          },
        }),
      (error) => assertIdempotencyError(error, "IDEMPOTENCY_CONFLICT"),
    );

    assert.equal(
      fixture.records.list({
        spaceId: "delivery",
        entity: "items",
      }).length,
      1,
    );
  } finally {
    fixture.database.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("failed transaction rolls back both nested and outer idempotency entries", () => {
  const fixture = openFixture();
  try {
    assert.throws(() =>
      fixture.transactions.execute({
        actor,
        payload: {
          idempotencyKey: "transaction:rollback",
          operations: [
            {
              operation: "data.record.create",
              payload: {
                spaceId: "delivery",
                entity: "items",
                idempotencyKey: "transaction:rollback:first",
                data: { name: "First", value: 1 },
              },
            },
            {
              operation: "data.record.create",
              payload: {
                spaceId: "delivery",
                entity: "items",
                idempotencyKey: "transaction:rollback:bad",
                data: { value: 2 },
              },
            },
          ],
        },
      }),
    );

    assert.equal(
      fixture.database.idempotencyStorage().get("transaction:rollback"),
      null,
    );
    assert.equal(
      fixture.database.idempotencyStorage().get("transaction:rollback:first"),
      null,
    );
    assert.equal(
      fixture.records.list({
        spaceId: "delivery",
        entity: "items",
      }).length,
      0,
    );

    const retried = fixture.records.create({
      spaceId: "delivery",
      entity: "items",
      idempotencyKey: "transaction:rollback:first",
      data: { name: "First", value: 1 },
      actor,
    });
    assert.equal(retried.version, 1);
  } finally {
    fixture.database.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("concurrent duplicate delivery across separate processes creates one record and replays one result", async () => {
  const fixture = openFixture();
  try {
    const workers = Array.from({ length: 4 }, () =>
      spawnDuplicateWorker(
        fixture.databasePath,
        "concurrent:create:same-delivery",
      ),
    );
    const results = await releaseWorkers(workers);

    assert.equal(results.length, 4);
    assert.ok(results.every((result) => result.ok));
    const recordIds = new Set(results.map((result) => result.recordId));
    const createdTimes = new Set(results.map((result) => result.createdAt));
    assert.equal(recordIds.size, 1);
    assert.equal(createdTimes.size, 1);
    assert.ok(results.every((result) => result.version === 1));

    assert.equal(
      fixture.records.list({
        spaceId: "delivery",
        entity: "items",
      }).length,
      1,
    );
    const stored = fixture.database
      .idempotencyStorage()
      .get("concurrent:create:same-delivery");
    assert.ok(stored !== null);
  } finally {
    fixture.database.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("concurrent same-key different-payload delivery commits one request and rejects the other", async () => {
  const fixture = openFixture();
  try {
    const workers = [
      spawnDuplicateWorker(
        fixture.databasePath,
        "concurrent:create:conflicting-delivery",
        100,
      ),
      spawnDuplicateWorker(
        fixture.databasePath,
        "concurrent:create:conflicting-delivery",
        200,
      ),
    ];
    const results = await releaseWorkers(workers);

    const successes = results.filter((result) => result.ok);
    const conflicts = results.filter(
      (result) => !result.ok && result.code === "IDEMPOTENCY_CONFLICT",
    );
    assert.equal(successes.length, 1);
    assert.equal(conflicts.length, 1);

    const rows = fixture.records.list({
      spaceId: "delivery",
      entity: "items",
    });
    assert.equal(rows.length, 1);
    assert.ok(rows[0]!.data.value === 100 || rows[0]!.data.value === 200);
    assert.ok(
      fixture.database
        .idempotencyStorage()
        .get("concurrent:create:conflicting-delivery") !== null,
    );
  } finally {
    fixture.database.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("tampered stored replay result fails closed on digest mismatch", () => {
  const fixture = openFixture();
  const input = {
    spaceId: "delivery",
    entity: "items",
    idempotencyKey: "create:tamper",
    data: { name: "Tamper", value: 1 },
    actor,
  } as const;

  try {
    fixture.records.create(input);
    fixture.database.close();

    const raw = new Database(fixture.databasePath);
    try {
      raw.prepare(
        "UPDATE _idempotency SET result_json = ? WHERE idempotency_key = ?",
      ).run("{}", input.idempotencyKey);
    } finally {
      raw.close();
    }

    const reopened = new SqliteStorageDriver().open({
      location: fixture.databasePath,
      mode: "open-existing",
    });
    try {
      const records = new DataRecords(reopened);
      assert.throws(
        () => records.create(input),
        (error) => assertIdempotencyError(error, "DATABASE_CORRUPT"),
      );
      assert.equal(
        records.list({
          spaceId: "delivery",
          entity: "items",
        }).length,
        1,
      );
    } finally {
      reopened.close();
    }
  } finally {
    try {
      fixture.database.close();
    } catch {
      // Already closed by the test.
    }
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("empty or oversized low-level idempotency keys are rejected before mutation", () => {
  const fixture = openFixture();
  try {
    assert.throws(
      () =>
        fixture.records.create({
          spaceId: "delivery",
          entity: "items",
          idempotencyKey: "",
          data: { name: "Bad", value: 1 },
          actor,
        }),
      (error) => assertRecordError(error, "FIELD_INVALID"),
    );
    assert.throws(
      () =>
        fixture.records.create({
          spaceId: "delivery",
          entity: "items",
          idempotencyKey: "x".repeat(257),
          data: { name: "Bad", value: 1 },
          actor,
        }),
      (error) => assertRecordError(error, "FIELD_INVALID"),
    );
    assert.equal(
      fixture.records.list({
        spaceId: "delivery",
        entity: "items",
      }).length,
      0,
    );
  } finally {
    fixture.database.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});
