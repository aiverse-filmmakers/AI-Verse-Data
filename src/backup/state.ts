import { createHash } from "node:crypto";

import { DataCatalog } from "../catalog/index.js";
import {
  canonicalResultJson,
  idempotencyResultDigest,
} from "../idempotency/index.js";
import { validateDataSpaceDefinition } from "../protocol/index.js";
import {
  assertReceiptMatchesEvent,
  hydrateStoredEvent,
  hydrateStoredReceipt,
} from "../provenance/integrity.js";
import { hydrateStoredRecord } from "../records/hydration.js";
import { collectRecordRelations } from "../records/relations.js";
import type {
  DataStorageDatabase,
  StoredEntitySchemaVersion,
  StoredRecord,
  StoredRecordRelation,
} from "../storage/index.js";
import { DataBackupError } from "./errors.js";
import {
  AI_VERSE_DATA_PORTABLE_STATE_VERSION,
  type DataPortableProvenanceEntry,
  type DataPortableState,
  type DataStateSummary,
} from "./types.js";

const PAGE_SIZE = 500;

function corrupt(message: string, cause?: unknown): never {
  throw new DataBackupError("DATABASE_CORRUPT", message, undefined, cause);
}

export function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function portableStateDigest(state: DataPortableState): string {
  return sha256Utf8(canonicalResultJson(state));
}

function relationKey(relation: StoredRecordRelation): string {
  return [
    relation.sourceSpaceId,
    relation.sourceEntity,
    relation.sourceRecordId,
    relation.field,
    relation.targetSpaceId,
    relation.targetEntity,
    relation.targetRecordId,
  ].join("\u0000");
}

function schemaKey(schema: StoredEntitySchemaVersion): string {
  return [
    schema.spaceId,
    schema.entity,
    String(schema.schemaVersion).padStart(12, "0"),
  ].join("\u0000");
}

function recordKey(record: StoredRecord): string {
  return [record.spaceId, record.entity, record.createdAt, record.recordId].join(
    "\u0000",
  );
}

function assertSourceRelations(
  database: DataStorageDatabase,
  catalog: DataCatalog,
  record: StoredRecord,
  relations: readonly StoredRecordRelation[],
): void {
  if (record.deletedAt !== null) {
    if (relations.length !== 0) {
      corrupt("Deleted records must not retain outgoing relation-index rows.");
    }
    return;
  }

  const schema = catalog.getSchema(
    record.spaceId,
    record.entity,
    record.schemaVersion,
  );
  let data: unknown;
  try {
    data = JSON.parse(record.dataJson);
  } catch (error) {
    corrupt("Stored record JSON cannot be decoded while verifying relations.", error);
  }

  const expected = collectRecordRelations(
    database.relationStorage(),
    schema,
    record.recordId,
    data as Record<string, never>,
  );

  const left = [...relations].sort((a, b) =>
    relationKey(a).localeCompare(relationKey(b)),
  );
  const right = [...expected].sort((a, b) =>
    relationKey(a).localeCompare(relationKey(b)),
  );
  if (canonicalResultJson(left) !== canonicalResultJson(right)) {
    corrupt("Stored relation index does not match canonical record references.");
  }
}

function summarize(state: DataPortableState): DataStateSummary {
  const entities = new Set(
    state.schemas.map((schema) => `${schema.spaceId}\u0000${schema.entity}`),
  );
  return {
    stateDigest: portableStateDigest(state),
    spaceCount: state.spaces.length,
    entityCount: entities.size,
    schemaVersionCount: state.schemas.length,
    recordCount: state.records.length,
    activeRecordCount: state.records.filter((record) => record.deletedAt === null)
      .length,
    relationCount: state.relations.length,
    idempotencyCount: state.idempotency.length,
    eventCount: state.provenance.length,
    receiptCount: state.provenance.length,
  };
}

export function summarizePortableState(
  state: DataPortableState,
): DataStateSummary {
  return summarize(state);
}

