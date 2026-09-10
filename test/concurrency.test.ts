import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DataCatalog } from "../src/catalog/index.js";
import { DataRecords } from "../src/records/index.js";
import {
  SqliteStorageDriver,
  type StoredRecord,
} from "../src/storage/index.js";

interface WorkerReady {
  readonly type: "ready";
}

interface WorkerResult {
  readonly type: "result";
  readonly ok: boolean;
  readonly operation: "update" | "delete" | "transaction-update";
  readonly version?: number;
  readonly value?: number;
  readonly deleted?: boolean;
  readonly code?: string;
  readonly currentVersion?: number;
}

interface SpawnedWorker {
  readonly child: ChildProcess;
  readonly ready: Promise<void>;
  readonly result: Promise<WorkerResult>;
}

const workerPath = fileURLToPath(
  new URL("./concurrency-worker.js", import.meta.url),
);

let idempotencySequence = 0;
function nextIdempotencyKey(): string {
  idempotencySequence += 1;
  return `legacy-test:${idempotencySequence}`;
}

function createRaceDatabase(): {
  readonly directory: string;
  readonly databasePath: string;
  readonly recordId: string;
} {
  const directory = mkdtempSync(join(tmpdir(), "ai-verse-data-concurrency-"));
  const databasePath = join(directory, "data.sqlite");
  const database = new SqliteStorageDriver().open({ location: databasePath });

  try {
    const catalog = new DataCatalog(database);
    const records = new DataRecords(database);
    catalog.createSpace({
      spaceId: "race",
      name: "Race",
      authority: "local_canonical",
    });
    catalog.createSchema({
      spaceId: "race",
      entity: "counters",
      name: "Counters",
      fields: {
        name: { type: "string", required: true },
        value: { type: "number", required: true },
      },
    });
    const record = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "race",
      entity: "counters",
      data: { name: "shared", value: 0 },
      actor: { kind: "human", id: "test" },
    });
    return { directory, databasePath, recordId: record.recordId };
  } finally {
    database.close();
  }
}

