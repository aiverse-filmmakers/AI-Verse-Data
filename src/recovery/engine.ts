import {
  existsSync,
  lstatSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import Database from "better-sqlite3";

import {
  DataBackup,
  DataBackupError,
  collectPortableState,
  summarizePortableState,
} from "../backup/index.js";
import type { DataDatabaseScope } from "../scope/index.js";
import {
  DataStorageError,
  type DataStorageDriver,
  type StorageDatabaseBinding,
  type StorageMigrationStatus,
} from "../storage/index.js";
import { backupSqliteDatabase } from "../storage/sqlite-backup.js";
import {
  markDatabaseQuarantined,
  readQuarantineMarker,
} from "../storage/sqlite-quarantine.js";
import { DataRecoveryError } from "./errors.js";
import type {
  DataCorruptionFinding,
  DataRecoveryApi,
  DataRecoveryInspectInput,
  DataRecoveryReport,
  DataRecoveryStageInput,
  DataRecoveryStageResult,
  DataRecoveryState,
} from "./types.js";

function bindingEquals(
  left: StorageDatabaseBinding,
  right: StorageDatabaseBinding,
): boolean {
  return (
    left.bindingVersion === right.bindingVersion &&
    left.kind === right.kind &&
    left.workspaceId === right.workspaceId
  );
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message.slice(0, 4096);
  }
  return "Unknown AI-Verse Data recovery failure.";
}

function codeOf(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { readonly code?: unknown }).code === "string"
  ) {
    return (error as { readonly code: string }).code;
  }
  return "UNKNOWN";
}

function baseReport(
  state: DataRecoveryState,
  input: {
    readonly binding?: StorageDatabaseBinding | null;
    readonly databaseFormatVersion?: number | null;
    readonly migration?: StorageMigrationStatus | null;
    readonly quarantine?: ReturnType<typeof readQuarantineMarker>;
    readonly corruption?: DataCorruptionFinding | null;
    readonly stateSummary?: DataRecoveryReport["stateSummary"];
  } = {},
): DataRecoveryReport {
  return {
    state,
    writable: state === "healthy",
    checkedAt: new Date().toISOString(),
    binding: input.binding ?? null,
    databaseFormatVersion: input.databaseFormatVersion ?? null,
    migration: input.migration ?? null,
    quarantine: input.quarantine ?? null,
    corruption: input.corruption ?? null,
    stateSummary: input.stateSummary ?? null,
  };
}

function migrationReport(
  migration: StorageMigrationStatus,
  quarantine: ReturnType<typeof readQuarantineMarker>,
): DataRecoveryReport | null {
  if (migration.state === "required") {
    return baseReport("migration_required", {
      binding: migration.binding,
      databaseFormatVersion: migration.databaseFormatVersion,
      migration,
      quarantine,
    });
  }
  if (migration.state === "incomplete") {
    return baseReport("migration_incomplete", {
      binding: migration.binding,
      databaseFormatVersion: migration.databaseFormatVersion,
      migration,
      quarantine,
    });
  }
  return null;
}

function corruptionReport(
  source: DataDatabaseScope,
  category: "physical" | "semantic",
  error: unknown,
  migration: StorageMigrationStatus | null,
): DataRecoveryReport {
  const message = messageOf(error);
  const marker = markDatabaseQuarantined(source.databasePath(), {
    category,
    message,
    binding: migration?.binding ?? source.binding,
  });
  return baseReport("quarantined", {
    binding: migration?.binding ?? source.binding,
    databaseFormatVersion: migration?.databaseFormatVersion ?? null,
    migration,
    quarantine: marker,
    corruption: {
      category,
      code: codeOf(error),
      message,
    },
  });
}

function inspectStorageError(
  error: DataStorageError,
  quarantine: ReturnType<typeof readQuarantineMarker>,
): DataRecoveryReport | null {
  switch (error.code) {
    case "DATABASE_NOT_FOUND":
      return baseReport("missing", { quarantine });
    case "DATABASE_FORMAT_UNRECOGNIZED":
      return baseReport("unrecognized", { quarantine });
    case "DATABASE_VERSION_UNSUPPORTED":
      return baseReport("unsupported", { quarantine });
    case "DATABASE_SCOPE_CONFLICT":
      return baseReport("scope_conflict", { quarantine });
    case "DATABASE_MIGRATION_REQUIRED":
      return baseReport("migration_required", { quarantine });
    case "DATABASE_MIGRATION_INCOMPLETE":
    case "DATABASE_MIGRATION_FAILED":
      return baseReport("migration_incomplete", { quarantine });
    case "DATABASE_QUARANTINED":
      return baseReport("quarantined", { quarantine });
    case "DATABASE_UNAVAILABLE":
    case "SQLITE_VERSION_UNSUPPORTED":
      return baseReport("unavailable", { quarantine });
    case "DATABASE_CORRUPT":
      return null;
    case "MIGRATION_BACKUP_INVALID":
    case "MIGRATION_BACKUP_EXISTS":
      return baseReport("unavailable", { quarantine });
  }
}

