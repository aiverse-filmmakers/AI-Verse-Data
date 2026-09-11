import { createHash, randomUUID } from "node:crypto";
import {
  constants as fsConstants,
  copyFileSync,
  createReadStream,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { canonicalResultJson } from "../idempotency/index.js";
import type { DataDatabaseScope } from "../scope/index.js";
import {
  AI_VERSE_DATA_DATABASE_FORMAT_VERSION,
  AI_VERSE_DATA_SCOPE_BINDING_VERSION,
  AI_VERSE_DATA_SQLITE_FORMAT,
  type DataStorageDatabase,
  type DataStorageDriver,
  type StorageDatabaseBinding,
  type StorageDatabaseMetadata,
} from "../storage/index.js";
import { DataBackupError, isDataBackupError } from "./errors.js";
import {
  assertPortableStateShape,
  collectPortableState,
  materializePortableState,
  portableStateDigest,
  sha256Utf8,
  summarizePortableState,
} from "./state.js";
import {
  AI_VERSE_DATA_ARTIFACT_FORMAT_VERSION,
  AI_VERSE_DATA_ARTIFACT_MANIFEST_FORMAT,
  AI_VERSE_DATA_ARTIFACT_RECEIPT_FORMAT,
  type DataArtifactKind,
  type DataArtifactManifest,
  type DataArtifactReceipt,
  type DataArtifactResult,
  type DataArtifactSource,
  type DataArtifactVerifyInput,
  type DataBackupApi,
  type DataBackupCreateInput,
  type DataBackupRestoreInput,
  type DataPortableExportInput,
  type DataPortableImportInput,
  type DataPortableState,
  type DataStateSummary,
  type DataTransferReceipt,
} from "./types.js";

const MANIFEST_FILE = "manifest.json";
const RECEIPT_FILE = "receipt.json";
const BACKUP_PAYLOAD_FILE = "database.sqlite";
const EXPORT_PAYLOAD_FILE = "export.json";
const MAX_METADATA_BYTES = 1024 * 1024;

interface ReadArtifact {
  readonly manifest: DataArtifactManifest;
  readonly receipt: DataArtifactReceipt;
  readonly payloadPath: string;
}

function artifactId(): string {
  return `artifact_${randomUUID().replaceAll("-", "")}`;
}

function artifactReceiptId(): string {
  return `artifact_receipt_${randomUUID().replaceAll("-", "")}`;
}

function transferReceiptId(): string {
  return `transfer_receipt_${randomUUID().replaceAll("-", "")}`;
}

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

function validBinding(value: unknown): value is StorageDatabaseBinding {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const binding = value as Partial<StorageDatabaseBinding>;
  return (
    binding.bindingVersion === AI_VERSE_DATA_SCOPE_BINDING_VERSION &&
    (binding.kind === "standalone" || binding.kind === "workspace") &&
    typeof binding.workspaceId === "string" &&
    binding.workspaceId.length >= 1 &&
    binding.workspaceId.length <= 128 &&
    binding.workspaceId !== "." &&
    binding.workspaceId !== ".." &&
    !binding.workspaceId.includes("/") &&
    !binding.workspaceId.includes("\\") &&
    !binding.workspaceId.includes("\u0000")
  );
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validateStateSummary(value: unknown): value is DataStateSummary {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const summary = value as Partial<DataStateSummary>;
  return (
    isDigest(summary.stateDigest) &&
    isCount(summary.spaceCount) &&
    isCount(summary.entityCount) &&
    isCount(summary.schemaVersionCount) &&
    isCount(summary.recordCount) &&
    isCount(summary.activeRecordCount) &&
    isCount(summary.relationCount) &&
    isCount(summary.idempotencyCount) &&
    isCount(summary.eventCount) &&
    isCount(summary.receiptCount)
  );
}

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new DataBackupError(
      "ARTIFACT_INVALID",
      `${label} is not valid JSON.`,
      undefined,
      error,
    );
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new DataBackupError(
      "ARTIFACT_INVALID",
      `${label} must be a JSON object.`,
    );
  }
  return parsed as Record<string, unknown>;
}

