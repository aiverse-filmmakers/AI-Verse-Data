#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface PackageMetadata {
  readonly version: string;
}

export const HELP_TEXT = `AI-Verse Data\n\nUsage:\n  ai-verse-data --help\n  ai-verse-data --version\n\nOptions:\n  -h, --help       Show this help text\n  -v, --version    Show package version\n\nPhase 1.8 provides schema-aware record CRUD, bounded safe queries and aggregates, declared relations, and bounded atomic transactions. Persistent idempotency, events, and receipts are added in later tasks.\n`;

function packageVersion(): string {
  const packageUrl = new URL("../../package.json", import.meta.url);
  const metadata = JSON.parse(readFileSync(packageUrl, "utf8")) as PackageMetadata;
  if (typeof metadata.version !== "string" || metadata.version.length === 0) {
    throw new Error("Package metadata does not contain a valid version.");
  }
  return metadata.version;
}

export function main(argv: readonly string[]): number {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${packageVersion()}\n`);
    return 0;
  }

  process.stderr.write(`Unknown argument: ${argv[0] ?? ""}\nRun 'ai-verse-data --help' for usage.\n`);
  return 2;
}

const directEntry = process.argv[1];
if (directEntry !== undefined && resolve(directEntry) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
