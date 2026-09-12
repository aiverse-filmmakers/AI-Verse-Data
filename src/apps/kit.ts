import type { DataClient, DataSuccessResult } from "../client/index.js";
import type {
  AggregatePayload,
  BulkMutationOperation,
  EventsListPayload,
  QueryPayload,
  RecordGetPayload,
  RecordListPayload,
  RecordUpdatePayload,
  SchemaGetPayload,
  SchemaListPayload,
  SpaceGetPayload,
  TransactionExecutePayload,
} from "../protocol/index.js";
import type { DataClientRecordCreateInput } from "../client/types.js";
import type { BulkExecuteParams } from "../client/types.js";
import type {
  DataSpaceSnapshot,
  EntitySchemaSummary,
  EntitySchemaSnapshot,
} from "../catalog/index.js";
import type {
  DataAggregateResult,
  DataQueryPage,
} from "../query/index.js";
import type {
  DataRecordMutationWithReceipt,
  DataRecordSnapshot,
} from "../records/index.js";
import type {
  DataEventPage,
  DataMutationReceipt,
} from "../provenance/index.js";
import type {
  DataTransactionResult,
  DataTransactionWithReceipt,
} from "../transactions/index.js";
import { AppsDataError } from "./errors.js";

export type AppsDataCapability =
  | "read"
  | "create"
  | "update";

export interface AppsSpaceGrant {
  readonly spaceId: string;
  readonly entities: readonly string[];
  readonly capabilities: readonly AppsDataCapability[];
}

export interface AppsDataManifest {
  readonly app: string;
  readonly scope: "workspace";
  readonly data: {
    readonly spaces: Record<string, { readonly schemas: readonly string[] }>;
    readonly capabilities: readonly AppsDataCapability[];
  };
}

export interface AppsDataGrant {
  readonly app: string;
  readonly workspaceId: string;
  readonly principal: { readonly kind: "app"; readonly id: string };
  readonly spaces: readonly AppsSpaceGrant[];
  readonly schemaOrigins: Readonly<Record<string, string>>;
}

export interface AppsDataKitMeta {
  readonly app: string;
  readonly workspaceId: string;
  readonly principal: { readonly kind: "app"; readonly id: string };
  readonly grantedAt: string;
  readonly uninstallRule: "preserve-data";
}

export interface AppsSchemaOrigin {
  readonly spaceId: string;
  readonly entity: string;
  readonly originApp: string | null;
  readonly schemaVersion: number;
}

export interface AppsDataKit {
  readonly meta: AppsDataKitMeta;
  readonly grant: AppsDataGrant;
  readonly closed: boolean;
  readonly spaces: {
    get(
      input: SpaceGetPayload,
    ): DataSuccessResult<DataSpaceSnapshot>;
    list(): DataSuccessResult<readonly DataSpaceSnapshot[]>;
  };
  readonly schemas: {
    get(input: SchemaGetPayload): DataSuccessResult<EntitySchemaSnapshot>;
    list(
      input: SchemaListPayload,
    ): DataSuccessResult<readonly EntitySchemaSummary[]>;
    origin(input: {
      readonly spaceId: string;
      readonly entity: string;
    }): DataSuccessResult<AppsSchemaOrigin>;
  };
  readonly records: {
    get(input: RecordGetPayload): DataSuccessResult<DataRecordSnapshot>;
    list(
      input: RecordListPayload,
    ): DataSuccessResult<readonly DataRecordSnapshot[]>;
    create(
      input: DataClientRecordCreateInput,
    ): DataSuccessResult<DataRecordSnapshot>;
    createWithReceipt(
      input: DataClientRecordCreateInput,
    ): DataSuccessResult<DataRecordMutationWithReceipt>;
    update(
      input: RecordUpdatePayload,
    ): DataSuccessResult<DataRecordSnapshot>;
    updateWithReceipt(
      input: RecordUpdatePayload,
    ): DataSuccessResult<DataRecordMutationWithReceipt>;
  };
  readonly query: {
    query(input: QueryPayload): DataSuccessResult<DataQueryPage>;
    aggregate(
      input: AggregatePayload,
    ): DataSuccessResult<DataAggregateResult>;
  };
  readonly transactions: {
    execute(
      input: TransactionExecutePayload,
    ): DataSuccessResult<DataTransactionResult>;
    executeWithReceipt(
      input: TransactionExecutePayload,
    ): DataSuccessResult<DataTransactionWithReceipt>;
  };
  readonly bulk: {
    preview(
      operations: readonly BulkMutationOperation[],
    ): DataSuccessResult<import("../bulk/index.js").DataBulkPreview>;
    execute(
      input: BulkExecuteParams,
    ): DataSuccessResult<import("../bulk/index.js").DataBulkExecuteResult>;
  };
  readonly provenance: {
    listEvents(input?: EventsListPayload): DataSuccessResult<DataEventPage>;
    getReceipt(receiptId: string): DataSuccessResult<DataMutationReceipt>;
    getReceiptByIdempotencyKey(
      idempotencyKey: string,
    ): DataSuccessResult<DataMutationReceipt>;
  };
  readonly permissions: {
    describe(): DataSuccessResult<AppsDataGrant>;
  };
  readonly lifecycle: {
    uninstallNotice(): DataSuccessResult<{
      readonly app: string;
      readonly workspaceId: string;
      readonly rule: "preserve-data";
      readonly detail: string;
    }>;
  };
}