function validateManifest(
  raw: string,
  expectedKind: DataArtifactKind,
): DataArtifactManifest {
  const value = parseJsonObject(raw, "Artifact manifest");
  const source = value.source;
  const payload = value.payload;

  if (
    value.format !== AI_VERSE_DATA_ARTIFACT_MANIFEST_FORMAT ||
    value.formatVersion !== AI_VERSE_DATA_ARTIFACT_FORMAT_VERSION
  ) {
    throw new DataBackupError(
      "ARTIFACT_FORMAT_UNSUPPORTED",
      "Artifact manifest format is unsupported.",
    );
  }
  if (value.kind !== expectedKind) {
    throw new DataBackupError(
      "ARTIFACT_FORMAT_UNSUPPORTED",
      `Expected a ${expectedKind} artifact.`,
    );
  }
  if (
    typeof value.artifactId !== "string" ||
    !/^artifact_[0-9a-f]{32}$/.test(value.artifactId) ||
    !isTimestamp(value.createdAt) ||
    source === null ||
    Array.isArray(source) ||
    typeof source !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    typeof payload !== "object" ||
    !validateStateSummary(value.state)
  ) {
    throw new DataBackupError(
      "ARTIFACT_INVALID",
      "Artifact manifest metadata is invalid.",
    );
  }

  const sourceValue = source as Record<string, unknown>;
  if (
    sourceValue.databaseFormat !== AI_VERSE_DATA_SQLITE_FORMAT ||
    sourceValue.databaseFormatVersion !==
      AI_VERSE_DATA_DATABASE_FORMAT_VERSION ||
    sourceValue.driver !== "sqlite" ||
    !isTimestamp(sourceValue.databaseCreatedAt) ||
    !validBinding(sourceValue.binding)
  ) {
    throw new DataBackupError(
      "ARTIFACT_FORMAT_UNSUPPORTED",
      "Artifact source database metadata is unsupported or invalid.",
    );
  }

  const payloadValue = payload as Record<string, unknown>;
  const expectedFile =
    expectedKind === "sqlite-backup"
      ? BACKUP_PAYLOAD_FILE
      : EXPORT_PAYLOAD_FILE;
  const expectedMedia =
    expectedKind === "sqlite-backup"
      ? "application/vnd.sqlite3"
      : "application/json";
  if (
    payloadValue.file !== expectedFile ||
    payloadValue.mediaType !== expectedMedia ||
    !isCount(payloadValue.bytes) ||
    !isDigest(payloadValue.sha256)
  ) {
    throw new DataBackupError(
      "ARTIFACT_INVALID",
      "Artifact payload metadata is invalid.",
    );
  }

  return value as unknown as DataArtifactManifest;
}

function validateReceipt(
  raw: string,
  expectedKind: DataArtifactKind,
): DataArtifactReceipt {
  const value = parseJsonObject(raw, "Artifact receipt");
  if (
    value.format !== AI_VERSE_DATA_ARTIFACT_RECEIPT_FORMAT ||
    value.formatVersion !== AI_VERSE_DATA_ARTIFACT_FORMAT_VERSION
  ) {
    throw new DataBackupError(
      "ARTIFACT_FORMAT_UNSUPPORTED",
      "Artifact receipt format is unsupported.",
    );
  }
  if (
    value.kind !== expectedKind ||
    typeof value.receiptId !== "string" ||
    !/^artifact_receipt_[0-9a-f]{32}$/.test(value.receiptId) ||
    typeof value.artifactId !== "string" ||
    !/^artifact_[0-9a-f]{32}$/.test(value.artifactId) ||
    !isTimestamp(value.completedAt) ||
    !isDigest(value.manifestSha256) ||
    !isDigest(value.payloadSha256) ||
    !isDigest(value.stateDigest) ||
    !validBinding(value.sourceBinding)
  ) {
    throw new DataBackupError(
      "ARTIFACT_INVALID",
      "Artifact receipt metadata is invalid.",
    );
  }
  return value as unknown as DataArtifactReceipt;
}

function assertRegularFile(path: string, label: string): void {
  if (!existsSync(path)) {
    throw new DataBackupError(
      "ARTIFACT_NOT_FOUND",
      `${label} does not exist.`,
    );
  }
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new DataBackupError(
      "ARTIFACT_INVALID",
      `${label} must be a regular non-symlink file.`,
    );
  }
}

