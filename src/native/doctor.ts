import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  statSync,
} from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import {
  TrustedDataRoot,
  createWorkspaceDataScope,
} from "../scope/index.js";
import { AiVerseDataExtensionInstallError } from "./extension-types.js";
import { AiVerseDataInstructionError } from "./instruction-types.js";
import { AiVerseWorkspaceError } from "./workspace-types.js";
import { AiVerseOsCompatibilityDetector } from "./compatibility.js";
import {
  currentDataExtensionEntry,
  readRegistryDocument,
} from "./extension-registry.js";
import { discoverExtensionInstructions } from "./instruction-discovery.js";
import { discoverWorkspaceData } from "./workspace-discovery.js";
import { resolveWorkspace } from "./workspace-resolver.js";
import {
  AI_VERSE_DATA_MIN_SQLITE_VERSION,
  SqliteStorageDriver,
} from "../storage/index.js";
import type {
  AiVerseDoctorCommand,
  AiVerseDoctorDatabase,
  AiVerseDoctorInput,
  AiVerseDoctorIntegrity,
  AiVerseDoctorMigration,
  AiVerseDoctorNotice,
  AiVerseDoctorProblem,
  AiVerseDoctorRegistration,
  AiVerseDoctorResult,
  AiVerseDoctorSqlite,
  AiVerseDoctorWal,
  AiVerseDoctorWorkspace,
} from "./doctor-types.js";

const SIBLING_NOTE =
  "Sibling layers (Memory, Brain, Bots, Skills, Apps, Connections, Dashboard) are informational only; missing layers never block Data.";

function problem(
  code: string,
  message: string,
  nextStep: string,
): AiVerseDoctorProblem {
  return { code, message, nextStep };
}

function nextStepFor(code: string): string {
  switch (code) {
    case "INCOMPATIBLE_AI_VERSE_OS":
      return "Next step: fix the host contract (AI-VERSE.yaml schema 2, unified-workspace, AGENTS.md, operator/, workspaces/, system/extensions/README.md) and retry.";
    case "INVALID_EXTENSION_REGISTRY":
    case "UNSUPPORTED_EXTENSION_REGISTRY_SCHEMA":
    case "INVALID_EXISTING_EXTENSION_ENTRY":
      return "Next step: inspect .aiverse/extensions/registry.json (schema_version 1.0, object extensions, boolean enabled) without hand-editing unrelated entries.";
    case "WORKSPACE_NOT_FOUND":
      return "Next step: pass an existing workspace id or create it in the OS before requesting Data state.";
    case "WORKSPACE_NOT_ACTIVE":
      return "Next step: use an active workspace for Data writes; paused/archived workspaces are read-only here.";
    case "WORKSPACE_ID_MISMATCH":
    case "WORKSPACE_STATUS_INVALID":
    case "WORKSPACE_MANIFEST_MALFORMED":
      return "Next step: fix workspaces/<id>/WORKSPACE.yaml so id matches the directory and status is active, paused, or archived.";
    case "WORKSPACE_DATABASE_MIGRATION_REQUIRED":
      return "Next step: run an explicit internal migration operation; doctor never migrates automatically.";
    case "WORKSPACE_DATABASE_QUARANTINED":
      return "Next step: inspect the quarantine marker beside the database and recover from a verified backup; doctor never repairs automatically.";
    case "WORKSPACE_DATABASE_CONFLICT":
      return "Next step: stop copying databases across workspaces; each database is bound to exactly one workspace.";
    case "SYMLINK_PATH_REJECTED":
    case "WORKSPACE_DATA_UNSAFE":
      return "Next step: remove symlinked or unsafe paths under workspaces/ and .aiverse/extensions/ and retry.";
    default:
      return "Next step: re-run doctor; canonical workspace databases were preserved.";
  }
}

function parseVersion(value: string): readonly number[] {
  return value.split(".").map((part) => Number.parseInt(part, 10));
}

