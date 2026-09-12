import type {
  DataClient,
  DataSuccessResult,
} from "../client/index.js";
import type {
  AggregatePayload,
  BulkMutationOperation,
  EventsListPayload,
  QueryPayload,
  RecordDeletePayload,
  RecordGetPayload,
  RecordListPayload,
  RecordUpdatePayload,
  SchemaGetPayload,
  SchemaListPayload,
  SpaceGetPayload,
  TransactionExecutePayload,
} from "../protocol/index.js";
import type {
  DataClientRecordCreateInput,
} from "../client/types.js";
import type { BulkExecuteParams } from "../client/types.js";
import type {
  DataEventPage,
  DataMutationReceipt,
} from "../provenance/index.js";
import type {
  DataAggregateResult,
  DataQueryPage,
} from "../query/index.js";
import type {
  DataRecordMutationWithReceipt,
  DataRecordSnapshot,
} from "../records/index.js";
import type {
  DataSpaceSnapshot,
  EntitySchemaSummary,
  EntitySchemaSnapshot,
} from "../catalog/index.js";
import type {
  DataTransactionResult,
} from "../transactions/index.js";
import {
  BotsDataAdapterError,
} from "./errors.js";
import type {
  BotsDataAction,
  BotsDataCapabilityLease,
  BotsDataPrincipal,
} from "./errors.js";

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SLUG_OR_WILDCARD_RE = /^(\*|[a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/;
const FILESYSTEM_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_ID_LENGTH = 128;

export interface BotsTaskLinkedReceipt {
  readonly receipt: DataMutationReceipt;
  readonly taskId: string;
  readonly artifactRef?: string;
  readonly principal: BotsDataPrincipal;
}

export interface BotsRecordMutation {
  readonly record: DataRecordSnapshot;
  readonly receipt: BotsTaskLinkedReceipt;
}

export interface BotsTransactionMutation {
  readonly result: DataTransactionResult;
  readonly receipt: BotsTaskLinkedReceipt;
}

export interface BotsDataAdapter {
  readonly lease: BotsDataCapabilityLease;
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
    ): DataSuccessResult<BotsRecordMutation>;
    update(
      input: RecordUpdatePayload,
    ): DataSuccessResult<DataRecordSnapshot>;
    updateWithReceipt(
      input: RecordUpdatePayload,
    ): DataSuccessResult<BotsRecordMutation>;
    remove(
      input: RecordDeletePayload,
    ): DataSuccessResult<DataRecordSnapshot>;
    removeWithReceipt(
      input: RecordDeletePayload,
    ): DataSuccessResult<BotsRecordMutation>;
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
    ): DataSuccessResult<BotsTransactionMutation>;
  };
  readonly bulk: {
    preview(
      operations: readonly BulkMutationOperation[],
    ): DataSuccessResult<import("../bulk/index.js").DataBulkPreview>;
    execute(
      input: BulkExecuteParams,
    ): DataSuccessResult<BotsBulkMutation>;
  };
  readonly provenance: {
    listEvents(input?: EventsListPayload): DataSuccessResult<DataEventPage>;
    getReceipt(receiptId: string): DataSuccessResult<DataMutationReceipt>;
    getReceiptByIdempotencyKey(
      idempotencyKey: string,
    ): DataSuccessResult<DataMutationReceipt>;
    listTransactionReceipts(
      transactionId: string,
    ): DataSuccessResult<readonly DataMutationReceipt[]>;
  };
  readonly health: {
    metadata(): {
      readonly driverKind: string;
      readonly scopeKind: "standalone" | "workspace";
      readonly workspaceId: string;
      readonly databasePath: string;
    };
  };
}

export interface BotsBulkMutation {
  readonly previewDigest: string;
  readonly atomicity: "all-or-nothing";
  readonly transaction: DataTransactionResult;
  readonly receipt: BotsTaskLinkedReceipt;
}

interface ParsedCapability {
  readonly space: string;
  readonly entity: string;
  readonly action: BotsDataAction;
}

function fail(
  code:
    | "LEASE_INVALID"
    | "LEASE_EXPIRED"
    | "LEASE_WORKSPACE_MISMATCH"
    | "PRINCIPAL_MISMATCH"
    | "CAPABILITY_DENIED",
  message: string,
): never {
  throw new BotsDataAdapterError(code, message);
}

function checkId(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_ID_LENGTH ||
    value === "." ||
    value === ".." ||
    !SAFE_ID_RE.test(value)
  ) {
    fail("LEASE_INVALID", `Lease ${field} must be a safe identifier.`);
  }
  return value as string;
}

