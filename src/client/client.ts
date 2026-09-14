import { DataBackup } from "../backup/index.js";
import { DataBulk } from "../bulk/index.js";
import { DataCatalog, DataCatalogError } from "../catalog/index.js";
import { DataIdempotency, canonicalResultJson } from "../idempotency/index.js";
import type {
  ACTOR_KINDS,
  AUTHORIZATION_MODES,
  DATA_PROTOCOL_VERSION,
} from "../protocol/index.js";
import { DATA_PROTOCOL_LIMITS } from "../protocol/index.js";
import type {
  BulkMutationOperation,
  DataActor,
  DataAuthorization,
  DataOperation,
  DataScope,
  EntitySchemaDefinition,
  EventsListPayload,
  JsonObject,
  QueryPayload,
  RecordDeletePayload,
  RecordGetPayload,
  RecordListPayload,
  RecordUpdatePayload,
  SchemaGetPayload,
  SchemaListPayload,
  SchemaMigrationExecutePayload,
  SchemaMigrationPreviewPayload,
  SchemaUpdatePayload,
  SpaceGetPayload,
  TransactionExecutePayload,
} from "../protocol/index.js";
import { DataProvenance } from "../provenance/index.js";
import { DataProvenanceWriter } from "../provenance/writer.js";
import { createRequestId, createTransactionId } from "../provenance/identifiers.js";
import { DataQuery } from "../query/index.js";
import { DataRecords } from "../records/index.js";
import { DataSchemaMigrations } from "../schema-migrations/index.js";
import type {
  DataDatabaseScope,
  ScopedDatabaseHandle,
} from "../scope/index.js";
import { openScopedDataDatabase } from "../scope/index.js";
import type { DataStorageDatabase } from "../storage/index.js";
import { SqliteStorageDriver } from "../storage/index.js";
import { DataTransactions } from "../transactions/index.js";
import { DataClientError } from "./errors.js";
import type {
  BulkExecuteParams,
  CreateDataClientOptions,
  DataClient,
  DataClientRecordCreateInput,
  DataClientStorageFacts,
  DataStructureEnsureInput,
  DataStructureEnsureResult,
  DataSuccessResult,
} from "./types.js";

type ActorKind = (typeof ACTOR_KINDS)[number];
type AuthorizationMode = (typeof AUTHORIZATION_MODES)[number];

const ACTOR_KIND_SET: ReadonlySet<string> = new Set<string>([
  "human",
  "bot",
  "worker",
  "app",
  "automation",
  "system",
  "import",
  "connection",
]);

const AUTHORIZATION_MODE_SET: ReadonlySet<string> = new Set<string>([
  "host-bound",
  "local-operator",
]);

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SLUG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const FIELD_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const OPAQUE_ID_RE: Record<string, RegExp> = {
  req: /^req_[A-Za-z0-9][A-Za-z0-9_-]*$/,
  txn: /^txn_[A-Za-z0-9][A-Za-z0-9_-]*$/,
};

function failInvalid(message: string, cause?: unknown): never {
  throw new DataClientError("CLIENT_INVALID", message, undefined, cause);
}

function validateActor(actor: DataActor): {
  readonly kind: ActorKind;
  readonly id: string;
} {
  if (typeof actor !== "object" || actor === null) {
    failInvalid("Client actor must be an object with kind and id.");
  }
  const candidate = actor as { kind?: unknown; id?: unknown };
  if (
    typeof candidate.kind !== "string" ||
    !ACTOR_KIND_SET.has(candidate.kind)
  ) {
    failInvalid(
      "Client actor.kind must be one of human, bot, worker, app, automation, system, import, connection. Model-proposed values never grant authority by themselves.",
    );
  }
  if (
    typeof candidate.id !== "string" ||
    candidate.id.length < 1 ||
    candidate.id.length > DATA_PROTOCOL_LIMITS.maxIdLength ||
    candidate.id === "." ||
    candidate.id === ".." ||
    !SAFE_ID_RE.test(candidate.id)
  ) {
    failInvalid("Client actor.id must be a safe identifier.");
  }
  return {
    kind: candidate.kind as ActorKind,
    id: candidate.id as string,
  };
}

