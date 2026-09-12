#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AiVerseDataDoctor,
} from "./native/index.js";
import {
  AiVerseDataExtensionLifecycle,
  AiVerseDataLifecycleError,
} from "./native/index.js";

interface PackageMetadata {
  readonly version: string;
}

export const HELP_TEXT = `AI-Verse Data

Usage:
  ai-verse-data --help
  ai-verse-data --version
  ai-verse-data install --root <os-root> [--json]
  ai-verse-data update --root <os-root> [--json]
  ai-verse-data disable --root <os-root> [--json]
  ai-verse-data uninstall --root <os-root> [--json]
  ai-verse-data doctor --root <os-root> [--workspace <id>] [--json]
  ai-verse-data status --root <os-root> [--workspace <id>] [--json]

Options:
  -h, --help       Show this help text
  -v, --version    Show package version
  --root <os-root> Trusted AI-Verse OS root (required for lifecycle and health commands)
  --workspace <id> Workspace id for database state (optional for doctor/status)
  --json           Machine-readable JSON output

Phase 3.6 adds read-only native doctor plus status composing Task 19-23 primitives without mutating registries, tracked files, or canonical databases. Task 25 coexistence suite remains next.
`;

const LIFECYCLE_COMMANDS = new Set([
  "install",
  "update",
  "disable",
  "uninstall",
]);

const READ_COMMANDS = new Set(["doctor", "status"]);

type LifecycleCommand = "install" | "update" | "disable" | "uninstall";
type ReadCommand = "doctor" | "status";

function packageVersion(): string {
  const packageUrl = new URL("../../package.json", import.meta.url);
  const metadata = JSON.parse(readFileSync(packageUrl, "utf8")) as PackageMetadata;
  if (typeof metadata.version !== "string" || metadata.version.length === 0) {
    throw new Error("Package metadata does not contain a valid version.");
  }
  return metadata.version;
}

function nextStepFor(code: string): string {
  switch (code) {
    case "AI_VERSE_OS_NOT_FOUND":
      return "Next step: pass --root <path-to-AI-Verse-OS> for a compatible AI-Verse OS v2 host.";
    case "INCOMPATIBLE_AI_VERSE_OS":
      return "Next step: fix the host contract (AI-VERSE.yaml schema 2, unified-workspace, AGENTS.md, operator/, workspaces/, system/extensions/README.md) and retry.";
    case "EXTENSION_REGISTRY_BUSY":
    case "EXTENSION_REGISTRY_LOCK_FAILED":
      return "Next step: wait for the other installer to finish, then retry; locks are never stolen automatically.";
    case "EXTENSION_REGISTRY_CHANGED":
      return "Next step: re-run the command; a competing registry writer changed state during the operation.";
    case "EXTENSION_NOT_INSTALLED":
      return "Next step: run 'ai-verse-data install --root <os-root>' first.";
    case "INVALID_EXTENSION_REGISTRY":
    case "UNSUPPORTED_EXTENSION_REGISTRY_SCHEMA":
    case "INVALID_EXISTING_EXTENSION_ENTRY":
      return "Next step: inspect .aiverse/extensions/registry.json (schema_version 1.0, object extensions, boolean enabled) without hand-editing unrelated entries.";
    case "SYMLINK_PATH_REJECTED":
    case "INVALID_EXTENSION_PATH":
    case "INVALID_EXTENSION_DIRECTORY":
    case "INVALID_EXTENSION_FILE":
      return "Next step: remove symlinked or unsafe extension paths under .aiverse/extensions/ and retry.";
    default:
      return "Next step: re-run the command; canonical workspace databases were preserved.";
  }
}