function readMetadataFile(path: string, label: string): string {
  assertRegularFile(path, label);
  const bytes = statSync(path).size;
  if (bytes > MAX_METADATA_BYTES) {
    throw new DataBackupError(
      "ARTIFACT_INVALID",
      `${label} exceeds the metadata size ceiling.`,
    );
  }
  return readFileSync(path, "utf8");
}

function assertArtifactDirectory(path: string): string {
  const absolute = resolve(path);
  if (!existsSync(absolute)) {
    throw new DataBackupError(
      "ARTIFACT_NOT_FOUND",
      "Artifact directory does not exist.",
    );
  }
  const info = lstatSync(absolute);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new DataBackupError(
      "ARTIFACT_INVALID",
      "Artifact path must be a regular non-symlink directory.",
    );
  }
  return absolute;
}

function createArtifactDirectory(path: string): string {
  const absolute = resolve(path);
  if (existsSync(absolute)) {
    throw new DataBackupError(
      "ARTIFACT_ALREADY_EXISTS",
      "Artifact destination already exists; artifacts never overwrite.",
    );
  }
  try {
    mkdirSync(absolute, { recursive: false });
  } catch (error) {
    throw new DataBackupError(
      "DATABASE_UNAVAILABLE",
      "Artifact destination could not be created.",
      undefined,
      error,
    );
  }
  return absolute;
}

function writeJsonExclusive(path: string, value: unknown): string {
  const raw = canonicalResultJson(value);
  writeFileSync(path, raw, { encoding: "utf8", flag: "wx" });
  return raw;
}

async function fileDigest(path: string): Promise<{
  readonly bytes: number;
  readonly sha256: string;
}> {
  const bytes = statSync(path).size;
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk: Buffer | string) => hash.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", resolvePromise);
  });
  return { bytes, sha256: hash.digest("hex") };
}

function sourceMetadata(metadata: StorageDatabaseMetadata): DataArtifactSource {
  if (metadata.binding === null) {
    throw new DataBackupError(
      "DATABASE_CORRUPT",
      "Backup/export requires a database with a trusted scope binding.",
    );
  }
  return {
    databaseFormat: metadata.format,
    databaseFormatVersion: metadata.formatVersion,
    driver: metadata.driver,
    databaseCreatedAt: metadata.createdAt,
    binding: { ...metadata.binding },
  };
}

function assertScopedSource(input: DataBackupCreateInput["source"]): void {
  const metadata = input.database.metadata();
  if (
    metadata.binding === null ||
    !bindingEquals(metadata.binding, input.scope.binding)
  ) {
    throw new DataBackupError(
      "ARTIFACT_SCOPE_CONFLICT",
      "Source database binding does not match the trusted source scope.",
    );
  }
}

function assertExpectedBinding(
  actual: StorageDatabaseBinding,
  expected: StorageDatabaseBinding | undefined,
): void {
  if (expected !== undefined && !bindingEquals(actual, expected)) {
    throw new DataBackupError(
      "ARTIFACT_SCOPE_CONFLICT",
      `Artifact belongs to ${actual.kind} workspace '${actual.workspaceId}', not ${expected.kind} workspace '${expected.workspaceId}'.`,
    );
  }
}

function assertSummaryEqual(
  actual: DataStateSummary,
  expected: DataStateSummary,
): void {
  if (canonicalResultJson(actual) !== canonicalResultJson(expected)) {
    throw new DataBackupError(
      "ARTIFACT_DIGEST_MISMATCH",
      "Artifact state summary does not match its verified canonical state.",
    );
  }
}

function cleanupSqlite(path: string): void {
  rmSync(path, { force: true });
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });
}

function prepareDestination(scope: DataDatabaseScope): string {
  const first = scope.databasePath();
  if (existsSync(first)) {
    throw new DataBackupError(
      "DESTINATION_ALREADY_EXISTS",
      "Canonical destination database already exists; restore/import never overwrites it.",
    );
  }

  mkdirSync(dirname(first), { recursive: true });
  const resolvedAgain = scope.databasePath();
  if (resolvedAgain !== first) {
    throw new DataBackupError(
      "DATABASE_UNAVAILABLE",
      "Destination scope changed while it was being prepared.",
    );
  }
  if (existsSync(resolvedAgain)) {
    throw new DataBackupError(
      "DESTINATION_ALREADY_EXISTS",
      "Canonical destination appeared while restore/import was being prepared.",
    );
  }
  return resolvedAgain;
}