const SLUG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const APP_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const WORKSPACE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_ID_LENGTH = 128;
const MAX_SPACES = 32;
const MAX_ENTITIES = 64;

function fail(
  code: "APPS_INVALID" | "APPS_CLOSED" | "APPS_PERMISSION_DENIED",
  message: string,
): never {
  throw new AppsDataError(code, message);
}

function checkSlug(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 64 ||
    !SLUG_RE.test(value)
  ) {
    fail("APPS_INVALID", `${field} must be a lowercase Data identifier slug.`);
  }
  return value;
}

function parseManifest(raw: unknown): AppsDataManifest {
  if (typeof raw !== "object" || raw === null) {
    fail("APPS_INVALID", "App manifest must be a host-passed object.");
  }
  const manifest = raw as Record<string, unknown>;
  if (
    typeof manifest["app"] !== "string" ||
    (manifest["app"] as string).length < 1 ||
    (manifest["app"] as string).length > MAX_ID_LENGTH ||
    !APP_ID_RE.test(manifest["app"] as string)
  ) {
    fail("APPS_INVALID", "Manifest app must be a lowercase app slug.");
  }
  if (manifest["scope"] !== "workspace") {
    fail("APPS_INVALID", 'Manifest scope must be "workspace".');
  }
  const data = manifest["data"] as Record<string, unknown> | undefined;
  if (typeof data !== "object" || data === null) {
    fail("APPS_INVALID", "Manifest data must carry spaces and capabilities.");
  }
  const spaces = (data as Record<string, unknown>)["spaces"] as
    | Record<string, unknown>
    | undefined;
  if (typeof spaces !== "object" || spaces === null) {
    fail("APPS_INVALID", "Manifest data.spaces must be an object.");
  }
  const names = Object.keys(spaces);
  if (names.length < 1 || names.length > MAX_SPACES) {
    fail("APPS_INVALID", `Manifest must declare 1..${MAX_SPACES} spaces.`);
  }
  for (const name of names) checkSlug(name, "manifest space");
  const caps = (data as Record<string, unknown>)["capabilities"];
  if (!Array.isArray(caps) || caps.length < 1 || caps.length > 3) {
    fail(
      "APPS_INVALID",
      "Manifest data.capabilities must list 1..3 of read/create/update.",
    );
  }
  for (const cap of caps) {
    if (cap !== "read" && cap !== "create" && cap !== "update") {
      fail(
        "APPS_INVALID",
        "Manifest capabilities allow only read/create/update. Delete is never granted to Apps.",
      );
    }
  }
  for (const [spaceId, entry] of Object.entries(spaces)) {
    const schemas = (entry as Record<string, unknown>)["schemas"];
    if (!Array.isArray(schemas) || schemas.length < 1 || schemas.length > MAX_ENTITIES) {
      fail(
        "APPS_INVALID",
        `Manifest space '${spaceId}' must list 1..${MAX_ENTITIES} schemas.`,
      );
    }
    for (const entity of schemas) checkSlug(entity, `manifest schema in ${spaceId}`);
  }
  return raw as AppsDataManifest;
}

