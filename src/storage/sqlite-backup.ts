import { createHash } from "node:crypto";
import {
  closeSync,
  openSync,
  readSync,
  rmSync,
  statSync,
} from "node:fs";

import type Database from "better-sqlite3";

import { DataStorageError, isDataStorageError } from "./errors.js";
import type { StorageBackupResult } from "./types.js";

const HASH_BUFFER_BYTES = 64 * 1024;

export function sha256FileSync(path: string): {
  readonly bytes: number;
  readonly sha256: string;
} {
  const stat = statSync(path);
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
  const handle = openSync(path, "r");

  try {
    for (;;) {
      const bytesRead = readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(handle);
  }

  return {
    bytes: stat.size,
    sha256: hash.digest("hex"),
  };
}

export async function backupSqliteDatabase(
  database: Database.Database,
  location: string,
): Promise<StorageBackupResult> {
  if (location.length === 0 || location.includes("\u0000")) {
    throw new DataStorageError(
      "DATABASE_UNAVAILABLE",
      "SQLite backup destination must be a non-empty filesystem path without NUL.",
    );
  }
  if (database.inTransaction) {
    throw new DataStorageError(
      "DATABASE_UNAVAILABLE",
      "SQLite backup cannot begin while the source connection has an active transaction.",
    );
  }

  let reservation: number | undefined;
  try {
    reservation = openSync(location, "wx", 0o600);
    closeSync(reservation);
    reservation = undefined;
  } catch (error) {
    if (reservation !== undefined) {
      try {
        closeSync(reservation);
      } catch {
        // Continue cleanup of a partially reserved destination.
      }
      rmSync(location, { force: true });
    }
    throw new DataStorageError(
      "DATABASE_UNAVAILABLE",
      "SQLite backup destination already exists or cannot be reserved safely.",
      error,
    );
  }

  try {
    const result = await database.backup(location);
    if (
      !Number.isSafeInteger(result.totalPages) ||
      result.totalPages < 0 ||
      result.remainingPages !== 0
    ) {
      throw new DataStorageError(
        "DATABASE_CORRUPT",
        "SQLite backup completed with invalid completion metadata.",
      );
    }

    return {
      totalPages: result.totalPages,
      remainingPages: 0,
    };
  } catch (error) {
    try {
      rmSync(location, { force: true });
    } catch {
      // Preserve the original backup failure.
    }
    if (isDataStorageError(error)) throw error;
    throw new DataStorageError(
      "DATABASE_UNAVAILABLE",
      "Unable to create a consistent SQLite backup.",
      error,
    );
  }
}