function validateAuthorization(authorization: DataAuthorization): {
  readonly mode: AuthorizationMode;
  readonly capabilityRefs?: readonly string[];
} {
  if (typeof authorization !== "object" || authorization === null) {
    failInvalid(
      "Client authorization must be an object with a host-bound or local-operator mode.",
    );
  }
  const candidate = authorization as {
    mode?: unknown;
    capabilityRefs?: unknown;
  };
  if (
    typeof candidate.mode !== "string" ||
    !AUTHORIZATION_MODE_SET.has(candidate.mode)
  ) {
    throw new DataClientError(
      "AUTHORIZATION_INVALID",
      "Client authorization.mode must be host-bound or local-operator. Model-supplied capability claims never grant authority.",
    );
  }
  if (candidate.capabilityRefs !== undefined) {
    if (
      !Array.isArray(candidate.capabilityRefs) ||
      candidate.capabilityRefs.length >
        DATA_PROTOCOL_LIMITS.maxAuthorizationCapabilityRefs
    ) {
      throw new DataClientError(
        "AUTHORIZATION_INVALID",
        `Client authorization.capabilityRefs must be an array of at most ${DATA_PROTOCOL_LIMITS.maxAuthorizationCapabilityRefs} references.`,
      );
    }
    for (const ref of candidate.capabilityRefs) {
      if (
        typeof ref !== "string" ||
        ref.length < 1 ||
        ref.length > DATA_PROTOCOL_LIMITS.maxIdLength ||
        ref === "." ||
        ref === ".." ||
        !SAFE_ID_RE.test(ref)
      ) {
        throw new DataClientError(
          "AUTHORIZATION_INVALID",
          "Client authorization capability references must be safe identifiers.",
        );
      }
    }
  }
  return {
    mode: candidate.mode as AuthorizationMode,
    ...(candidate.capabilityRefs === undefined
      ? {}
      : {
          capabilityRefs: [...(candidate.capabilityRefs as string[])],
        }),
  };
}

function validateScope(scope: DataDatabaseScope): DataScope {
  if (
    typeof scope !== "object" ||
    scope === null ||
    typeof (scope as { workspaceId?: unknown }).workspaceId !== "string"
  ) {
    throw new DataClientError(
      "SCOPE_INVALID",
      "Client scope must be a trusted DataDatabaseScope with a workspace identity.",
    );
  }
  return { workspaceId: scope.workspaceId };
}

function validateRequestId(value: string | undefined): string {
  if (value === undefined) return createRequestId();
  if (
    typeof value !== "string" ||
    value.length < 5 ||
    value.length > DATA_PROTOCOL_LIMITS.maxIdLength ||
    !OPAQUE_ID_RE["req"]!.test(value)
  ) {
    failInvalid("Client requestId must match req_<opaque>.");
  }
  return value;
}

function validateIdempotencyKey(value: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > DATA_PROTOCOL_LIMITS.maxIdempotencyKeyLength ||
    value.includes("\u0000")
  ) {
    failInvalid(
      `Idempotency key must contain 1..${DATA_PROTOCOL_LIMITS.maxIdempotencyKeyLength} characters and no NUL.`,
    );
  }
  return value;
}

function validatePreviewDigest(value: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    failInvalid("Preview digest must be a lowercase SHA-256 hex string.");
  }
  return value;
}

function validateSlug(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 64 ||
    !SLUG_RE.test(value)
  ) {
    failInvalid(`${field} must be a lowercase Data identifier slug.`);
  }
  return value;
}

