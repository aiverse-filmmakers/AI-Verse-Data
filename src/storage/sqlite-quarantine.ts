import {
  existsSync,
  lstatSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

import type { StorageDatabaseBinding } from "./types.js";
import { DataStorageError } from "./errors.js";

export const AI_VERSE_DATA_QUARANTINE_FORMAT =
  "ai-verse-data/quarantine-marker" as const;
export const AI_VERSE_DATA_QUARANTINE_VERSION = 1 as const;
export const AI_VERSE_DATA_QUARANTINE_SUFFIX = ".quarantine.json" as const;

export type DataQuarantineCategory = "physical" | "semantic";

export interface DataQuarantineMarker {
  readonly format: typeof AI_VERSE_DATA_QUARANTINE_FORMAT;
  readonly version: typeof AI_VERSE_DATA_QUARANTINE_VERSION;
  readonly category: DataQuarantineCategory;
  readonly detectedAt: string;
  readonly code: "DATABASE_CORRUPT";
  readonly message: string;
  readonly binding: StorageDatabaseBinding | null;
}

export interface DataQuarantineInput {
  readonly category: DataQuarantineCategory;
  readonly message: string;
  readonly binding: StorageDatabaseBinding | null;
}

export function quarantineMarkerPath(databaseLocation: string): string {
  return `${databaseLocation}${AI_VERSE_DATA_QUARANTINE_SUFFIX}`;
}

function validBinding(
  value: unknown,
): value is StorageDatabaseBinding | null {
  if (value === null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const binding = value as Partial<StorageDatabaseBinding>;
  return (
    binding.bindingVersion === 1 &&
    (binding.kind === "standalone" || binding.kind === "workspace") &&
    typeof binding.workspaceId === "string" &&
    binding.workspaceId.length >= 1 &&
    binding.workspaceId.length <= 128
  );
}

function parseMarker(raw: string): DataQuarantineMarker {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new DataStorageError(
      "DATABASE_QUARANTINED",
      "AI-Verse Data quarantine marker is unreadable; canonical writes remain blocked.",
      error,
    );
  }

  if (
    parsed === null ||
    Array.isArray(parsed) ||
    typeof parsed !== "object"
  ) {
    throw new DataStorageError(
      "DATABASE_QUARANTINED",
      "AI-Verse Data quarantine marker is invalid; canonical writes remain blocked.",
    );
  }

  const value = parsed as Partial<DataQuarantineMarker>;
  if (
    value.format !== AI_VERSE_DATA_QUARANTINE_FORMAT ||
    value.version !== AI_VERSE_DATA_QUARANTINE_VERSION ||
    (value.category !== "physical" && value.category !== "semantic") ||
    value.code !== "DATABASE_CORRUPT" ||
    typeof value.message !== "string" ||
    value.message.length < 1 ||
    value.message.length > 4096 ||
    typeof value.detectedAt !== "string" ||
    Number.isNaN(Date.parse(value.detectedAt)) ||
    !validBinding(value.binding)
  ) {
    throw new DataStorageError(
      "DATABASE_QUARANTINED",
      "AI-Verse Data quarantine marker is invalid; canonical writes remain blocked.",
    );
  }

  return value as DataQuarantineMarker;
}

export function readQuarantineMarker(
  databaseLocation: string,
): DataQuarantineMarker | null {
  const path = quarantineMarkerPath(databaseLocation);
  if (!existsSync(path)) return null;

  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new DataStorageError(
      "DATABASE_QUARANTINED",
      "AI-Verse Data quarantine marker path is unsafe; canonical writes remain blocked.",
    );
  }

  return parseMarker(readFileSync(path, "utf8"));
}

export function assertNotQuarantined(databaseLocation: string): void {
  const marker = readQuarantineMarker(databaseLocation);
  if (marker === null) return;
  throw new DataStorageError(
    "DATABASE_QUARANTINED",
    `AI-Verse Data database is quarantined after ${marker.category} corruption detection at ${marker.detectedAt}: ${marker.message}`,
  );
}

export function markDatabaseQuarantined(
  databaseLocation: string,
  input: DataQuarantineInput,
): DataQuarantineMarker {
  const existing = readQuarantineMarker(databaseLocation);
  if (existing !== null) return existing;

  const marker: DataQuarantineMarker = {
    format: AI_VERSE_DATA_QUARANTINE_FORMAT,
    version: AI_VERSE_DATA_QUARANTINE_VERSION,
    category: input.category,
    detectedAt: new Date().toISOString(),
    code: "DATABASE_CORRUPT",
    message: input.message.slice(0, 4096),
    binding:
      input.binding === null
        ? null
        : { ...input.binding },
  };

  const path = quarantineMarkerPath(databaseLocation);
  try {
    writeFileSync(path, JSON.stringify(marker), {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { readonly code?: unknown }).code === "EEXIST"
    ) {
      return readQuarantineMarker(databaseLocation) ?? marker;
    }
    throw new DataStorageError(
      "DATABASE_UNAVAILABLE",
      "Unable to persist AI-Verse Data quarantine evidence.",
      error,
    );
  }

  return marker;
}
