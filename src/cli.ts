#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

Options:
  -h, --help       Show this help text
  -v, --version    Show package version
  --root <os-root> Trusted AI-Verse OS root (required for lifecycle commands)
  --json           Machine-readable JSON output

Phase 3.5 adds native CLI install/update/disable/uninstall composing Task 19-22 primitives while preserving canonical workspace databases. Purge stays separate/destructive and Task 24 doctor/status remains next.
`;

const LIFECYCLE_COMMANDS = new Set([
  "install",
  "update",
  "disable",
  "uninstall",
]);

type LifecycleCommand = "install" | "update" | "disable" | "uninstall";

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
): { readonly command: LifecycleCommand; readonly rootPath: string; readonly json: boolean } {
  const command = argv[0] as LifecycleCommand;
  const rest = argv.slice(1);
  let rootPath: string | null = null;
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

  return { command, rootPath, json };
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

export function main(argv: readonly string[]): number {
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
      readonly json: boolean;
    };
    try {
      parsed = parseLifecycle(argv);
    } catch (thrown) {
      return (thrown as { readonly exitCode: number }).exitCode;
    }
    return runLifecycle(parsed.command, parsed.rootPath, parsed.json);
  }

  process.stderr.write(`Unknown argument: ${argv[0] ?? ""}\nRun 'ai-verse-data --help' for usage.\n`);
  return 2;
}

const directEntry = process.argv[1];
if (directEntry !== undefined && resolve(directEntry) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