async function sealAndInstall(
  driver: DataStorageDriver,
  stagingDatabase: DataStorageDatabase,
  stagingPath: string,
  destinationPath: string,
  binding: StorageDatabaseBinding,
  expectedSummary: DataStateSummary,
): Promise<void> {
  const sealedPath = join(
    dirname(destinationPath),
    `.${basename(destinationPath)}.sealed-${randomUUID()}.sqlite`,
  );

  try {
    await stagingDatabase.backupTo(sealedPath);
  } finally {
    stagingDatabase.close();
    cleanupSqlite(stagingPath);
  }

  try {
    linkSync(sealedPath, destinationPath);
  } catch (error) {
    cleanupSqlite(sealedPath);
    if (existsSync(destinationPath)) {
      throw new DataBackupError(
        "DESTINATION_ALREADY_EXISTS",
        "Canonical destination appeared before atomic installation.",
        undefined,
        error,
      );
    }
    throw new DataBackupError(
      "DATABASE_UNAVAILABLE",
      "Verified database could not be atomically installed.",
      undefined,
      error,
    );
  }
  unlinkSync(sealedPath);

  let installed: DataStorageDatabase | undefined;
  try {
    installed = driver.open({
      location: destinationPath,
      mode: "open-existing",
      expectedBinding: binding,
    });
    const state = collectPortableState(installed);
    assertSummaryEqual(summarizePortableState(state), expectedSummary);
  } catch (error) {
    if (installed !== undefined) {
      try {
        installed.close();
      } catch {
        // Continue cleanup of the newly created canonical destination.
      }
    }
    cleanupSqlite(destinationPath);
    if (isDataBackupError(error)) throw error;
    throw new DataBackupError(
      "DATABASE_CORRUPT",
      "Installed database failed post-install verification.",
      undefined,
      error,
    );
  }
  installed.close();
}

export class DataBackup implements DataBackupApi {
  constructor(private readonly driver: DataStorageDriver) {}

  async createBackup(
    input: DataBackupCreateInput,
  ): Promise<DataArtifactResult> {
    assertScopedSource(input.source);
    if (input.source.database.driverKind !== this.driver.kind) {
      throw new DataBackupError(
        "DATABASE_UNAVAILABLE",
        "Backup driver does not match the open source database.",
      );
    }

    const artifactDirectory = createArtifactDirectory(
      input.destinationDirectory,
    );
    const payloadPath = join(artifactDirectory, BACKUP_PAYLOAD_FILE);

    try {
      await input.source.database.backupTo(payloadPath);
      const inspected = await this.inspectSqlitePayload(
        payloadPath,
        input.source.scope.binding,
      );
      const payload = await fileDigest(payloadPath);
      const createdAt = new Date().toISOString();
      const manifest: DataArtifactManifest = {
        format: AI_VERSE_DATA_ARTIFACT_MANIFEST_FORMAT,
        formatVersion: AI_VERSE_DATA_ARTIFACT_FORMAT_VERSION,
        kind: "sqlite-backup",
        artifactId: artifactId(),
        createdAt,
        source: sourceMetadata(inspected.metadata),
        payload: {
          file: BACKUP_PAYLOAD_FILE,
          mediaType: "application/vnd.sqlite3",
          bytes: payload.bytes,
          sha256: payload.sha256,
        },
        state: inspected.summary,
      };
      const manifestRaw = writeJsonExclusive(
        join(artifactDirectory, MANIFEST_FILE),
        manifest,
      );
      const receipt: DataArtifactReceipt = {
        format: AI_VERSE_DATA_ARTIFACT_RECEIPT_FORMAT,
        formatVersion: AI_VERSE_DATA_ARTIFACT_FORMAT_VERSION,
        kind: "sqlite-backup",
        receiptId: artifactReceiptId(),
        artifactId: manifest.artifactId,
        completedAt: new Date().toISOString(),
        manifestSha256: sha256Utf8(manifestRaw),
        payloadSha256: payload.sha256,
        stateDigest: manifest.state.stateDigest,
        sourceBinding: { ...manifest.source.binding },
      };
      writeJsonExclusive(join(artifactDirectory, RECEIPT_FILE), receipt);
      return await this.verifyBackup({
        artifactDirectory,
        expectedBinding: input.source.scope.binding,
      });
    } catch (error) {
      rmSync(artifactDirectory, { recursive: true, force: true });
      if (isDataBackupError(error)) throw error;
      throw new DataBackupError(
        "DATABASE_UNAVAILABLE",
        "Backup artifact could not be created safely.",
        undefined,
        error,
      );
    }
  }

