import { DataRecordError, DataRecords } from "../src/records/index.js";
import { SqliteStorageDriver } from "../src/storage/index.js";
import { DataTransactions } from "../src/transactions/index.js";

type WorkerOperation = "update" | "delete" | "transaction-update";

interface GoMessage {
  readonly type: "go";
}

interface WorkerSuccess {
  readonly type: "result";
  readonly ok: true;
  readonly operation: WorkerOperation;
  readonly version: number;
  readonly value?: number;
  readonly deleted: boolean;
}

interface WorkerFailure {
  readonly type: "result";
  readonly ok: false;
  readonly operation: WorkerOperation;
  readonly code: string;
  readonly currentVersion?: number;
}

function send(message: WorkerSuccess | WorkerFailure | { readonly type: "ready" }): void {
  process.send?.(message);
}

const [databasePath, recordId, operationText, valueText] = process.argv.slice(2);
if (
  databasePath === undefined ||
  recordId === undefined ||
  (operationText !== "update" &&
    operationText !== "delete" &&
    operationText !== "transaction-update")
) {
  throw new Error("Invalid concurrency worker arguments.");
}

const operation: WorkerOperation = operationText;
const value = valueText === undefined ? undefined : Number(valueText);
if (
  (operation === "update" || operation === "transaction-update") &&
  (value === undefined || !Number.isFinite(value))
) {
  throw new Error("Update worker requires a finite numeric value.");
}

const database = new SqliteStorageDriver().open({
  location: databasePath,
  mode: "open-existing",
});
const records = new DataRecords(database);
const transactions = new DataTransactions(database);

send({ type: "ready" });

process.once("message", (message: GoMessage) => {
  if (message?.type !== "go") {
    database.close();
    throw new Error("Concurrency worker expected a go message.");
  }

  try {
    const actor = {
      kind: "worker",
      id: `race-${process.pid}`,
    } as const;

    const record =
      operation === "delete"
        ? records.softDelete({
            spaceId: "race",
            entity: "counters",
            recordId,
            expectedVersion: 1,
            actor,
            reason: "concurrency race",
          })
        : operation === "transaction-update"
          ? transactions.execute({
              actor,
              payload: {
                idempotencyKey: `race-txn-${process.pid}`,
                operations: [
                  {
                    operation: "data.record.update",
                    payload: {
                      spaceId: "race",
                      entity: "counters",
                      recordId,
                      expectedVersion: 1,
                      idempotencyKey: `race-update-${process.pid}`,
                      patch: { value: value! },
                    },
                  },
                ],
              },
            }).operations[0]!.record
          : records.update({
              spaceId: "race",
              entity: "counters",
              recordId,
              expectedVersion: 1,
              patch: { value: value! },
              actor,
            });

    send({
      type: "result",
      ok: true,
      operation,
      version: record.version,
      ...(typeof record.data.value === "number" ? { value: record.data.value } : {}),
      deleted: record.deletedAt !== null,
    });
  } catch (error) {
    if (error instanceof DataRecordError) {
      const currentVersion =
        typeof error.details?.currentVersion === "number"
          ? error.details.currentVersion
          : undefined;
      send({
        type: "result",
        ok: false,
        operation,
        code: error.code,
        ...(currentVersion === undefined ? {} : { currentVersion }),
      });
    } else {
      send({
        type: "result",
        ok: false,
        operation,
        code: error instanceof Error ? error.name : "UNKNOWN_ERROR",
      });
    }
  } finally {
    database.close();
    process.disconnect?.();
  }
});