function parseLifecycle(
  argv: readonly string[],
): {
  readonly command: LifecycleCommand | ReadCommand;
  readonly rootPath: string;
  readonly workspaceId?: string;
  readonly json: boolean;
} {
  const command = argv[0] as LifecycleCommand | ReadCommand;
  const rest = argv.slice(1);
  let rootPath: string | null = null;
  let workspaceId: string | undefined;
  let json = false;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]!;
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--root") {
      const value = rest[index + 1];
      if (value === undefined || value.length === 0) {
        process.stderr.write(
          `Missing value for --root.\nRun 'ai-verse-data ${command} --root <os-root>'.\n`,
        );
        throw { exitCode: 2 as const };
      }
      rootPath = value;
      index += 1;
      continue;
    }
    if (token.startsWith("--root=")) {
      const value = token.slice("--root=".length);
      if (value.length === 0) {
        process.stderr.write(
          `Missing value for --root.\nRun 'ai-verse-data ${command} --root <os-root>'.\n`,
        );
        throw { exitCode: 2 as const };
      }
      rootPath = value;
      continue;
    }
    if (token === "--workspace") {
      const value = rest[index + 1];
      if (value === undefined || value.length === 0) {
        process.stderr.write(
          `Missing value for --workspace.\nRun 'ai-verse-data ${command} --root <os-root> --workspace <id>'.\n`,
        );
        throw { exitCode: 2 as const };
      }
      workspaceId = value;
      index += 1;
      continue;
    }
    if (token.startsWith("--workspace=")) {
      const value = token.slice("--workspace=".length);
      if (value.length === 0) {
        process.stderr.write(
          `Missing value for --workspace.\nRun 'ai-verse-data ${command} --root <os-root> --workspace <id>'.\n`,
        );
        throw { exitCode: 2 as const };
      }
      workspaceId = value;
      continue;
    }
    if (token === "--help" || token === "-h") {
      process.stdout.write(HELP_TEXT);
      throw { exitCode: 0 as const };
    }
    process.stderr.write(
      `Unknown argument: ${token}\nRun 'ai-verse-data --help' for usage.\n`,
    );
    throw { exitCode: 2 as const };
  }

  if (rootPath === null) {
    process.stderr.write(
      `Missing required --root <os-root>.\nRun 'ai-verse-data ${command} --root <os-root>'.\n`,
    );
    throw { exitCode: 2 as const };
  }

  if (workspaceId === undefined) {
    return { command, rootPath, json };
  }
  return { command, rootPath, workspaceId, json };
}

function runLifecycle(
  command: LifecycleCommand,
  rootPath: string,
  json: boolean,
): number {
  const lifecycle = new AiVerseDataExtensionLifecycle();
  try {
    const result =
      command === "install"
        ? lifecycle.install({ rootPath })
        : command === "update"
          ? lifecycle.update({ rootPath })
          : command === "disable"
            ? lifecycle.disable({ rootPath })
            : lifecycle.uninstall({ rootPath });

    if (json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      const lines = [
        `AI-Verse Data ${command}: ${result.status}`,
        `Root: ${result.rootPath}`,
        `Registry written: ${result.registryWritten ? "yes" : "no"}`,
        `Enabled: ${result.enabled === null ? "n/a" : result.enabled ? "yes" : "no"}`,
        `Workspace databases preserved: yes`,
      ];
      if (result.materializedPaths.length > 0) {
        lines.push(`Materialized: ${result.materializedPaths.join(", ")}`);
      }
      if (result.removedPaths.length > 0) {
        lines.push(`Removed: ${result.removedPaths.join(", ")}`);
      }
      process.stdout.write(`${lines.join("\n")}\n`);
    }
    return 0;
  } catch (error) {
    const code =
      error instanceof AiVerseDataLifecycleError
        ? error.code
        : "EXTENSION_MATERIALIZATION_FAILED";
    const message =
      error instanceof Error && error.message.length > 0
        ? error.message
        : "Native lifecycle command failed.";
    process.stderr.write(`Error ${code}: ${message}\n${nextStepFor(code)}\n`);
    return 1;
  }
}