function grantFromManifest(
  manifest: AppsDataManifest,
  workspaceId: string,
): AppsDataGrant {
  if (
    typeof workspaceId !== "string" ||
    workspaceId.length < 1 ||
    workspaceId.length > MAX_ID_LENGTH ||
    !WORKSPACE_RE.test(workspaceId)
  ) {
    fail("APPS_INVALID", "Workspace ID must be a safe workspace identity.");
  }
  const spaces: AppsSpaceGrant[] = Object.entries(manifest.data.spaces).map(
    ([spaceId, entry]) => ({
      spaceId,
      entities: [...entry.schemas],
      capabilities: [...manifest.data.capabilities],
    }),
  );
  return {
    app: manifest.app,
    workspaceId,
    principal: { kind: "app", id: manifest.app },
    spaces,
    schemaOrigins: {},
  };
}

function findGrant(
  grant: AppsDataGrant,
  spaceId: string,
  entity: string,
): AppsSpaceGrant | null {
  for (const space of grant.spaces) {
    if (space.spaceId !== spaceId) continue;
    if (!space.entities.includes("*") && !space.entities.includes(entity)) {
      return null;
    }
    return space;
  }
  return null;
}

export function createAppsDataKit(
  client: DataClient,
  manifest: AppsDataManifest,
  options?: { readonly schemaOrigins?: Readonly<Record<string, string>> },
): AppsDataKit {
  if (typeof client !== "object" || client === null) {
    fail("APPS_INVALID", "A Task 27 Data client is required.");
  }
  const parsed = parseManifest(manifest);
  const grant: AppsDataGrant = {
    ...grantFromManifest(parsed, client.scope.workspaceId),
    schemaOrigins: { ...(options?.schemaOrigins ?? {}) },
  };

  if (
    client.actor.kind !== "app" ||
    client.actor.id !== grant.app
  ) {
    fail(
      "APPS_INVALID",
      `Manifest app '${grant.app}' does not match bound client actor '${client.actor.kind}:${client.actor.id}'. App identity must be host-bound.`,
    );
  }
  if (client.scope.workspaceId !== grant.workspaceId) {
    fail(
      "APPS_INVALID",
      "Manifest workspace does not match client scope workspace. Cross-workspace kits are denied.",
    );
  }
  const grantedRefs = new Set<string>(client.authorization.capabilityRefs ?? []);
  for (const space of grant.spaces) {
    for (const entity of space.entities) {
      for (const cap of space.capabilities) {
        const ref = `data:${space.spaceId}:${entity}:${cap}`;
        if (!grantedRefs.has(ref) && !grantedRefs.has(`data:${space.spaceId}:*:${cap}`)) {
          fail(
            "APPS_PERMISSION_DENIED",
            `Manifest asks for '${ref}' but the host granted no such ref. Model-written manifests never grant access.`,
          );
        }
      }
    }
  }

  const meta: AppsDataKitMeta = {
    app: grant.app,
    workspaceId: grant.workspaceId,
    principal: { ...grant.principal },
    grantedAt: new Date().toISOString(),
    uninstallRule: "preserve-data",
  };

  function assertUsable(): void {
    if (client.closed) {
      fail("APPS_CLOSED", "Bound client is closed.");
    }
  }

  function requireCap(
    spaceId: string,
    entity: string,
    cap: AppsDataCapability,
  ): void {
    assertUsable();
    const space = findGrant(grant, spaceId, entity);
    if (space === null || !space.capabilities.includes(cap)) {
      fail(
        "APPS_PERMISSION_DENIED",
        `App '${grant.app}' has no '${cap}' grant on ${spaceId}/${entity}. Grants reduce authority and never increase it.`,
      );
    }
  }

  function requireRead(spaceId: string, entity = "*"): void {
    assertUsable();
    const space =
      grant.spaces.find((entry) => entry.spaceId === spaceId) ?? null;
    if (space === null || !space.capabilities.includes("read")) {
      fail(
        "APPS_PERMISSION_DENIED",
        `App '${grant.app}' has no 'read' grant on ${spaceId}/${entity}. Grants reduce authority and never increase it.`,
      );
    }
    if (
      entity !== "*" &&
      !space.entities.includes("*") &&
      !space.entities.includes(entity)
    ) {
      fail(
        "APPS_PERMISSION_DENIED",
        `App '${grant.app}' has no 'read' grant on ${spaceId}/${entity}. Grants reduce authority and never increase it.`,
      );
    }
  }

  function operationCap(operation: string): AppsDataCapability {
    if (operation === "data.record.create") return "create";
    if (operation === "data.record.update") return "update";
    fail(
      "APPS_PERMISSION_DENIED",
      `App '${grant.app}' cannot delete canonical Data records. Delete is never granted to Apps.`,
    );
  }

  function canRead(spaceId: string, entity: string): boolean {
    const space = findGrant(grant, spaceId, entity);
    return space !== null && space.capabilities.includes("read");
  }

  function transactionReceiptsReadable(transactionId: string): boolean {
    const receipts =
      client.provenance.listTransactionReceipts(transactionId).result;
    const targeted = receipts.filter(
      (receipt) => receipt.spaceId !== null && receipt.entity !== null,
    );
    return (
      targeted.length > 0 &&
      targeted.every((receipt) =>
        canRead(receipt.spaceId as string, receipt.entity as string),
      )
    );
  }

  function receiptReadable(receipt: DataMutationReceipt): boolean {
    if (receipt.spaceId !== null && receipt.entity !== null) {
      return canRead(receipt.spaceId, receipt.entity);
    }
    return (
      receipt.transactionId !== null &&
      transactionReceiptsReadable(receipt.transactionId)
    );
  }

  function eventReadable(event: import("../provenance/index.js").DataEvent): boolean {
    if (event.spaceId !== null && event.entity !== null) {
      return canRead(event.spaceId, event.entity);
    }
    return (
      event.transactionId !== null &&
      transactionReceiptsReadable(event.transactionId)
    );
  }

  function requireReadableReceipt(receipt: DataMutationReceipt): void {
    if (!receiptReadable(receipt)) {
      fail(
        "APPS_PERMISSION_DENIED",
        `App '${grant.app}' cannot read provenance outside its granted Data entities.`,
      );
    }
  }

  function originKey(spaceId: string, entity: string): string {
    return `${spaceId}/${entity}`;
  }

  return {
    meta,
    grant,
    get closed(): boolean {
      return client.closed;
    },
    spaces: {
      get(input: SpaceGetPayload) {
        requireRead(input.spaceId);
        return client.spaces.get(input);
      },
      list() {
        assertUsable();
        const all = client.spaces.list();
        return {
          ...all,
          result: all.result.filter((space) =>
            grant.spaces.some((grantSpace) => grantSpace.spaceId === space.spaceId),
          ),
        };
      },
    },
    schemas: {
      get(input: SchemaGetPayload) {
        requireRead(input.spaceId, input.entity);
        return client.schemas.get(input);
      },
      list(input: SchemaListPayload) {
        requireRead(input.spaceId);
        const out = client.schemas.list(input);
        return {
          ...out,
          result: out.result.filter((summary) => {
            const space = findGrant(grant, input.spaceId, summary.entity);
            return space !== null;
          }),
        };
      },
      origin(input: { readonly spaceId: string; readonly entity: string }) {
        requireRead(input.spaceId, input.entity);
        const schema = client.schemas.get(input);
        const key = originKey(input.spaceId, input.entity);
        const originApp = grant.schemaOrigins[key] ?? null;
        return {
          ...schema,
          result: {
            spaceId: input.spaceId,
            entity: input.entity,
            originApp,
            schemaVersion: schema.result.schemaVersion,
          },
        };
      },
    },
    records: {
      get(input: RecordGetPayload) {
        requireRead(input.spaceId, input.entity);
        return client.records.get(input);
      },
      list(input: RecordListPayload) {
        requireRead(input.spaceId, input.entity);
        return client.records.list(input);
      },
      create(input: DataClientRecordCreateInput) {
        requireCap(input.spaceId, input.entity, "create");
        return client.records.create(input);
      },
      createWithReceipt(input: DataClientRecordCreateInput) {
        requireCap(input.spaceId, input.entity, "create");
        return client.records.createWithReceipt(input);
      },
      update(input: RecordUpdatePayload) {
        requireCap(input.spaceId, input.entity, "update");
        return client.records.update(input);
      },
      updateWithReceipt(input: RecordUpdatePayload) {
        requireCap(input.spaceId, input.entity, "update");
        return client.records.updateWithReceipt(input);
      },
    },
    query: {
      query(input: QueryPayload) {
        requireRead(input.spaceId, input.entity);
        return client.query.query(input);
      },
      aggregate(input: AggregatePayload) {
        requireRead(input.spaceId, input.entity);
        return client.query.aggregate(input);
      },
    },
    transactions: {
      execute(input: TransactionExecutePayload) {
        assertUsable();
        for (const op of input.operations) {
          requireCap(
            op.payload.spaceId,
            op.payload.entity,
            operationCap(op.operation),
          );
        }
        return client.transactions.execute(input);
      },
      executeWithReceipt(input: TransactionExecutePayload) {
        assertUsable();
        for (const op of input.operations) {
          requireCap(
            op.payload.spaceId,
            op.payload.entity,
            operationCap(op.operation),
          );
        }
        return client.transactions.executeWithReceipt(input);
      },
    },
    bulk: {
      preview(operations: readonly BulkMutationOperation[]) {
        assertUsable();
        for (const op of operations) {
          requireCap(
            op.payload.spaceId,
            op.payload.entity,
            operationCap(op.operation),
          );
        }
        return client.bulk.preview(operations);
      },
      execute(input: BulkExecuteParams) {
        assertUsable();
        for (const op of input.operations) {
          requireCap(
            op.payload.spaceId,
            op.payload.entity,
            operationCap(op.operation),
          );
        }
        return client.bulk.execute(input);
      },
    },
    provenance: {
      listEvents(input?: EventsListPayload) {
        assertUsable();
        if (input?.spaceId !== undefined) {
          requireRead(input.spaceId, input.entity ?? "*");
        } else if (
          !grant.spaces.some((space) => space.capabilities.includes("read"))
        ) {
          fail(
            "APPS_PERMISSION_DENIED",
            `App '${grant.app}' has no read grant anywhere.`,
          );
        }
        const out = client.provenance.listEvents(input);
        return {
          ...out,
          result: {
            ...out.result,
            items: out.result.items.filter(eventReadable),
          },
        };
      },
      getReceipt(receiptId: string) {
        assertUsable();
        const out = client.provenance.getReceipt(receiptId);
        requireReadableReceipt(out.result);
        return out;
      },
      getReceiptByIdempotencyKey(idempotencyKey: string) {
        assertUsable();
        const out =
          client.provenance.getReceiptByIdempotencyKey(idempotencyKey);
        requireReadableReceipt(out.result);
        return out;
      },
    },
    permissions: {
      describe() {
        assertUsable();
        const out = client.spaces.list();
        return { ...out, result: grant };
      },
    },
    lifecycle: {
      uninstallNotice() {
        assertUsable();
        const out = client.spaces.list();
        return {
          ...out,
          result: {
            app: grant.app,
            workspaceId: grant.workspaceId,
            rule: "preserve-data" as const,
            detail:
              "Removing the app removes only app UI/runtime. Canonical records stay Data-owned; a separately approved destructive purge is required to delete them.",
          },
        };
      },
    },
  };
}

export type { AppsDataManifest as AppsManifest };