function validateSpaceDefinition(input: {
  readonly spaceId: string;
  readonly name: string;
  readonly authority: "local_canonical";
  readonly description?: string;
}): {
  readonly spaceId: string;
  readonly name: string;
  readonly authority: "local_canonical";
  readonly description?: string;
} {
  validateSlug(input.spaceId, "spaceId");
  if (
    typeof input.name !== "string" ||
    input.name.length < 1 ||
    input.name.length > DATA_PROTOCOL_LIMITS.maxDescriptionLength
  ) {
    failInvalid("Space name must be a non-empty string.");
  }
  if (input.authority !== "local_canonical") {
    failInvalid('Space authority must be "local_canonical".');
  }
  if (
    input.description !== undefined &&
    (typeof input.description !== "string" ||
      input.description.length > DATA_PROTOCOL_LIMITS.maxDescriptionLength)
  ) {
    failInvalid("Space description is too long.");
  }
  return {
    spaceId: input.spaceId,
    name: input.name,
    authority: "local_canonical",
    ...(input.description === undefined
      ? {}
      : { description: input.description }),
  };
}

function validateSchemaDefinition(definition: EntitySchemaDefinition): void {
  if (
    typeof definition !== "object" ||
    definition === null ||
    typeof (definition as { spaceId?: unknown }).spaceId !== "string" ||
    typeof (definition as { entity?: unknown }).entity !== "string" ||
    typeof (definition as { name?: unknown }).name !== "string" ||
    typeof (definition as { fields?: unknown }).fields !== "object" ||
    (definition as { fields?: unknown }).fields === null
  ) {
    failInvalid("Schema definition must carry spaceId, entity, name, fields.");
  }
  validateSlug(
    (definition as { spaceId: string }).spaceId,
    "schema spaceId",
  );
  validateSlug((definition as { entity: string }).entity, "schema entity");
  const fields = (definition as { fields: Record<string, unknown> }).fields;
  const names = Object.keys(fields);
  if (
    names.length < 1 ||
    names.length > DATA_PROTOCOL_LIMITS.maxSchemaFields
  ) {
    failInvalid(
      `Schema must define 1..${DATA_PROTOCOL_LIMITS.maxSchemaFields} fields.`,
    );
  }
  for (const name of names) {
    if (
      name.length < 1 ||
      name.length > DATA_PROTOCOL_LIMITS.maxFieldNameLength ||
      !FIELD_NAME_RE.test(name)
    ) {
      failInvalid(`Schema field name '${name}' is invalid.`);
    }
  }
}

function validateRecordData(data: JsonObject): void {
  let bytes = 0;
  try {
    bytes = Buffer.byteLength(JSON.stringify(data), "utf8");
  } catch {
    failInvalid("Record data must be JSON-serializable.");
  }
  if (bytes > DATA_PROTOCOL_LIMITS.maxRecordBytes) {
    failInvalid(
      `Record data exceeds ${DATA_PROTOCOL_LIMITS.maxRecordBytes} bytes.`,
    );
  }
}

function validateRecordCreate(input: DataClientRecordCreateInput): void {
  validateSlug(input.spaceId, "record spaceId");
  validateSlug(input.entity, "record entity");
  validateIdempotencyKey(input.idempotencyKey);
  validateRecordData(input.data);
  if (input.clientRef !== undefined) validateSlug(input.clientRef, "clientRef");
}

function validateOperations(
  operations: readonly BulkMutationOperation[],
  maxOperations: number,
  label: string,
): void {
  if (!Array.isArray(operations)) {
    failInvalid(`${label} operations must be an array.`);
  }
  if (operations.length < 1 || operations.length > maxOperations) {
    failInvalid(`${label} must contain 1..${maxOperations} operations.`);
  }
}

function validateBulkBytes(operations: readonly BulkMutationOperation[]): void {
  let bytes = 0;
  try {
    bytes = Buffer.byteLength(JSON.stringify(operations), "utf8");
  } catch {
    failInvalid("Bulk operations must be JSON-serializable.");
  }
  if (bytes > DATA_PROTOCOL_LIMITS.maxBulkBytes) {
    failInvalid(
      `Bulk request exceeds ${DATA_PROTOCOL_LIMITS.maxBulkBytes} bytes.`,
    );
  }
}