async function runRead(
  command: ReadCommand,
  rootPath: string,
  workspaceId: string | undefined,
  json: boolean,
): Promise<number> {
  const doctor = new AiVerseDataDoctor();
  let result;
  try {
    result =
      command === "doctor"
        ? await doctor.doctor(
            workspaceId === undefined
              ? { rootPath }
              : { rootPath, workspaceId },
          )
        : await doctor.status(
            workspaceId === undefined
              ? { rootPath }
              : { rootPath, workspaceId },
          );
  } catch (error) {
    const message =
      error instanceof Error && error.message.length > 0
        ? error.message
        : "Native health command failed.";
    process.stderr.write(
      `Error HEALTH_CHECK_FAILED: ${message}\nNext step: re-run the command; canonical workspace databases were preserved.\n`,
    );
    return 1;
  }
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const lines = [
      `AI-Verse Data ${result.command}: ${result.healthy ? "healthy" : "needs attention"}`,
      `Mode: ${result.mode}`,
      `Root: ${result.rootPath}`,
      `Host: ${result.host.status}`,
      `Registered: ${result.registration === null ? "n/a" : result.registration.registered ? "yes" : "no"}`,
      `Enabled: ${result.registration?.enabled === null || result.registration?.enabled === undefined ? "n/a" : result.registration.enabled ? "yes" : "no"}`,
      `Workspace: ${result.workspaceId ?? "n/a"}`,
      `Database: ${result.database?.state ?? "n/a"}`,
      `SQLite: ${result.sqlite?.version ?? "n/a"}`,
    ];
    if (result.command === "doctor") {
      lines.push(
        `Integrity: ${result.integrity?.checked === true ? (result.integrity.ok === true ? "ok" : "failed") : "not checked"}`,
      );
    }
    for (const issue of result.problems) {
      lines.push(`Problem ${issue.code}: ${issue.message}`);
      lines.push(issue.nextStep);
    }
    for (const notice of result.notices) {
      lines.push(`Notice ${notice.code}: ${notice.message}`);
    }
    process.stdout.write(`${lines.join("\n")}\n`);
  }
  return result.healthy ? 0 : 1;
}

export function main(argv: readonly string[]): number | Promise<number> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    if (argv.length > 0 && LIFECYCLE_COMMANDS.has(argv[0]!)) {
      try {
        parseLifecycle(argv);
      } catch (thrown) {
        return (thrown as { readonly exitCode: number }).exitCode;
      }
      process.stdout.write(HELP_TEXT);
      return 0;
    }
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${packageVersion()}\n`);
    return 0;
  }

  const [first] = argv;
  if (first !== undefined && LIFECYCLE_COMMANDS.has(first)) {
    let parsed: {
      readonly command: LifecycleCommand;
      readonly rootPath: string;
      readonly workspaceId?: string;
      readonly json: boolean;
    };
    try {
      const raw = parseLifecycle(argv);
      if (
        raw.command !== "install" &&
        raw.command !== "update" &&
        raw.command !== "disable" &&
        raw.command !== "uninstall"
      ) {
        process.stderr.write(
          `Unknown argument: ${argv[0] ?? ""}\nRun 'ai-verse-data --help' for usage.\n`,
        );
        return 2;
      }
      parsed = raw as {
        readonly command: LifecycleCommand;
        readonly rootPath: string;
        readonly workspaceId?: string;
        readonly json: boolean;
      };
    } catch (thrown) {
      return (thrown as { readonly exitCode: number }).exitCode;
    }
    return runLifecycle(parsed.command, parsed.rootPath, parsed.json);
  }

  if (first !== undefined && READ_COMMANDS.has(first)) {
    let parsed: {
      readonly command: ReadCommand;
      readonly rootPath: string;
      readonly workspaceId?: string;
      readonly json: boolean;
    };
    try {
      const raw = parseLifecycle(argv);
      if (raw.command !== "doctor" && raw.command !== "status") {
        process.stderr.write(
          `Unknown argument: ${argv[0] ?? ""}\nRun 'ai-verse-data --help' for usage.\n`,
        );
        return 2;
      }
      parsed = raw as {
        readonly command: ReadCommand;
        readonly rootPath: string;
        readonly workspaceId?: string;
        readonly json: boolean;
      };
    } catch (thrown) {
      return (thrown as { readonly exitCode: number }).exitCode;
    }
    return runRead(
      parsed.command,
      parsed.rootPath,
      parsed.workspaceId,
      parsed.json,
    );
  }

  process.stderr.write(`Unknown argument: ${argv[0] ?? ""}\nRun 'ai-verse-data --help' for usage.\n`);
  return 2;
}

const directEntry = process.argv[1];
if (directEntry !== undefined && resolve(directEntry) === fileURLToPath(import.meta.url)) {
  const outcome = main(process.argv.slice(2));
  if (typeof outcome === "number") {
    process.exitCode = outcome;
  } else {
    outcome.then(
      (code) => {
        process.exitCode = code;
      },
      () => {
        process.exitCode = 1;
      },
    );
  }
}