  async verifyBackup(
    input: DataArtifactVerifyInput,
  ): Promise<DataArtifactResult> {
    const artifact = await this.readArtifact(input, "sqlite-backup");
    const inspected = await this.inspectSqlitePayload(
      artifact.payloadPath,
      artifact.manifest.source.binding,
    );

    if (
      canonicalResultJson(sourceMetadata(inspected.metadata)) !==
      canonicalResultJson(artifact.manifest.source)
    ) {
      throw new DataBackupError(
        "ARTIFACT_DIGEST_MISMATCH",
        "Backup database identity does not match its manifest source metadata.",
      );
    }
    assertSummaryEqual(inspected.summary, artifact.manifest.state);

    return {
      manifest: artifact.manifest,
      receipt: artifact.receipt,
    };
  }

  async restoreBackup(
    input: DataBackupRestoreInput,
  ): Promise<DataTransferReceipt> {
    const verified = await this.verifyBackup({
      artifactDirectory: input.artifactDirectory,
      expectedBinding: input.destination.binding,
    });
    const artifactDirectory = assertArtifactDirectory(input.artifactDirectory);
    const payloadPath = join(artifactDirectory, BACKUP_PAYLOAD_FILE);
    const destinationPath = prepareDestination(input.destination);
    const stagingPath = join(
      dirname(destinationPath),
      `.${basename(destinationPath)}.restore-${randomUUID()}.sqlite`,
    );

    copyFileSync(payloadPath, stagingPath, fsConstants.COPYFILE_EXCL);
    let staging: DataStorageDatabase | undefined;
    try {
      staging = this.driver.open({
        location: stagingPath,
        mode: "open-existing",
        expectedBinding: input.destination.binding,
      });
      const state = collectPortableState(staging);
      assertSummaryEqual(summarizePortableState(state), verified.manifest.state);
      await sealAndInstall(
        this.driver,
        staging,
        stagingPath,
        destinationPath,
        input.destination.binding,
        verified.manifest.state,
      );
      staging = undefined;
    } catch (error) {
      if (staging !== undefined) {
        try {
          staging.close();
        } catch {
          // Preserve the original restore failure.
        }
      }
      cleanupSqlite(stagingPath);
      if (isDataBackupError(error)) throw error;
      throw new DataBackupError(
        "DATABASE_UNAVAILABLE",
        "Verified backup could not be restored safely.",
        undefined,
        error,
      );
    }

    return {
      receiptId: transferReceiptId(),
      operation: "backup.restore",
      artifactId: verified.manifest.artifactId,
      completedAt: new Date().toISOString(),
      destinationBinding: { ...input.destination.binding },
      stateDigest: verified.manifest.state.stateDigest,
      verification: "verified",
    };
  }

