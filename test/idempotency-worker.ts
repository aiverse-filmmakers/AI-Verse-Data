import { DataIdempotencyError } from "../src/idempotency/index.js";
import { DataRecords } from "../src/records/index.js";
import { SqliteStorageDriver } from "../src/storage/index.js";

interface GoMessage {
  readonly type: "go";
}

interface ResultMessage {
  readonly type: "result";
  readonly ok: boolean;
  readonly recordId?: string;
  readonly version?: number;
  readonly createdAt?: string;
  readonly code?: string;
}

function send(message: ResultMessage | { readonly type: "ready" }): void {
  process.send?.(message);
}

const [databasePath, idempotencyKey, valueText] = process.argv.slice(2);
if (databasePath === undefined || idempotencyKey === undefined) {
  throw new Error("Idempotency worker requires database path and key.");
}
const value = valueText === undefined ? 42 : Number(valueText);
if (!Number.isFinite(value)) {
  throw new Error("Idempotency worker value must be finite.");
}

const database = new SqliteStorageDriver().open({
  location: databasePath,
  mode: "open-existing",
});
const records = new DataRecords(database);

send({ type: "ready" });

process.once("message", (message: GoMessage) => {
  if (message?.type !== "go") {
    database.close();
    throw new Error("Idempotency worker expected a go message.");
  }

  try {
    const record = records.create({
      spaceId: "delivery",
      entity: "items",
      idempotencyKey,
      data: {
        name: "same-delivery",
        value,
      },
      actor: {
        kind: "worker",
        id: "idempotency-worker",
      },
    });

    send({
      type: "result",
      ok: true,
      recordId: record.recordId,
      version: record.version,
      createdAt: record.createdAt,
    });
  } catch (error) {
    send({
      type: "result",
      ok: false,
      code:
        error instanceof DataIdempotencyError
          ? error.code
          : error instanceof Error
            ? error.name
            : "UNKNOWN_ERROR",
    });
  } finally {
    database.close();
    process.disconnect?.();
  }
});