function parseCapability(raw: unknown): ParsedCapability {
  if (typeof raw !== "string") {
    fail("LEASE_INVALID", "Lease capabilities must be strings.");
  }
  const value = raw as string;
  const parts = value.split(":");
  if (
    parts.length !== 4 ||
    parts[0] !== "data" ||
    !SLUG_OR_WILDCARD_RE.test(parts[1] ?? "") ||
    !SLUG_OR_WILDCARD_RE.test(parts[2] ?? "") ||
    (parts[3] !== "read" &&
      parts[3] !== "create" &&
      parts[3] !== "update" &&
      parts[3] !== "delete")
  ) {
    fail(
      "LEASE_INVALID",
      `Lease capability '${value}' must match data:<space>:<entity>:<read|create|update|delete> with slugs or '*'.`,
    );
  }
  return {
    space: parts[1] as string,
    entity: parts[2] as string,
    action: parts[3] as BotsDataAction,
  };
}

function validateLease(lease: BotsDataCapabilityLease): {
  readonly parsed: readonly ParsedCapability[];
} {
  if (typeof lease !== "object" || lease === null) {
    fail("LEASE_INVALID", "Lease must be a host-passed trusted object.");
  }
  const candidate = lease as unknown as Record<string, unknown>;
  if (
    typeof candidate["workspaceId"] !== "string" ||
    (candidate["workspaceId"] as string).length < 1 ||
    (candidate["workspaceId"] as string).length > MAX_ID_LENGTH ||
    !FILESYSTEM_ID_RE.test(candidate["workspaceId"] as string)
  ) {
    fail("LEASE_INVALID", "Lease workspaceId must be a safe workspace identity.");
  }
  const principalRaw = candidate["principal"] as unknown;
  const principalKind = (principalRaw as { kind?: unknown })["kind"];
  const principalId = (principalRaw as { id?: unknown })["id"];
  if (
    typeof principalRaw !== "object" ||
    principalRaw === null ||
    (principalKind !== "bot" && principalKind !== "worker") ||
    typeof principalId !== "string"
  ) {
    fail("LEASE_INVALID", "Lease principal must be { kind: bot|worker, id }.");
  }
  const principal = principalRaw as { kind: string; id: unknown };
  checkId(principal["id"], "principal.id");
  checkId(candidate["taskId"], "taskId");
  if (
    !Array.isArray(candidate["capabilities"]) ||
    (candidate["capabilities"] as unknown[]).length < 1 ||
    (candidate["capabilities"] as unknown[]).length > 64
  ) {
    fail("LEASE_INVALID", "Lease must carry 1..64 capabilities.");
  }
  if (candidate["expiresAt"] !== undefined) {
    if (
      typeof candidate["expiresAt"] !== "string" ||
      Number.isNaN(Date.parse(candidate["expiresAt"] as string))
    ) {
      fail("LEASE_INVALID", "Lease expiresAt must be a valid timestamp.");
    }
  }
  if (candidate["artifactRef"] !== undefined) {
    checkId(candidate["artifactRef"], "artifactRef");
  }
  const parsed = (candidate["capabilities"] as unknown[]).map(parseCapability);
  return { parsed };
}

function matches(
  parsed: readonly ParsedCapability[],
  space: string,
  entity: string,
  action: BotsDataAction,
): boolean {
  return parsed.some(
    (cap) =>
      (cap.space === "*" || cap.space === space) &&
      (cap.entity === "*" || cap.entity === entity) &&
      cap.action === action,
  );
}