function validateDestinationDirectory(value: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 4096 ||
    value.includes("\u0000")
  ) {
    failInvalid("Artifact directory must be a non-empty path without NUL.");
  }
  return value;
}

interface ClientState {
  database: DataStorageDatabase;
  handle: ScopedDatabaseHandle;
  ownsHandle: boolean;
  closed: boolean;
  scope: DataDatabaseScope;
  actor: { readonly kind: string; readonly id: string };
  authorization: {
    readonly mode: string;
    readonly capabilityRefs?: readonly string[];
  };
  protocolScope: DataScope;
  catalog: DataCatalog;
  records: DataRecords;
  query: DataQuery;
  transactions: DataTransactions;
  bulk: DataBulk;
  provenance: DataProvenance;
  provenanceWriter: DataProvenanceWriter;
  idempotency: DataIdempotency;
  migrations: DataSchemaMigrations;
  backup: DataBackup;
  databasePath: string;
}

function success<T>(
  state: ClientState,
  operation: DataOperation,
  result: T,
  requestId?: string,
): DataSuccessResult<T> {
  return {
    protocol: "ai-verse-data/0.1" as (typeof DATA_PROTOCOL_VERSION)["length"] extends never
      ? never
      : "ai-verse-data/0.1",
    requestId: validateRequestId(requestId),
    operation,
    scope: { ...state.protocolScope },
    actor: { ...state.actor } as DataActor,
    authorization: { ...state.authorization } as DataAuthorization,
    ok: true,
    result,
    warnings: [],
  };
}

function assertOpen(state: ClientState): void {
  if (state.closed) {
    throw new DataClientError(
      "CLIENT_CLOSED",
      "Data client is closed and cannot serve further operations.",
    );
  }
}