export function collectPortableState(
  database: DataStorageDatabase,
): DataPortableState {
  const integrity = database.integrityCheck();
  if (!integrity.ok) {
    corrupt(
      `SQLite integrity check failed: ${integrity.messages.join("; ")}`,
    );
  }

  const metadata = database.metadata();
  if (metadata.binding === null) {
    corrupt("Portable state requires a database with a trusted scope binding.");
  }

  const catalogStore = database.catalogStorage();
  const recordStore = database.recordStorage();
  const relationStore = database.relationStorage();
  const idempotencyStore = database.idempotencyStorage();
  const provenanceStore = database.provenanceStorage();
  catalogStore.initialize();
  recordStore.initialize();
  relationStore.initialize();
  idempotencyStore.initialize();
  provenanceStore.initialize();

  const catalog = new DataCatalog(database);
  const spaces = [...catalogStore.listSpaces()];

  for (const space of spaces) {
    try {
      validateDataSpaceDefinition(
        {
          spaceId: space.spaceId,
          name: space.name,
          authority: space.authority as "local_canonical",
          ...(space.description === null
            ? {}
            : { description: space.description }),
        },
        "$storedSpace",
      );
    } catch (error) {
      corrupt("Stored Data Space metadata is invalid.", error);
    }
  }

  const schemas: StoredEntitySchemaVersion[] = [];
  const records: StoredRecord[] = [];
  const relations: StoredRecordRelation[] = [];

  for (const space of spaces) {
    const currentSchemas = catalogStore.listCurrentSchemas(space.spaceId);
    for (const current of currentSchemas) {
      const versions = catalogStore.listSchemaVersions(
        space.spaceId,
        current.entity,
      );
      if (
        versions.length !== current.schemaVersion ||
        versions.some((schema, index) => schema.schemaVersion !== index + 1)
      ) {
        corrupt("Stored schema history is not contiguous through the current version.");
      }

      for (const schema of versions) {
        catalog.getSchema(schema.spaceId, schema.entity, schema.schemaVersion);
        schemas.push(schema);
      }

      let offset = 0;
      for (;;) {
        const page = recordStore.listRecords(
          space.spaceId,
          current.entity,
          PAGE_SIZE,
          true,
          offset,
        );
        if (page.length === 0) break;

        for (const record of page) {
          const historical = catalog.getSchema(
            record.spaceId,
            record.entity,
            record.schemaVersion,
          );
          hydrateStoredRecord(record, historical);
          const sourceRelations = relationStore.listSourceRelations(
            record.spaceId,
            record.entity,
            record.recordId,
          );
          assertSourceRelations(database, catalog, record, sourceRelations);
          records.push(record);
          relations.push(...sourceRelations);
        }

        offset += page.length;
        if (page.length < PAGE_SIZE) break;
      }
    }
  }

  const idempotency = [];
  let afterKey: string | null = null;
  for (;;) {
    const page = idempotencyStore.list(afterKey, PAGE_SIZE);
    if (page.length === 0) break;
    for (const entry of page) {
      if (idempotencyResultDigest(entry.resultJson) !== entry.resultDigest) {
        corrupt(
          `Idempotency result digest mismatch for key '${entry.idempotencyKey}'.`,
        );
      }
      try {
        const parsed = JSON.parse(entry.resultJson) as unknown;
        if (canonicalResultJson(parsed) !== entry.resultJson) {
          corrupt(
            `Idempotency result is not canonical JSON for key '${entry.idempotencyKey}'.`,
          );
        }
      } catch (error) {
        if (error instanceof DataBackupError) throw error;
        corrupt(
          `Idempotency result JSON cannot be decoded for key '${entry.idempotencyKey}'.`,
          error,
        );
      }
      idempotency.push(entry);
    }
    afterKey = page.at(-1)!.idempotencyKey;
    if (page.length < PAGE_SIZE) break;
  }

  const provenance: DataPortableProvenanceEntry[] = [];
  let afterSequence = 0;
  for (;;) {
    const page = provenanceStore.listEvents({
      afterSequence,
      limit: PAGE_SIZE,
    });
    if (page.length === 0) break;

    for (const storedEvent of page) {
      const event = hydrateStoredEvent(storedEvent);
      const storedReceipt = provenanceStore.getReceiptByEventId(event.eventId);
      if (storedReceipt === null) {
        corrupt("Stored provenance event is missing its durable receipt.");
      }
      const receipt = hydrateStoredReceipt(storedReceipt);
      assertReceiptMatchesEvent(receipt, event);

      if (
        storedEvent.scopeKind !== metadata.binding.kind ||
        storedEvent.workspaceId !== metadata.binding.workspaceId ||
        storedReceipt.scopeKind !== metadata.binding.kind ||
        storedReceipt.workspaceId !== metadata.binding.workspaceId
      ) {
        corrupt("Stored provenance scope does not match the database binding.");
      }

      provenance.push({
        event: storedEvent,
        receipt: storedReceipt,
      });
    }

    afterSequence = page.at(-1)!.sequence;
    if (page.length < PAGE_SIZE) break;
  }

  const idempotencyKeys = new Set(
    idempotency.map((entry) => entry.idempotencyKey),
  );
  for (const entry of provenance) {
    if (!idempotencyKeys.has(entry.event.idempotencyKey)) {
      corrupt(
        `Provenance event '${entry.event.eventId}' has no matching idempotency state.`,
      );
    }
  }

  const state: DataPortableState = {
    version: AI_VERSE_DATA_PORTABLE_STATE_VERSION,
    binding: { ...metadata.binding },
    spaces: spaces.sort((a, b) => a.spaceId.localeCompare(b.spaceId)),
    schemas: schemas.sort((a, b) => schemaKey(a).localeCompare(schemaKey(b))),
    records: records.sort((a, b) => recordKey(a).localeCompare(recordKey(b))),
    relations: relations.sort((a, b) =>
      relationKey(a).localeCompare(relationKey(b)),
    ),
    idempotency,
    provenance,
  };

  summarize(state);
  return state;
}