export function createBotsDataAdapter(
  client: DataClient,
  lease: BotsDataCapabilityLease,
): BotsDataAdapter {
  if (typeof client !== "object" || client === null) {
    fail("LEASE_INVALID", "A Task 27 Data client is required.");
  }
  const { parsed } = validateLease(lease);

  if (client.scope.workspaceId !== lease.workspaceId) {
    fail(
      "LEASE_WORKSPACE_MISMATCH",
      `Lease workspace '${lease.workspaceId}' does not match client workspace '${client.scope.workspaceId}'. Cross-workspace access is denied.`,
    );
  }
  if (
    client.actor.kind !== lease.principal.kind ||
    client.actor.id !== lease.principal.id
  ) {
    fail(
      "PRINCIPAL_MISMATCH",
      "Lease principal does not match the bound client actor. Provenance must reflect the real Bot/Worker.",
    );
  }
  const granted = new Set<string>(
    client.authorization.capabilityRefs ?? [],
  );
  for (const raw of lease.capabilities) {
    if (!granted.has(raw)) {
      fail(
        "CAPABILITY_DENIED",
        `Lease capability '${raw}' is not present in the host-granted authorization refs. Model-written strings never grant access.`,
      );
    }
  }

  const principal: BotsDataPrincipal = {
    kind: lease.principal.kind,
    id: lease.principal.id,
  };

  function assertUsable(): void {
    if (client.closed) {
      fail("LEASE_INVALID", "Bound client is closed.");
    }
    if (
      lease.expiresAt !== undefined &&
      Date.parse(lease.expiresAt) <= Date.now()
    ) {
      fail("LEASE_EXPIRED", "Capability lease has expired.");
    }
  }

  function requireCap(
    space: string,
    entity: string,
    action: BotsDataAction,
  ): void {
    assertUsable();
    if (!matches(parsed, space, entity, action)) {
      fail(
        "CAPABILITY_DENIED",
        `Lease denies ${action} on ${space}/${entity} for task '${lease.taskId}'. Delegation reduces authority and never increases it.`,
      );
    }
  }

  function requireAnyRead(): void {
    assertUsable();
    if (!parsed.some((cap) => cap.action === "read")) {
      fail(
        "CAPABILITY_DENIED",
        `Lease carries no read capability for task '${lease.taskId}'.`,
      );
    }
  }

  function requireRead(space: string, entity = "*"): void {
    requireCap(space, entity, "read");
  }

  function link(receipt: DataMutationReceipt): BotsTaskLinkedReceipt {
    return {
      receipt,
      taskId: lease.taskId,
      ...(lease.artifactRef === undefined
        ? {}
        : { artifactRef: lease.artifactRef }),
      principal: { ...principal },
    };
  }

  function wrapMutation(
    out: DataSuccessResult<DataRecordMutationWithReceipt>,
  ): DataSuccessResult<BotsRecordMutation> {
    return {
      ...out,
      result: { record: out.result.record, receipt: link(out.result.receipt) },
    };
  }

  function operationAction(
    operation: string,
  ): BotsDataAction {
    if (operation === "data.record.create") return "create";
    if (operation === "data.record.update") return "update";
    return "delete";
  }

  function requireOperations(
    operations: readonly { operation: string; payload: { spaceId: string; entity: string } }[],
  ): void {
    assertUsable();
    for (const op of operations) {
      requireCap(
        op.payload.spaceId,
        op.payload.entity,
        operationAction(op.operation),
      );
    }
  }

  return {
    lease,
    get closed(): boolean {
      return client.closed;
    },
    spaces: {
      get(input: SpaceGetPayload) {
        requireRead(input.spaceId);
        return client.spaces.get(input);
      },
      list() {
        requireAnyRead();
        return client.spaces.list();
      },
    },
    schemas: {
      get(input: SchemaGetPayload) {
        requireRead(input.spaceId, input.entity);
        return client.schemas.get(input);
      },
      list(input: SchemaListPayload) {
        requireRead(input.spaceId);
        return client.schemas.list(input);
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
        return wrapMutation(client.records.createWithReceipt(input));
      },
      update(input: RecordUpdatePayload) {
        requireCap(input.spaceId, input.entity, "update");
        return client.records.update(input);
      },
      updateWithReceipt(input: RecordUpdatePayload) {
        requireCap(input.spaceId, input.entity, "update");
        return wrapMutation(client.records.updateWithReceipt(input));
      },
      remove(input: RecordDeletePayload) {
        requireCap(input.spaceId, input.entity, "delete");
        return client.records.remove(input);
      },
      removeWithReceipt(input: RecordDeletePayload) {
        requireCap(input.spaceId, input.entity, "delete");
        return wrapMutation(client.records.removeWithReceipt(input));
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
        requireOperations(input.operations);
        return client.transactions.execute(input);
      },
      executeWithReceipt(input: TransactionExecutePayload) {
        requireOperations(input.operations);
        const out = client.transactions.executeWithReceipt(input);
        return {
          ...out,
          result: { result: out.result.result, receipt: link(out.result.receipt) },
        };
      },
    },
    bulk: {
      preview(operations: readonly BulkMutationOperation[]) {
        requireOperations(operations);
        return client.bulk.preview(operations);
      },
      execute(input: BulkExecuteParams) {
        requireOperations(input.operations);
        const out = client.bulk.execute(input);
        return {
          ...out,
          result: {
            previewDigest: out.result.previewDigest,
            atomicity: out.result.atomicity,
            transaction: out.result.transaction,
            receipt: link(out.result.transactionReceipt),
          },
        };
      },
    },
    provenance: {
      listEvents(input?: EventsListPayload) {
        if (input?.spaceId !== undefined) {
          requireRead(input.spaceId, input.entity ?? "*");
        } else {
          requireAnyRead();
        }
        return client.provenance.listEvents(input);
      },
      getReceipt(receiptId: string) {
        requireAnyRead();
        return client.provenance.getReceipt(receiptId);
      },
      getReceiptByIdempotencyKey(idempotencyKey: string) {
        requireAnyRead();
        return client.provenance.getReceiptByIdempotencyKey(idempotencyKey);
      },
      listTransactionReceipts(transactionId: string) {
        requireAnyRead();
        return client.provenance.listTransactionReceipts(transactionId);
      },
    },
    health: {
      metadata() {
        return client.health.metadata();
      },
    },
  };
}