function versionAtLeast(actual: string, minimum: string): boolean {
  const left = parseVersion(actual);
  const right = parseVersion(minimum);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

function sqliteRuntime(): AiVerseDoctorSqlite | null {
  let raw: Database.Database | undefined;
  try {
    raw = new Database(":memory:");
    const row = raw
      .prepare("SELECT sqlite_version() AS version")
      .get() as { readonly version?: unknown } | undefined;
    const version =
      typeof row?.version === "string" ? row.version : "unknown";
    return {
      version,
      meetsMinimum:
        version === "unknown"
          ? false
          : versionAtLeast(version, AI_VERSE_DATA_MIN_SQLITE_VERSION),
      minimum: AI_VERSE_DATA_MIN_SQLITE_VERSION,
    };
  } catch {
    return null;
  } finally {
    if (raw !== undefined) {
      try {
        raw.close();
      } catch {
        // Preserve the diagnosis result.
      }
    }
  }
}

function quickIntegrity(
  databasePath: string,
): { readonly ok: boolean; readonly messages: readonly string[] } | null {
  let raw: Database.Database | undefined;
  try {
    raw = new Database(databasePath, {
      readonly: true,
      fileMustExist: true,
    });
    const rows = raw.pragma("integrity_check(1)") as Array<
      Record<string, unknown>
    >;
    const messages = rows.map((row) =>
      String(row.integrity_check ?? Object.values(row)[0] ?? "unknown"),
    );
    return {
      ok: messages.length === 1 && messages[0]?.toLowerCase() === "ok",
      messages,
    };
  } catch {
    return null;
  } finally {
    if (raw !== undefined) {
      try {
        raw.close();
      } catch {
        // Preserve the diagnosis result.
      }
    }
  }
}

async function runCheck(
  command: AiVerseDoctorCommand,
  input: AiVerseDoctorInput,
): Promise<AiVerseDoctorResult> {
  const problems: AiVerseDoctorProblem[] = [];
  const notices: AiVerseDoctorNotice[] = [];

  const compatibility = new AiVerseOsCompatibilityDetector().inspect({
    rootPath: input.rootPath,
  });
  const hostIssues = compatibility.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
  }));

  if (compatibility.status === "incompatible") {
    problems.push(
      problem(
        "INCOMPATIBLE_AI_VERSE_OS",
        `Host is incompatible: ${compatibility.issues.map((i) => i.code).join(", ") || "unknown incompatibility"}.`,
        nextStepFor("INCOMPATIBLE_AI_VERSE_OS"),
      ),
    );
    return {
      command,
      healthy: false,
      mode: "incompatible",
      rootPath: compatibility.rootPath ?? input.rootPath,
      workspaceId: input.workspaceId ?? null,
      host: { status: "incompatible", issues: hostIssues },
      registration: null,
      instructions: null,
      workspace: null,
      database: null,
      sqlite: sqliteRuntime(),
      integrity: null,
      wal: null,
      problems,
      notices,
      siblingNote: SIBLING_NOTE,
    };
  }

  if (compatibility.status === "no-os" || compatibility.rootPath === null) {
    notices.push({
      code: "STANDALONE_MODE",
      message:
        "No AI-Verse OS detected; reporting standalone mode. Missing sibling layers never block Data.",
    });
    return {
      command,
      healthy: true,
      mode: "standalone",
      rootPath: input.rootPath,
      workspaceId: input.workspaceId ?? null,
      host: { status: "no-os", issues: hostIssues },
      registration: null,
      instructions: null,
      workspace: null,
      database: null,
      sqlite: sqliteRuntime(),
      integrity: { checked: false, ok: null, messages: [] },
      wal: { checked: false, writable: null },
      problems,
      notices,
      siblingNote: SIBLING_NOTE,
    };
  }

  const canonicalRoot = compatibility.rootPath;
  let root: TrustedDataRoot;
  try {
    root = TrustedDataRoot.fromExistingDirectory(canonicalRoot);
  } catch (error) {
    problems.push(
      problem(
        "INCOMPATIBLE_AI_VERSE_OS",
        `Compatible root could not be trusted: ${error instanceof Error ? error.message : "unknown filesystem error"}.`,
        nextStepFor("INCOMPATIBLE_AI_VERSE_OS"),
      ),
    );
    return {
      command,
      healthy: false,
      mode: "incompatible",
      rootPath: canonicalRoot,
      workspaceId: input.workspaceId ?? null,
      host: { status: compatibility.status, issues: hostIssues },
      registration: null,
      instructions: null,
      workspace: null,
      database: null,
      sqlite: sqliteRuntime(),
      integrity: null,
      wal: null,
      problems,
      notices,
      siblingNote: SIBLING_NOTE,
    };
  }

  let registration: AiVerseDoctorRegistration | null = null;
  try {
    const snapshot = readRegistryDocument(root);
    const entry = currentDataExtensionEntry(snapshot.extensions);
    if (entry === null) {
      registration = {
        registryExists: snapshot.exists,
        registered: false,
        installed: false,
        enabled: null,
        version: null,
      };
      notices.push({
        code: "NOT_REGISTERED",
        message: "ai-verse-data is not registered in the local extension registry.",
      });
    } else {
      const supported = entry.supported;
      const installed = entry.installed;
      const enabled = entry.enabled;
      if (
        typeof supported !== "boolean" ||
        typeof installed !== "boolean" ||
        (enabled !== undefined && typeof enabled !== "boolean")
      ) {
        throw new AiVerseDataExtensionInstallError(
          "INVALID_EXISTING_EXTENSION_ENTRY",
          "Existing ai-verse-data entry has non-boolean supported/installed/enabled state.",
        );
      }
      registration = {
        registryExists: snapshot.exists,
        registered: true,
        installed: installed === true,
        enabled: typeof enabled === "boolean" ? enabled : true,
        version:
          typeof entry.version === "string" && entry.version.length > 0
            ? entry.version
            : null,
      };
      if (supported !== true || installed !== true) {
        problems.push(
          problem(
            "EXTENSION_NOT_READY",
            "ai-verse-data registry entry is not supported and installed.",
            "Next step: run 'ai-verse-data install --root <os-root>' and retry.",
          ),
        );
      }
      if (registration.enabled === false) {
        notices.push({
          code: "EXTENSION_DISABLED",
          message: "ai-verse-data is registered but disabled (enabled: false).",
        });
      }
    }
  } catch (error) {
    const code =
      error instanceof AiVerseDataExtensionInstallError
        ? error.code
        : "INVALID_EXTENSION_REGISTRY";
    problems.push(
      problem(
        code,
        error instanceof Error ? error.message : "Extension registry is unreadable.",
        nextStepFor(code),
      ),
    );
  }

  let instructionStatus: AiVerseDoctorResult["instructions"] = null;
  try {
    const discovered = discoverExtensionInstructions({
      rootPath: root.canonicalPath,
    });
    instructionStatus = { status: discovered.status };
  } catch (error) {
    if (registration !== null) {
      const code =
        error instanceof AiVerseDataInstructionError
          ? error.code
          : "INVALID_EXTENSION_FILE";
      problems.push(
        problem(
          code,
          error instanceof Error ? error.message : "Extension instructions are unreadable.",
          nextStepFor(code),
        ),
      );
    }
  }

  let workspace: AiVerseDoctorWorkspace | null = null;
  let database: AiVerseDoctorDatabase | null = null;
  let integrity: AiVerseDoctorIntegrity | null = null;
  let wal: AiVerseDoctorWal | null = null;

  if (input.workspaceId === undefined) {
    notices.push({
      code: "NO_WORKSPACE_REQUESTED",
      message: "No workspace requested; database state was not inspected.",
    });
  } else {
    try {
      const resolved = resolveWorkspace({
        rootPath: root.canonicalPath,
        workspaceId: input.workspaceId,
      });
      workspace = {
        workspaceId: resolved.workspaceId,
        status: resolved.manifest.status,
        databasePath: resolved.databasePath,
      };
      if (resolved.manifest.status !== "active") {
        notices.push({
          code: "WORKSPACE_NOT_ACTIVE",
          message: `Workspace '${resolved.workspaceId}' has status '${resolved.manifest.status}'.`,
        });
      }

      const discovery = await discoverWorkspaceData({
        rootPath: root.canonicalPath,
        workspaceId: resolved.workspaceId,
      });

      let migration: AiVerseDoctorMigration | null = null;
      if (discovery.state === "migration_required") {
        try {
          const scope = createWorkspaceDataScope(
            root,
            resolved.workspaceId,
          );
          const driver = new SqliteStorageDriver();
          const status = driver.inspectMigration({
            location: scope.databasePath(),
            expectedBinding: scope.binding,
          });
          migration = {
            state: status.state,
            pendingMigrationIds: [...status.pendingMigrationIds],
            incompleteMigrationIds: [...status.incompleteMigrationIds],
          };
        } catch {
          migration = {
            state:
              discovery.nativeDetail === "incomplete"
                ? "incomplete"
                : "required",
            pendingMigrationIds: [],
            incompleteMigrationIds: [],
          };
        }
      } else if (discovery.state === "compatible") {
        migration = {
          state: "current",
          pendingMigrationIds: [],
          incompleteMigrationIds: [],
        };
      }

      const db: AiVerseDoctorDatabase = {
        state: discovery.state,
        detail: discovery.detail,
        databaseFormatVersion: discovery.databaseFormatVersion,
        bindingWorkspaceId: discovery.bindingWorkspaceId,
        migration,
      };
      database = db;

      switch (discovery.state) {
        case "compatible":
          break;
        case "missing":
          notices.push({
            code: "DATABASE_MISSING",
            message: "No workspace database exists at the resolved Data path.",
          });
          break;
        case "migration_required":
          problems.push(
            problem(
              "WORKSPACE_DATABASE_MIGRATION_REQUIRED",
              discovery.detail,
              nextStepFor("WORKSPACE_DATABASE_MIGRATION_REQUIRED"),
            ),
          );
          break;
        case "quarantined":
          problems.push(
            problem(
              "WORKSPACE_DATABASE_QUARANTINED",
              discovery.detail,
              nextStepFor("WORKSPACE_DATABASE_QUARANTINED"),
            ),
          );
          break;
        case "scope_conflict":
          problems.push(
            problem(
              "WORKSPACE_DATABASE_CONFLICT",
              discovery.detail,
              nextStepFor("WORKSPACE_DATABASE_CONFLICT"),
            ),
          );
          break;
        case "unsupported":
          problems.push(
            problem(
              "WORKSPACE_DATABASE_UNSUPPORTED",
              discovery.detail,
              "Next step: verify the file is an AI-Verse Data database for this workspace; doctor never replaces it.",
            ),
          );
          break;
        case "unavailable":
          problems.push(
            problem(
              "WORKSPACE_DATA_UNAVAILABLE",
              discovery.detail,
              nextStepFor("WORKSPACE_DATA_UNAVAILABLE"),
            ),
          );
          break;
      }

      if (
        discovery.state === "compatible" ||
        discovery.state === "migration_required" ||
        discovery.state === "quarantined"
      ) {
        const dbPath = resolved.databasePath;
        try {
          const info = lstatSync(dbPath);
          if (info.isSymbolicLink()) {
            problems.push(
              problem(
                "SYMLINK_PATH_REJECTED",
                "Workspace database must not be a symbolic link.",
                nextStepFor("SYMLINK_PATH_REJECTED"),
              ),
            );
          } else if (!info.isFile()) {
            problems.push(
              problem(
                "WORKSPACE_DATA_UNAVAILABLE",
                "Workspace database path is not a regular file.",
                nextStepFor("WORKSPACE_DATA_UNAVAILABLE"),
              ),
            );
          }
        } catch {
          problems.push(
            problem(
              "WORKSPACE_DATA_UNAVAILABLE",
              "Workspace database could not be inspected.",
              nextStepFor("WORKSPACE_DATA_UNAVAILABLE"),
            ),
          );
        }
        try {
          accessSync(dbPath, constants.R_OK);
        } catch {
          problems.push(
            problem(
              "WORKSPACE_DATA_UNAVAILABLE",
              "Workspace database is not readable.",
              nextStepFor("WORKSPACE_DATA_UNAVAILABLE"),
            ),
          );
        }

        if (command === "doctor") {
          if (discovery.state === "compatible") {
            const checked = quickIntegrity(dbPath);
            if (checked === null) {
              integrity = {
                checked: true,
                ok: false,
                messages: ["integrity check could not be completed"],
              };
              problems.push(
                problem(
                  "WORKSPACE_DATABASE_QUARANTINED",
                  "SQLite integrity check could not be completed.",
                  nextStepFor("WORKSPACE_DATABASE_QUARANTINED"),
                ),
              );
            } else {
              integrity = {
                checked: true,
                ok: checked.ok,
                messages: [...checked.messages],
              };
              if (!checked.ok) {
                problems.push(
                  problem(
                    "WORKSPACE_DATABASE_QUARANTINED",
                    `SQLite integrity check failed: ${checked.messages.join("; ")}`,
                    nextStepFor("WORKSPACE_DATABASE_QUARANTINED"),
                  ),
                );
              }
            }
          } else {
            integrity = { checked: false, ok: null, messages: [] };
          }

          try {
            accessSync(dirname(dbPath), constants.W_OK);
            const walSize = (() => {
              try {
                return statSync(`${dbPath}-wal`).size;
              } catch {
                return 0;
              }
            })();
            void walSize;
            wal = { checked: true, writable: true };
          } catch {
            wal = { checked: true, writable: false };
            problems.push(
              problem(
                "WORKSPACE_DATA_UNAVAILABLE",
                "Workspace data directory is not writable for WAL mode.",
                nextStepFor("WORKSPACE_DATA_UNAVAILABLE"),
              ),
            );
          }
        } else {
          integrity = { checked: false, ok: null, messages: [] };
          wal = { checked: false, writable: null };
        }
      } else {
        integrity =
          command === "doctor"
            ? { checked: false, ok: null, messages: [] }
            : { checked: false, ok: null, messages: [] };
        wal = { checked: false, writable: null };
      }

      if (
        existsSync(resolved.databasePath) &&
        !existsSync(`${resolved.databasePath}-journal`)
      ) {
        void 0;
      }
    } catch (error) {
      const code =
        error instanceof AiVerseWorkspaceError
          ? error.code
          : error instanceof AiVerseDataInstructionError
            ? error.code
            : "WORKSPACE_DATA_UNAVAILABLE";
      problems.push(
        problem(
          code,
          error instanceof Error ? error.message : "Workspace could not be resolved.",
          nextStepFor(code),
        ),
      );
      if (command === "doctor") {
        integrity = { checked: false, ok: null, messages: [] };
        wal = { checked: false, writable: null };
      } else {
        integrity = { checked: false, ok: null, messages: [] };
        wal = { checked: false, writable: null };
      }
    }
  }

  const sqlite = sqliteRuntime();
  if (sqlite === null) {
    problems.push(
      problem(
        "SQLITE_UNAVAILABLE",
        "SQLite runtime version could not be determined.",
        "Next step: verify better-sqlite3 is installed and retry.",
      ),
    );
  } else if (!sqlite.meetsMinimum) {
    problems.push(
      problem(
        "SQLITE_VERSION_UNSUPPORTED",
        `SQLite ${sqlite.version} is unsupported; requires ${sqlite.minimum} or newer.`,
        "Next step: upgrade the SQLite runtime and retry.",
      ),
    );
  }

  return {
    command,
    healthy: problems.length === 0,
    mode: "ai-verse-os-v2",
    rootPath: root.canonicalPath,
    workspaceId: input.workspaceId ?? null,
    host: { status: compatibility.status, issues: hostIssues },
    registration,
    instructions: instructionStatus,
    workspace,
    database,
    sqlite,
    integrity,
    wal,
    problems,
    notices,
    siblingNote: SIBLING_NOTE,
  };
}

export function doctorData(
  input: AiVerseDoctorInput,
): Promise<AiVerseDoctorResult> {
  return runCheck("doctor", input);
}

export function statusData(
  input: AiVerseDoctorInput,
): Promise<AiVerseDoctorResult> {
  return runCheck("status", input);
}

export class AiVerseDataDoctor {
  doctor(input: AiVerseDoctorInput): Promise<AiVerseDoctorResult> {
    return doctorData(input);
  }

  status(input: AiVerseDoctorInput): Promise<AiVerseDoctorResult> {
    return statusData(input);
  }
}