  async createPortableExport(
    input: DataPortableExportInput,
  ): Promise<DataArtifactResult> {
    assertScopedSource(input.source);
    const state = collectPortableState(input.source.database);
    const summary = summarizePortableState(state);
    const metadata = input.source.database.metadata();
    const artifactDirectory = createArtifactDirectory(
      input.destinationDirectory,
    );
    const payloadPath = join(artifactDirectory, EXPORT_PAYLOAD_FILE);

    try {
      const payloadRaw = canonicalResultJson(state);
      writeFileSync(payloadPath, payloadRaw, {
        encoding: "utf8",
        flag: "wx",
      });
      const payload = await fileDigest(payloadPath);
      const manifest: DataArtifactManifest = {
        format: AI_VERSE_DATA_ARTIFACT_MANIFEST_FORMAT,
        formatVersion: AI_VERSE_DATA_ARTIFACT_FORMAT_VERSION,
        kind: "portable-export",
        artifactId: artifactId(),
        createdAt: new Date().toISOString(),
        source: sourceMetadata(metadata),
        payload: {
          file: EXPORT_PAYLOAD_FILE,
          mediaType: "application/json",
          bytes: payload.bytes,
          sha256: payload.sha256,
        },
        state: summary,
      };
      const manifestRaw = writeJsonExclusive(
        join(artifactDirectory, MANIFEST_FILE),
        manifest,
      );
      const receipt: DataArtifactReceipt = {
        format: AI_VERSE_DATA_ARTIFACT_RECEIPT_FORMAT,
        formatVersion: AI_VERSE_DATA_ARTIFACT_FORMAT_VERSION,
        kind: "portable-export",
        receiptId: artifactReceiptId(),
        artifactId: manifest.artifactId,
        completedAt: new Date().toISOString(),
        manifestSha256: sha256Utf8(manifestRaw),
        payloadSha256: payload.sha256,
        stateDigest: summary.stateDigest,
        sourceBinding: { ...manifest.source.binding },
      };
      writeJsonExclusive(join(artifactDirectory, RECEIPT_FILE), receipt);
      return await this.verifyPortableExport({
        artifactDirectory,
        expectedBinding: input.source.scope.binding,
      });
    } catch (error) {
      rmSync(artifactDirectory, { recursive: true, force: true });
      if (isDataBackupError(error)) throw error;
      throw new DataBackupError(
        "DATABASE_UNAVAILABLE",
        "Portable export artifact could not be created safely.",
        undefined,
        error,
      );
    }
  }

  async verifyPortableExport(
    input: DataArtifactVerifyInput,
  ): Promise<DataArtifactResult> {
    const artifact = await this.readArtifact(input, "portable-export");
    const raw = readFileSync(artifact.payloadPath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error) {
      throw new DataBackupError(
        "ARTIFACT_INVALID",
        "Portable export payload is not valid JSON.",
        undefined,
        error,
      );
    }
    const state = assertPortableStateShape(parsed);

    if (!bindingEquals(state.binding, artifact.manifest.source.binding)) {
      throw new DataBackupError(
        "ARTIFACT_SCOPE_CONFLICT",
        "Portable export state binding does not match its manifest.",
      );
    }
    if (portableStateDigest(state) !== artifact.manifest.state.stateDigest) {
      throw new DataBackupError(
        "ARTIFACT_DIGEST_MISMATCH",
        "Portable export state digest does not match its manifest.",
      );
    }
    assertSummaryEqual(summarizePortableState(state), artifact.manifest.state);
    await this.verifyPortableStateCanImport(state, artifact.manifest.state);

    return {
      manifest: artifact.manifest,
      receipt: artifact.receipt,
    };
  }

  async importPortableExport(
    input: DataPortableImportInput,
  ): Promise<DataTransferReceipt> {
    const verified = await this.verifyPortableExport({
      artifactDirectory: input.artifactDirectory,
      expectedBinding: input.destination.binding,
    });
    const artifactDirectory = assertArtifactDirectory(input.artifactDirectory);
    const raw = readFileSync(join(artifactDirectory, EXPORT_PAYLOAD_FILE), "utf8");
    const state = assertPortableStateShape(JSON.parse(raw) as unknown);
    const destinationPath = prepareDestination(input.destination);
    const stagingPath = join(
      dirname(destinationPath),
      `.${basename(destinationPath)}.import-${randomUUID()}.sqlite`,
    );

    let staging: DataStorageDatabase | undefined;
    try {
      staging = this.driver.open({
        location: stagingPath,
        expectedBinding: input.destination.binding,
      });
      materializePortableState(staging, state);
      assertSummaryEqual(
        summarizePortableState(collectPortableState(staging)),
        verified.manifest.state,
      );
      await sealAndInstall(
        this.driver,
        staging,
        stagingPath,
        destinationPath,
        input.destination.binding,
        verified.manifest.state,
      );
      staging = undefined;
    } catch (error) {
      if (staging !== undefined) {
        try {
          staging.close();
        } catch {
          // Preserve the original import failure.
        }
      }
      cleanupSqlite(stagingPath);
      if (isDataBackupError(error)) throw error;
      throw new DataBackupError(
        "ARTIFACT_INVALID",
        "Portable export could not be imported safely.",
        undefined,
        error,
      );
    }

    return {
      receiptId: transferReceiptId(),
      operation: "portable.import",
      artifactId: verified.manifest.artifactId,
      completedAt: new Date().toISOString(),
      destinationBinding: { ...input.destination.binding },
      stateDigest: verified.manifest.state.stateDigest,
      verification: "verified",
    };
  }