export function assertPortableStateShape(value: unknown): DataPortableState {
  if (
    value === null ||
    Array.isArray(value) ||
    typeof value !== "object"
  ) {
    throw new DataBackupError(
      "ARTIFACT_INVALID",
      "Portable export payload must be a JSON object.",
    );
  }

  const state = value as Partial<DataPortableState>;
  if (
    state.version !== AI_VERSE_DATA_PORTABLE_STATE_VERSION ||
    state.binding === undefined ||
    !Array.isArray(state.spaces) ||
    !Array.isArray(state.schemas) ||
    !Array.isArray(state.records) ||
    !Array.isArray(state.relations) ||
    !Array.isArray(state.idempotency) ||
    !Array.isArray(state.provenance)
  ) {
    throw new DataBackupError(
      "ARTIFACT_INVALID",
      "Portable export payload has an invalid or unsupported state shape.",
    );
  }

  return state as DataPortableState;
}

export function materializePortableState(
  database: DataStorageDatabase,
  state: DataPortableState,
): void {
  const metadata = database.metadata();
  if (
    metadata.binding === null ||
    canonicalResultJson(metadata.binding) !== canonicalResultJson(state.binding)
  ) {
    throw new DataBackupError(
      "ARTIFACT_SCOPE_CONFLICT",
      "Portable export binding does not match the destination database binding.",
    );
  }

  const catalogStore = database.catalogStorage();
  const recordStore = database.recordStorage();
  const relationStore = database.relationStorage();
  const idempotencyStore = database.idempotencyStorage();
  const provenanceStore = database.provenanceStorage();
  catalogStore.initialize();
  recordStore.initialize();
  relationStore.initialize();
  idempotencyStore.initialize();
  provenanceStore.initialize();

  try {
    database.transaction(() => {
      for (const space of state.spaces) {
        if (!catalogStore.createSpace(space)) {
          throw new DataBackupError(
            "ARTIFACT_INVALID",
            `Portable Data Space '${space.spaceId}' is duplicated.`,
          );
        }
      }

      const grouped = new Map<string, StoredEntitySchemaVersion[]>();
      for (const schema of state.schemas) {
        const key = `${schema.spaceId}\u0000${schema.entity}`;
        const group = grouped.get(key);
        if (group === undefined) grouped.set(key, [schema]);
        else group.push(schema);
      }

      for (const versions of grouped.values()) {
        versions.sort((a, b) => a.schemaVersion - b.schemaVersion);
        const first = versions[0];
        if (first === undefined || first.schemaVersion !== 1) {
          throw new DataBackupError(
            "ARTIFACT_INVALID",
            "Portable schema history must begin at version 1.",
          );
        }
        const created = catalogStore.createSchema(first);
        if (created.status !== "created") {
          throw new DataBackupError(
            "ARTIFACT_INVALID",
            "Portable schema could not be created from its recorded history.",
          );
        }
        let expected = 1;
        for (const schema of versions.slice(1)) {
          if (schema.schemaVersion !== expected + 1) {
            throw new DataBackupError(
              "ARTIFACT_INVALID",
              "Portable schema history must be contiguous.",
            );
          }
          const updated = catalogStore.updateSchema(expected, schema);
          if (updated.status !== "updated") {
            throw new DataBackupError(
              "ARTIFACT_INVALID",
              "Portable schema history could not be applied exactly.",
            );
          }
          expected = schema.schemaVersion;
        }
      }

      for (const record of state.records) {
        if (!recordStore.createRecord(record)) {
          throw new DataBackupError(
            "ARTIFACT_INVALID",
            `Portable record '${record.recordId}' is duplicated.`,
          );
        }
      }

      const relationsBySource = new Map<string, StoredRecordRelation[]>();
      for (const relation of state.relations) {
        const key = [
          relation.sourceSpaceId,
          relation.sourceEntity,
          relation.sourceRecordId,
        ].join("\u0000");
        const group = relationsBySource.get(key);
        if (group === undefined) relationsBySource.set(key, [relation]);
        else group.push(relation);
      }
      for (const group of relationsBySource.values()) {
        const first = group[0]!;
        relationStore.replaceSourceRelations(
          first.sourceSpaceId,
          first.sourceEntity,
          first.sourceRecordId,
          group,
        );
      }

      for (const entry of state.idempotency) {
        if (!idempotencyStore.create(entry)) {
          throw new DataBackupError(
            "ARTIFACT_INVALID",
            `Portable idempotency key '${entry.idempotencyKey}' is duplicated.`,
          );
        }
      }

      const orderedProvenance = [...state.provenance].sort(
        (a, b) => a.event.sequence - b.event.sequence,
      );
      for (const pair of orderedProvenance) {
        const { sequence, ...event } = pair.event;
        const appended = provenanceStore.append(event, pair.receipt);
        if (appended.sequence !== sequence) {
          throw new DataBackupError(
            "ARTIFACT_INVALID",
            "Portable provenance sequence cannot be recreated exactly.",
          );
        }
      }
    }, "immediate");
  } catch (error) {
    if (error instanceof DataBackupError) throw error;
    throw new DataBackupError(
      "ARTIFACT_INVALID",
      "Portable export state could not be materialized safely.",
      undefined,
      error,
    );
  }

  const imported = collectPortableState(database);
  if (portableStateDigest(imported) !== portableStateDigest(state)) {
    throw new DataBackupError(
      "ARTIFACT_DIGEST_MISMATCH",
      "Imported portable state does not match the exported state digest.",
    );
  }
}