function validateStructureEnsureInput(input: DataStructureEnsureInput): {
  readonly idempotencyKey: string;
  readonly space: ReturnType<typeof validateSpaceDefinition>;
  readonly schema: EntitySchemaDefinition;
  readonly reason?: string;
} {
  if (typeof input !== "object" || input === null) {
    failInvalid("Structure ensure input must be an object.");
  }
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const space = validateSpaceDefinition(input.space);
  validateSchemaDefinition(input.schema);
  if (input.schema.spaceId !== space.spaceId) {
    failInvalid("Structure ensure schema.spaceId must match the requested Data Space.");
  }
  if (
    input.reason !== undefined &&
    (typeof input.reason !== "string" ||
      input.reason.length < 1 ||
      input.reason.length > DATA_PROTOCOL_LIMITS.maxDescriptionLength)
  ) {
    failInvalid("Structure ensure reason must be a non-empty bounded string.");
  }
  return {
    idempotencyKey,
    space,
    schema: input.schema,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalResultJson(left) === canonicalResultJson(right);
}

function ensureStructure(
  state: ClientState,
  actor: DataActor,
  input: DataStructureEnsureInput,
): { readonly result: DataStructureEnsureResult; readonly requestId: string } {
  const valid = validateStructureEnsureInput(input);
  let requestId = createRequestId();

  const result = state.database.transaction(() => {
    const idempotencyRequest = {
      kind: "structure_ensure",
      requestedOperation: "data.structure.ensure",
      space: valid.space,
      schema: valid.schema,
      ...(valid.reason === undefined ? {} : { reason: valid.reason }),
    };
    const prepared = state.idempotency.prepare<DataStructureEnsureResult>(
      valid.idempotencyKey,
      "data.transaction.execute",
      actor,
      idempotencyRequest,
    );
    if (prepared.kind === "replay") {
      return prepared.value;
    }

    let spaceState: "created" | "existing" = "existing";
    let space;
    try {
      space = state.catalog.getSpace(valid.space.spaceId);
    } catch (error) {
      if (!(error instanceof DataCatalogError) || error.code !== "DATA_SPACE_NOT_FOUND") {
        throw error;
      }
      space = state.catalog.createSpace(valid.space);
      spaceState = "created";
    }

    if (space.authority !== valid.space.authority) {
      throw new DataCatalogError(
        "SCHEMA_MIGRATION_REQUIRED",
        `Data Space '${valid.space.spaceId}' exists with different authority and cannot be changed by automatic ensure.`,
      );
    }

    let schemaState: "created" | "evolved" | "existing" = "existing";
    let schema;
    let addedFields: string[] = [];
    try {
      schema = state.catalog.getSchema(valid.schema.spaceId, valid.schema.entity);
    } catch (error) {
      if (!(error instanceof DataCatalogError) || error.code !== "ENTITY_NOT_FOUND") {
        throw error;
      }
      schema = state.catalog.createSchema(valid.schema);
      schemaState = "created";
    }

    if (schemaState !== "created") {
      const currentAllowUnknown = schema.allowUnknownFields ?? false;
      const requestedAllowUnknown = valid.schema.allowUnknownFields ?? false;
      if (currentAllowUnknown !== requestedAllowUnknown) {
        throw new DataCatalogError(
          "SCHEMA_MIGRATION_REQUIRED",
          "Automatic structure ensure cannot change allowUnknownFields semantics.",
          { spaceId: valid.schema.spaceId, entity: valid.schema.entity },
        );
      }

      const changes = [];
      for (const [field, definition] of Object.entries(valid.schema.fields)) {
        const current = schema.fields[field];
        if (current === undefined) {
          addedFields.push(field);
          changes.push({ op: "add_field" as const, field, definition });
          continue;
        }
        if (!sameJson(current, definition)) {
          throw new DataCatalogError(
            "SCHEMA_MIGRATION_REQUIRED",
            `Existing field '${field}' differs from the requested definition; automatic structure ensure never replaces or narrows existing fields.`,
            { spaceId: valid.schema.spaceId, entity: valid.schema.entity, field },
          );
        }
      }

      if (changes.length > 0) {
        schema = state.catalog.updateSchema({
          spaceId: valid.schema.spaceId,
          entity: valid.schema.entity,
          expectedSchemaVersion: schema.schemaVersion,
          changes,
        });
        schemaState = "evolved";
      }
    }

    const changed = spaceState === "created" || schemaState !== "existing";
    const structureState: DataStructureEnsureResult["state"] =
      schemaState === "evolved"
        ? "evolved"
        : changed
          ? "created"
          : "existing";
    const ensured: DataStructureEnsureResult = {
      state: structureState,
      changed,
      spaceState,
      schemaState,
      addedFields,
      space,
      schema,
    };

    const transactionId = createTransactionId();
    const committedAt = new Date().toISOString();
    state.provenanceWriter.transactionCommitted({
      requestId,
      transactionId,
      idempotencyKey: valid.idempotencyKey,
      actor,
      committedAt,
      childEventIds: [],
      childReceiptIds: [],
      operationCount:
        (spaceState === "created" ? 1 : 0) +
        (schemaState === "created" || schemaState === "evolved" ? 1 : 0),
      details: {
        kind: "structure_ensure",
        requestedOperation: "data.structure.ensure",
        spaceId: valid.schema.spaceId,
        entity: valid.schema.entity,
        structureState,
        spaceState,
        schemaState,
        addedFields,
        ...(valid.reason === undefined ? {} : { reason: valid.reason }),
      },
    });

    return state.idempotency.complete(
      valid.idempotencyKey,
      "data.transaction.execute",
      prepared.requestFingerprint,
      ensured,
    );
  }, "immediate");

  const receipt = state.provenance.getReceiptByIdempotencyKey({
    idempotencyKey: valid.idempotencyKey,
  });
  requestId = receipt.requestId;
  return { result, requestId };
}

export function createDataClient(options: CreateDataClientOptions): DataClient {
  const actor = validateActor(options.actor);
  const authorization = validateAuthorization(options.authorization);
  if (
    typeof options !== "object" ||
    options === null ||
    typeof options.scope !== "object" ||
    options.scope === null
  ) {
    throw new DataClientError(
      "SCOPE_INVALID",
      "createDataClient requires a trusted scope from TrustedDataRoot plus a workspace ID. Raw SQLite paths and raw SQL are never accepted.",
    );
  }
  const scope = options.scope;
  const protocolScope = validateScope(scope);

  const driver = new SqliteStorageDriver();
  const handle = openScopedDataDatabase(driver, scope);
  const database = handle.database;
  const databasePath = scope.databasePath();

  const state: ClientState = {
    database,
    handle,
    ownsHandle: true,
    closed: false,
    scope,
    actor,
    authorization,
    protocolScope,
    catalog: new DataCatalog(database),
    records: new DataRecords(database),
    query: new DataQuery(database),
    transactions: new DataTransactions(database),
    bulk: new DataBulk(database),
    provenance: new DataProvenance(database),
    provenanceWriter: new DataProvenanceWriter(database),
    idempotency: new DataIdempotency(database),
    migrations: new DataSchemaMigrations(database),
    backup: new DataBackup(driver),
    databasePath,
  };

  const client: DataClient = {
    scope,
    actor: actor as DataActor,
    authorization: authorization as DataAuthorization,
    get closed(): boolean {
      return state.closed;
    },
    spaces: {
      create(definition) {
        assertOpen(state);
        const valid = validateSpaceDefinition(definition);
        return success(
          state,
          "data.space.create",
          state.catalog.createSpace(valid),
        );
      },
      list() {
        assertOpen(state);
        return success(state, "data.space.list", state.catalog.listSpaces());
      },
      get(input: SpaceGetPayload) {
        assertOpen(state);
        validateSlug(input.spaceId, "spaceId");
        return success(
          state,
          "data.space.get",
          state.catalog.getSpace(input.spaceId),
        );
      },
    },
    schemas: {
      ensure(input: DataStructureEnsureInput) {
        assertOpen(state);
        const ensured = ensureStructure(state, actor as DataActor, input);
        const receipt = state.provenance.getReceiptByIdempotencyKey({
          idempotencyKey: input.idempotencyKey,
        });
        return success(
          state,
          "data.transaction.execute",
          { result: ensured.result, receipt },
          ensured.requestId,
        );
      },
      create(definition: EntitySchemaDefinition) {
        assertOpen(state);
        validateSchemaDefinition(definition);
        return success(
          state,
          "data.schema.create",
          state.catalog.createSchema(definition),
        );
      },
      list(input: SchemaListPayload) {
        assertOpen(state);
        validateSlug(input.spaceId, "spaceId");
        return success(
          state,
          "data.schema.list",
          state.catalog.listSchemas(input.spaceId),
        );
      },
      get(input: SchemaGetPayload) {
        assertOpen(state);
        validateSlug(input.spaceId, "spaceId");
        validateSlug(input.entity, "entity");
        return success(
          state,
          "data.schema.get",
          state.catalog.getSchema(
            input.spaceId,
            input.entity,
            input.version ?? "current",
          ),
        );
      },
      update(input: SchemaUpdatePayload) {
        assertOpen(state);
        return success(
          state,
          "data.schema.update",
          state.catalog.updateSchema(input),
        );
      },
      previewMigration(input: SchemaMigrationPreviewPayload) {
        assertOpen(state);
        return success(
          state,
          "data.schema.migration.preview",
          state.migrations.preview({ actor, payload: input }),
        );
      },
      executeMigration(input: SchemaMigrationExecutePayload) {
        assertOpen(state);
        validateIdempotencyKey(input.idempotencyKey);
        validatePreviewDigest(input.expectedPreviewDigest);
        return success(
          state,
          "data.schema.migration.execute",
          state.migrations.execute({ actor, payload: input }),
        );
      },
      executeMigrationWithReceipt(input: SchemaMigrationExecutePayload) {
        assertOpen(state);
        validateIdempotencyKey(input.idempotencyKey);
        validatePreviewDigest(input.expectedPreviewDigest);
        return success(
          state,
          "data.schema.migration.execute",
          state.migrations.executeWithReceipt({ actor, payload: input }),
        );
      },
    },
    records: {
      create(input: DataClientRecordCreateInput) {
        assertOpen(state);
        validateRecordCreate(input);
        return success(
          state,
          "data.record.create",
          state.records.create({
            spaceId: input.spaceId,
            entity: input.entity,
            idempotencyKey: input.idempotencyKey,
            data: input.data,
            actor,
            ...(input.clientRef === undefined
              ? {}
              : { clientRef: input.clientRef }),
          }),
        );
      },
      createWithReceipt(input: DataClientRecordCreateInput) {
        assertOpen(state);
        validateRecordCreate(input);
        return success(
          state,
          "data.record.create",
          state.records.createWithReceipt({
            spaceId: input.spaceId,
            entity: input.entity,
            idempotencyKey: input.idempotencyKey,
            data: input.data,
            actor,
            ...(input.clientRef === undefined
              ? {}
              : { clientRef: input.clientRef }),
          }),
        );
      },
      get(input: RecordGetPayload) {
        assertOpen(state);
        return success(state, "data.record.get", state.records.get(input));
      },
      list(input: RecordListPayload) {
        assertOpen(state);
        return success(state, "data.record.list", state.records.list(input));
      },
      update(input: RecordUpdatePayload) {
        assertOpen(state);
        validateIdempotencyKey(input.idempotencyKey);
        return success(
          state,
          "data.record.update",
          state.records.update({ ...input, actor }),
        );
      },
      updateWithReceipt(input: RecordUpdatePayload) {
        assertOpen(state);
        validateIdempotencyKey(input.idempotencyKey);
        return success(
          state,
          "data.record.update",
          state.records.updateWithReceipt({ ...input, actor }),
        );
      },
      remove(input: RecordDeletePayload) {
        assertOpen(state);
        validateIdempotencyKey(input.idempotencyKey);
        return success(
          state,
          "data.record.delete",
          state.records.softDelete({ ...input, actor }),
        );
      },
      removeWithReceipt(input: RecordDeletePayload) {
        assertOpen(state);
        validateIdempotencyKey(input.idempotencyKey);
        return success(
          state,
          "data.record.delete",
          state.records.softDeleteWithReceipt({ ...input, actor }),
        );
      },
    },
    query: {
      query(input: QueryPayload) {
        assertOpen(state);
        return success(state, "data.query", state.query.query(input));
      },
      aggregate(input) {
        assertOpen(state);
        return success(
          state,
          "data.aggregate",
          state.query.aggregate(input),
        );
      },
    },
    transactions: {
      execute(input: TransactionExecutePayload) {
        assertOpen(state);
        validateIdempotencyKey(input.idempotencyKey);
        validateOperations(
          input.operations,
          DATA_PROTOCOL_LIMITS.maxTransactionOperations,
          "Transaction",
        );
        return success(
          state,
          "data.transaction.execute",
          state.transactions.execute({ actor, payload: input }),
        );
      },
      executeWithReceipt(input: TransactionExecutePayload) {
        assertOpen(state);
        validateIdempotencyKey(input.idempotencyKey);
        validateOperations(
          input.operations,
          DATA_PROTOCOL_LIMITS.maxTransactionOperations,
          "Transaction",
        );
        return success(
          state,
          "data.transaction.execute",
          state.transactions.executeWithReceipt({ actor, payload: input }),
        );
      },
    },
    bulk: {
      preview(operations: readonly BulkMutationOperation[]) {
        assertOpen(state);
        validateOperations(
          operations,
          DATA_PROTOCOL_LIMITS.maxBulkOperations,
          "Bulk",
        );
        validateBulkBytes(operations);
        return success(
          state,
          "data.bulk.preview",
          state.bulk.preview({ actor, operations }),
        );
      },
      execute(input: BulkExecuteParams) {
        assertOpen(state);
        validateIdempotencyKey(input.idempotencyKey);
        validatePreviewDigest(input.expectedPreviewDigest);
        validateOperations(
          input.operations,
          DATA_PROTOCOL_LIMITS.maxBulkOperations,
          "Bulk",
        );
        validateBulkBytes(input.operations);
        return success(
          state,
          "data.bulk.execute",
          state.bulk.execute({
            actor,
            idempotencyKey: input.idempotencyKey,
            expectedPreviewDigest: input.expectedPreviewDigest,
            operations: input.operations,
          }),
        );
      },
    },
    provenance: {
      listEvents(input?: EventsListPayload) {
        assertOpen(state);
        return success(
          state,
          "data.events.list",
          state.provenance.listEvents(input ?? {}),
        );
      },
      getReceipt(receiptId: string) {
        assertOpen(state);
        return success(
          state,
          "data.events.list",
          state.provenance.getReceipt({ receiptId }),
        );
      },
      getReceiptByIdempotencyKey(idempotencyKey: string) {
        assertOpen(state);
        validateIdempotencyKey(idempotencyKey);
        return success(
          state,
          "data.events.list",
          state.provenance.getReceiptByIdempotencyKey({ idempotencyKey }),
        );
      },
      listTransactionReceipts(transactionId: string) {
        assertOpen(state);
        return success(
          state,
          "data.events.list",
          state.provenance.listTransactionReceipts({ transactionId }),
        );
      },
    },
    backup: {
      async createBackup(destinationDirectory: string) {
        assertOpen(state);
        return state.backup.createBackup({
          source: state.handle,
          destinationDirectory: validateDestinationDirectory(
            destinationDirectory,
          ),
        });
      },
      async createPortableExport(destinationDirectory: string) {
        assertOpen(state);
        return state.backup.createPortableExport({
          source: state.handle,
          destinationDirectory: validateDestinationDirectory(
            destinationDirectory,
          ),
        });
      },
      async verifyBackup(artifactDirectory: string) {
        assertOpen(state);
        return state.backup.verifyBackup({
          artifactDirectory: validateDestinationDirectory(artifactDirectory),
          expectedBinding: state.scope.binding,
        });
      },
      async verifyPortableExport(artifactDirectory: string) {
        assertOpen(state);
        return state.backup.verifyPortableExport({
          artifactDirectory: validateDestinationDirectory(artifactDirectory),
          expectedBinding: state.scope.binding,
        });
      },
    },
    health: {
      metadata() {
        return {
          driverKind: database.driverKind,
          scopeKind: scope.kind,
          workspaceId: scope.workspaceId,
          databasePath: state.databasePath,
        };
      },
      diagnostics() {
        assertOpen(state);
        const facts = database.diagnostics() as DataClientStorageFacts;
        return success(state, "data.status", {
          sqliteVersion: facts.sqliteVersion,
          journalMode: facts.journalMode,
          foreignKeys: facts.foreignKeys,
          strictTables: facts.strictTables,
          applicationId: facts.applicationId,
          userVersion: facts.userVersion,
        });
      },
      integrityCheck() {
        assertOpen(state);
        const checked = database.integrityCheck();
        return success(state, "data.doctor", {
          ok: checked.ok,
          messages: [...checked.messages],
        });
      },
      migrationStatus() {
        assertOpen(state);
        const inspected = driver.inspectMigration({
          location: state.databasePath,
          expectedBinding: scope.binding,
        });
        return success(state, "data.status", {
          state: inspected.state,
          databaseFormatVersion: inspected.databaseFormatVersion,
          targetFormatVersion: inspected.targetFormatVersion,
          pendingMigrationIds: [...inspected.pendingMigrationIds],
          incompleteMigrationIds: [...inspected.incompleteMigrationIds],
        });
      },
    },
    close() {
      if (state.closed) return;
      state.closed = true;
      if (state.ownsHandle) database.close();
    },
  };

  Object.defineProperty(client, "scope", { value: scope });
  return client;
}

export type { CreateDataClientOptions };