function spawnRaceWorker(
  databasePath: string,
  recordId: string,
  operation: WorkerResult["operation"],
  value?: number,
): SpawnedWorker {
  const args = [
    databasePath,
    recordId,
    operation,
    ...(value === undefined ? [] : [String(value)]),
  ];
  const child = fork(workerPath, args, {
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

  let receivedResult = false;
  const timeout = setTimeout(() => {
    child.kill();
    const error = new Error(
      `Concurrency worker timed out.${stderr.length === 0 ? "" : ` stderr: ${stderr}`}`,
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
    if (message.type === "result") {
      receivedResult = true;
      clearTimeout(timeout);
      resultResolve(message);
    }
  });

  child.once("error", (error) => {
    clearTimeout(timeout);
    readyReject(error);
    resultReject(error);
  });

  child.once("exit", (code, signal) => {
    if (receivedResult) return;
    clearTimeout(timeout);
    const error = new Error(
      `Concurrency worker exited before returning a result (code=${String(code)}, signal=${String(signal)}).${
        stderr.length === 0 ? "" : ` stderr: ${stderr}`
      }`,
    );
    readyReject(error);
    resultReject(error);
  });

  return { child, ready, result };
}

async function releaseRace(
  workers: readonly SpawnedWorker[],
): Promise<readonly WorkerResult[]> {
  await Promise.all(workers.map((worker) => worker.ready));
  for (const worker of workers) {
    worker.child.send({ type: "go" });
  }
  return Promise.all(workers.map((worker) => worker.result));
}

function candidate(
  stored: StoredRecord,
  value: number,
  actorId: string,
): StoredRecord {
  return {
    ...stored,
    version: stored.version + 1,
    dataJson: JSON.stringify({ name: "shared", value }),
    updatedAt: new Date().toISOString(),
    updatedActorKind: "worker",
    updatedActorId: actorId,
  };
}

test("storage compare-and-swap rejects a second writer using the same stale version", () => {
  const { directory, databasePath, recordId } = createRaceDatabase();
  try {
    const driver = new SqliteStorageDriver();
    const first = driver.open({ location: databasePath, mode: "open-existing" });
    const second = driver.open({ location: databasePath, mode: "open-existing" });

    try {
      const firstStore = first.recordStorage();
      const secondStore = second.recordStorage();
      const firstRead = firstStore.getRecord("race", "counters", recordId);
      const secondRead = secondStore.getRecord("race", "counters", recordId);
      assert.ok(firstRead !== null);
      assert.ok(secondRead !== null);
      assert.equal(firstRead.version, 1);
      assert.equal(secondRead.version, 1);

      assert.equal(
        firstStore.updateRecord(candidate(firstRead, 10, "writer-a"), 1),
        true,
      );
      assert.equal(
        secondStore.updateRecord(candidate(secondRead, 20, "writer-b"), 1),
        false,
      );

      const final = secondStore.getRecord("race", "counters", recordId);
      assert.ok(final !== null);
      assert.equal(final.version, 2);
      assert.equal(JSON.parse(final.dataJson).value, 10);
    } finally {
      first.close();
      second.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("separate processes racing with one expectedVersion produce exactly one committed update", async () => {
  const { directory, databasePath, recordId } = createRaceDatabase();
  try {
    const workers = [10, 20, 30, 40].map((value) =>
      spawnRaceWorker(databasePath, recordId, "update", value),
    );
    const results = await releaseRace(workers);

    const successes = results.filter((result) => result.ok);
    const conflicts = results.filter(
      (result) => !result.ok && result.code === "RECORD_VERSION_CONFLICT",
    );

    assert.equal(successes.length, 1);
    assert.equal(conflicts.length, 3);
    assert.equal(successes[0]!.version, 2);
    for (const conflict of conflicts) {
      assert.equal(conflict.currentVersion, 2);
    }

    const database = new SqliteStorageDriver().open({
      location: databasePath,
      mode: "open-existing",
    });
    try {
      const final = new DataRecords(database).get({
        spaceId: "race",
        entity: "counters",
        recordId,
      });
      assert.equal(final.version, 2);
      assert.ok([10, 20, 30, 40].includes(final.data.value as number));
    } finally {
      database.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("separate transaction writers also permit only one stale-version commit", async () => {
  const { directory, databasePath, recordId } = createRaceDatabase();
  try {
    const workers = [
      spawnRaceWorker(databasePath, recordId, "transaction-update", 111),
      spawnRaceWorker(databasePath, recordId, "transaction-update", 222),
    ];
    const results = await releaseRace(workers);

    const successes = results.filter((result) => result.ok);
    const conflicts = results.filter(
      (result) => !result.ok && result.code === "RECORD_VERSION_CONFLICT",
    );

    assert.equal(successes.length, 1);
    assert.equal(conflicts.length, 1);
    assert.equal(successes[0]!.version, 2);
    assert.equal(conflicts[0]!.currentVersion, 2);

    const database = new SqliteStorageDriver().open({
      location: databasePath,
      mode: "open-existing",
    });
    try {
      const final = new DataRecords(database).get({
        spaceId: "race",
        entity: "counters",
        recordId,
      });
      assert.equal(final.version, 2);
      assert.ok(final.data.value === 111 || final.data.value === 222);
    } finally {
      database.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a stale soft delete cannot delete a record after another writer advances its version", () => {
  const { directory, databasePath, recordId } = createRaceDatabase();
  try {
    const driver = new SqliteStorageDriver();
    const first = driver.open({ location: databasePath, mode: "open-existing" });
    const second = driver.open({ location: databasePath, mode: "open-existing" });

    try {
      const firstStore = first.recordStorage();
      const secondStore = second.recordStorage();
      const staleDelete = secondStore.getRecord("race", "counters", recordId);
      const current = firstStore.getRecord("race", "counters", recordId);
      assert.ok(staleDelete !== null);
      assert.ok(current !== null);

      assert.equal(
        firstStore.updateRecord(candidate(current, 77, "writer-update"), 1),
        true,
      );

      const deleteCandidate: StoredRecord = {
        ...staleDelete,
        version: 2,
        updatedAt: new Date().toISOString(),
        updatedActorKind: "worker",
        updatedActorId: "writer-delete",
        deletedAt: new Date().toISOString(),
        deletedReason: "stale delete",
        deletedActorKind: "worker",
        deletedActorId: "writer-delete",
      };
      assert.equal(secondStore.softDeleteRecord(deleteCandidate, 1), false);

      const final = secondStore.getRecord("race", "counters", recordId, true);
      assert.ok(final !== null);
      assert.equal(final.version, 2);
      assert.equal(final.deletedAt, null);
      assert.equal(JSON.parse(final.dataJson).value, 77);
    } finally {
      first.close();
      second.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