function physicalIntegrity(
  database: Database.Database,
): readonly string[] {
  const rows = database.pragma("integrity_check(1)") as Array<
    Record<string, unknown>
  >;
  return rows.map((row) =>
    String(row.integrity_check ?? Object.values(row)[0] ?? "unknown"),
  );
}

function foreignKeyIssues(database: Database.Database): readonly unknown[] {
  return database.pragma("foreign_key_check") as readonly unknown[];
}

export class DataRecovery implements DataRecoveryApi {
  private readonly backup: DataBackup;

  constructor(private readonly driver: DataStorageDriver) {
    this.backup = new DataBackup(driver);
  }

  async inspect(
    input: DataRecoveryInspectInput,
  ): Promise<DataRecoveryReport> {
    const source = input.source;
    const location = source.databasePath();

    let quarantine: ReturnType<typeof readQuarantineMarker>;
    try {
      quarantine = readQuarantineMarker(location);
    } catch (error) {
      return baseReport("quarantined", {
        corruption: {
          category: "semantic",
          code: codeOf(error),
          message: messageOf(error),
        },
      });
    }

    if (!existsSync(location)) {
      return baseReport("missing", { quarantine });
    }

    let info;
    try {
      info = lstatSync(location);
    } catch (error) {
      return baseReport("unavailable", {
        quarantine,
        corruption: {
          category: "physical",
          code: codeOf(error),
          message: messageOf(error),
        },
      });
    }

    if (info.isSymbolicLink() || !info.isFile()) {
      return baseReport("unavailable", {
        quarantine,
        corruption: {
          category: "physical",
          code: "DATABASE_UNAVAILABLE",
          message:
            "Canonical database path is not a regular non-symlink file.",
        },
      });
    }

    let raw: Database.Database | undefined;
    let migration: StorageMigrationStatus | null = null;
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "ai-verse-data-recovery-inspect-"),
    );
    const snapshotPath = join(temporaryDirectory, "snapshot.sqlite");

    try {
      try {
        raw = new Database(location, {
          readonly: true,
          fileMustExist: true,
        });
        const integrity = physicalIntegrity(raw);
        if (
          integrity.length !== 1 ||
          integrity[0]?.toLowerCase() !== "ok"
        ) {
          return corruptionReport(
            source,
            "physical",
            new DataStorageError(
              "DATABASE_CORRUPT",
              `SQLite integrity check failed: ${integrity.join("; ")}`,
            ),
            null,
          );
        }

        const foreignKeys = foreignKeyIssues(raw);
        if (foreignKeys.length > 0) {
          return corruptionReport(
            source,
            "semantic",
            new DataStorageError(
              "DATABASE_CORRUPT",
              `SQLite foreign-key check reported ${foreignKeys.length} violation(s).`,
            ),
            null,
          );
        }
      } catch (error) {
        if (error instanceof DataStorageError) {
          const classified = inspectStorageError(error, quarantine);
          if (classified !== null) return classified;
        }
        return corruptionReport(source, "physical", error, null);
      }

      try {
        migration = this.driver.inspectMigration({
          location,
          expectedBinding: source.binding,
        });
      } catch (error) {
        if (error instanceof DataStorageError) {
          const classified = inspectStorageError(error, quarantine);
          if (classified !== null) return classified;
          return corruptionReport(source, "semantic", error, null);
        }
        return baseReport("unavailable", {
          quarantine,
          corruption: {
            category: "semantic",
            code: codeOf(error),
            message: messageOf(error),
          },
        });
      }

      const migrationState = migrationReport(migration, quarantine);
      if (migrationState !== null) return migrationState;

      try {
        await backupSqliteDatabase(raw, snapshotPath);
      } catch (error) {
        return corruptionReport(source, "physical", error, migration);
      } finally {
        if (raw !== undefined) {
          raw.close();
          raw = undefined;
        }
      }

      let snapshot;
      try {
        snapshot = this.driver.open({
          location: snapshotPath,
          mode: "open-existing",
          expectedBinding: source.binding,
        });
      } catch (error) {
        if (
          error instanceof DataStorageError &&
          (error.code === "DATABASE_MIGRATION_REQUIRED" ||
            error.code === "DATABASE_MIGRATION_INCOMPLETE" ||
            error.code === "DATABASE_VERSION_UNSUPPORTED" ||
            error.code === "DATABASE_SCOPE_CONFLICT")
        ) {
          const classified = inspectStorageError(error, quarantine);
          if (classified !== null) return classified;
        }
        return corruptionReport(source, "semantic", error, migration);
      }

      try {
        const state = collectPortableState(snapshot);
        const summary = summarizePortableState(state);
        if (quarantine !== null) {
          return baseReport("quarantined", {
            binding: migration.binding ?? source.binding,
            databaseFormatVersion: migration.databaseFormatVersion,
            migration,
            quarantine,
            corruption: {
              category: quarantine.category,
              code: quarantine.code,
              message: quarantine.message,
            },
            stateSummary: summary,
          });
        }

        return baseReport("healthy", {
          binding: migration.binding ?? source.binding,
          databaseFormatVersion: migration.databaseFormatVersion,
          migration,
          stateSummary: summary,
        });
      } catch (error) {
        if (
          error instanceof DataBackupError ||
          error instanceof DataStorageError ||
          codeOf(error) === "DATABASE_CORRUPT" ||
          codeOf(error) === "REFERENCE_INVALID"
        ) {
          return corruptionReport(source, "semantic", error, migration);
        }
        return corruptionReport(source, "semantic", error, migration);
      } finally {
        snapshot.close();
      }
    } finally {
      if (raw !== undefined) {
        try {
          raw.close();
        } catch {
          // Preserve the diagnosis result.
        }
      }
      rmSync(temporaryDirectory, {
        recursive: true,
        force: true,
      });
    }
  }

  async stageBackupRecovery(
    input: DataRecoveryStageInput,
  ): Promise<DataRecoveryStageResult> {
    return this.stage(input, "sqlite-backup");
  }

  async stagePortableRecovery(
    input: DataRecoveryStageInput,
  ): Promise<DataRecoveryStageResult> {
    return this.stage(input, "portable-export");
  }

  private async stage(
    input: DataRecoveryStageInput,
    kind: "sqlite-backup" | "portable-export",
  ): Promise<DataRecoveryStageResult> {
    if (!bindingEquals(input.source.binding, input.destination.binding)) {
      throw new DataRecoveryError(
        "RECOVERY_BINDING_CONFLICT",
        "Recovery destination must have exactly the same trusted workspace binding as the canonical source.",
      );
    }

    const sourcePath = resolve(input.source.databasePath());
    const destinationPath = resolve(input.destination.databasePath());
    if (sourcePath === destinationPath) {
      throw new DataRecoveryError(
        "RECOVERY_DESTINATION_CONFLICT",
        "Recovery staging must use a different physical database path and never overwrite the canonical source.",
      );
    }

    const source = await this.inspect({ source: input.source });

    const verified =
      kind === "sqlite-backup"
        ? await this.backup.verifyBackup({
            artifactDirectory: input.artifactDirectory,
            expectedBinding: input.source.binding,
          })
        : await this.backup.verifyPortableExport({
            artifactDirectory: input.artifactDirectory,
            expectedBinding: input.source.binding,
          });

    const transferReceipt =
      kind === "sqlite-backup"
        ? await this.backup.restoreBackup({
            artifactDirectory: input.artifactDirectory,
            destination: input.destination,
          })
        : await this.backup.importPortableExport({
            artifactDirectory: input.artifactDirectory,
            destination: input.destination,
          });

    const destination = await this.inspect({
      source: input.destination,
    });
    if (destination.state !== "healthy") {
      throw new DataRecoveryError(
        "RECOVERY_DESTINATION_UNHEALTHY",
        `Staged recovery candidate is not healthy (state: ${destination.state}).`,
      );
    }

    return {
      artifactKind: kind,
      artifactId: verified.manifest.artifactId,
      source,
      destination,
      transferReceipt,
      promotion: "manual-explicit-not-implemented",
    };
  }
}