  private async readArtifact(
    input: DataArtifactVerifyInput,
    expectedKind: DataArtifactKind,
  ): Promise<ReadArtifact> {
    const artifactDirectory = assertArtifactDirectory(input.artifactDirectory);
    const manifestPath = join(artifactDirectory, MANIFEST_FILE);
    const receiptPath = join(artifactDirectory, RECEIPT_FILE);
    const manifestRaw = readMetadataFile(manifestPath, "Artifact manifest");
    const receiptRaw = readMetadataFile(receiptPath, "Artifact receipt");
    const manifest = validateManifest(manifestRaw, expectedKind);
    const receipt = validateReceipt(receiptRaw, expectedKind);
    const payloadPath = join(artifactDirectory, manifest.payload.file);
    assertRegularFile(payloadPath, "Artifact payload");

    assertExpectedBinding(manifest.source.binding, input.expectedBinding);

    if (
      receipt.artifactId !== manifest.artifactId ||
      receipt.manifestSha256 !== sha256Utf8(manifestRaw) ||
      receipt.payloadSha256 !== manifest.payload.sha256 ||
      receipt.stateDigest !== manifest.state.stateDigest ||
      !bindingEquals(receipt.sourceBinding, manifest.source.binding)
    ) {
      throw new DataBackupError(
        "ARTIFACT_DIGEST_MISMATCH",
        "Artifact receipt does not match its manifest.",
      );
    }

    const payload = await fileDigest(payloadPath);
    if (
      payload.bytes !== manifest.payload.bytes ||
      payload.sha256 !== manifest.payload.sha256
    ) {
      throw new DataBackupError(
        "ARTIFACT_DIGEST_MISMATCH",
        "Artifact payload does not match its manifest digest/size.",
      );
    }

    return { manifest, receipt, payloadPath };
  }

  private async inspectSqlitePayload(
    payloadPath: string,
    binding: StorageDatabaseBinding,
  ): Promise<{
    readonly metadata: StorageDatabaseMetadata;
    readonly summary: DataStateSummary;
  }> {
    const directory = mkdtempSync(join(tmpdir(), "ai-verse-data-backup-verify-"));
    const copyPath = join(directory, "verify.sqlite");
    copyFileSync(payloadPath, copyPath, fsConstants.COPYFILE_EXCL);

    let database: DataStorageDatabase | undefined;
    try {
      database = this.driver.open({
        location: copyPath,
        mode: "open-existing",
        expectedBinding: binding,
      });
      const metadata = database.metadata();
      const state = collectPortableState(database);
      return {
        metadata,
        summary: summarizePortableState(state),
      };
    } catch (error) {
      if (isDataBackupError(error)) throw error;
      throw new DataBackupError(
        "ARTIFACT_INVALID",
        "SQLite backup payload cannot be opened and verified.",
        undefined,
        error,
      );
    } finally {
      if (database !== undefined) {
        try {
          database.close();
        } catch {
          // Verification cleanup is best effort.
        }
      }
      rmSync(directory, { recursive: true, force: true });
    }
  }

  private async verifyPortableStateCanImport(
    state: DataPortableState,
    expectedSummary: DataStateSummary,
  ): Promise<void> {
    const directory = mkdtempSync(join(tmpdir(), "ai-verse-data-export-verify-"));
    const databasePath = join(directory, "verify.sqlite");
    let database: DataStorageDatabase | undefined;

    try {
      database = this.driver.open({
        location: databasePath,
        expectedBinding: state.binding,
      });
      materializePortableState(database, state);
      assertSummaryEqual(
        summarizePortableState(collectPortableState(database)),
        expectedSummary,
      );
    } catch (error) {
      if (isDataBackupError(error)) throw error;
      throw new DataBackupError(
        "ARTIFACT_INVALID",
        "Portable export failed semantic import verification.",
        undefined,
        error,
      );
    } finally {
      if (database !== undefined) {
        try {
          database.close();
        } catch {
          // Verification cleanup is best effort.
        }
      }
      rmSync(directory, { recursive: true, force: true });
    }
  }
}
