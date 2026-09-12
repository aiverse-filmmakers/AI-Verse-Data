import type { DataClient, DataSuccessResult } from "../client/index.js";
import type {
  AggregatePayload,
  DataActor,
  DataAuthorization,
  DataScope,
  EventsListPayload,
  QueryPayload,
  RecordGetPayload,
  RecordListPayload,
  SchemaGetPayload,
  SchemaListPayload,
  SpaceGetPayload,
} from "../protocol/index.js";
import type {
  DataSpaceSnapshot,
  EntitySchemaSummary,
  EntitySchemaSnapshot,
} from "../catalog/index.js";
import type {
  DataAggregateResult,
  DataQueryPage,
} from "../query/index.js";
import type { DataRecordSnapshot } from "../records/index.js";
import type {
  DataEventPage,
  DataMutationReceipt,
} from "../provenance/index.js";
import { BrainDataAdapterError } from "./errors.js";

export interface BrainDataQuestionProvenance {
  readonly answeredAt: string;
  readonly scope: DataScope;
  readonly actor: DataActor;
  readonly authorization: DataAuthorization;
  readonly recordCount: number;
}

export interface BrainSpaceSummary {
  readonly space: DataSpaceSnapshot;
  readonly schemaCount: number;
}

export interface BrainEntitySummary {
  readonly summary: EntitySchemaSummary;
  readonly currentVersion: number;
}

export interface BrainRecordAnswer {
  readonly record: DataRecordSnapshot;
  readonly provenance: BrainDataQuestionProvenance;
}

export interface BrainRecordsAnswer {
  readonly records: readonly DataRecordSnapshot[];
  readonly provenance: BrainDataQuestionProvenance;
}

export interface BrainQueryAnswer {
  readonly page: DataQueryPage;
  readonly provenance: BrainDataQuestionProvenance;
}

export interface BrainAggregateAnswer {
  readonly values: DataAggregateResult["values"];
  readonly provenance: BrainDataQuestionProvenance;
}

export interface BrainEventsAnswer {
  readonly page: DataEventPage;
  readonly provenance: BrainDataQuestionProvenance;
}

export interface BrainReceiptAnswer {
  readonly receipt: DataMutationReceipt;
  readonly provenance: BrainDataQuestionProvenance;
}

export interface BrainDataAdapter {
  readonly closed: boolean;
  readonly spaces: {
    get(
      input: SpaceGetPayload,
    ): DataSuccessResult<DataSpaceSnapshot>;
    list(): DataSuccessResult<readonly DataSpaceSnapshot[]>;
    summarize(
      input: SpaceGetPayload,
    ): DataSuccessResult<BrainSpaceSummary>;
  };
  readonly schemas: {
    get(input: SchemaGetPayload): DataSuccessResult<EntitySchemaSnapshot>;
    list(
      input: SchemaListPayload,
    ): DataSuccessResult<readonly EntitySchemaSummary[]>;
    summarize(input: SchemaGetPayload): DataSuccessResult<BrainEntitySummary>;
  };
  readonly records: {
    get(input: RecordGetPayload): DataSuccessResult<BrainRecordAnswer>;
    list(input: RecordListPayload): DataSuccessResult<BrainRecordsAnswer>;
  };
  readonly query: {
    ask(input: QueryPayload): DataSuccessResult<BrainQueryAnswer>;
    summarize(
      input: AggregatePayload,
    ): DataSuccessResult<BrainAggregateAnswer>;
  };
  readonly provenance: {
    listEvents(input?: EventsListPayload): DataSuccessResult<BrainEventsAnswer>;
    getReceipt(receiptId: string): DataSuccessResult<BrainReceiptAnswer>;
    getReceiptByIdempotencyKey(
      idempotencyKey: string,
    ): DataSuccessResult<BrainReceiptAnswer>;
  };
  readonly health: {
    metadata(): {
      readonly driverKind: string;
      readonly scopeKind: "standalone" | "workspace";
      readonly workspaceId: string;
      readonly databasePath: string;
    };
    diagnostics(): DataSuccessResult<
      import("../client/types.js").DataClientStorageFacts
    >;
    migrationStatus(): DataSuccessResult<
      import("../client/types.js").DataClientMigrationStatus
    >;
  };
}

function failClosed(message: string, cause?: unknown): never {
  throw new BrainDataAdapterError("BRAIN_INVALID", message, undefined, cause);
}

export function createBrainDataAdapter(client: DataClient): BrainDataAdapter {
  if (typeof client !== "object" || client === null) {
    failClosed("A Task 27 Data client is required.");
  }

  function assertUsable(): void {
    if (client.closed) {
      throw new BrainDataAdapterError(
        "BRAIN_CLOSED",
        "Bound client is closed and cannot answer Brain questions.",
      );
    }
  }

  function parsedReadRefs(): readonly {
    readonly space: string;
    readonly entity: string;
  }[] {
    if (client.authorization.mode === "local-operator") {
      return [{ space: "*", entity: "*" }];
    }
    return (client.authorization.capabilityRefs ?? []).flatMap((ref) => {
      const parts = ref.split(":");
      if (
        parts.length !== 4 ||
        parts[0] !== "data" ||
        parts[3] !== "read"
      ) {
        return [];
      }
      return [{ space: parts[1] as string, entity: parts[2] as string }];
    });
  }

  const readRefs = parsedReadRefs();

  function canRead(space: string, entity: string): boolean {
    return readRefs.some(
      (ref) =>
        (ref.space === "*" || ref.space === space) &&
        (ref.entity === "*" || ref.entity === entity),
    );
  }

  function canReadSpace(space: string): boolean {
    return readRefs.some(
      (ref) => ref.space === "*" || ref.space === space,
    );
  }

  function requireAnyRead(): void {
    assertUsable();
    if (readRefs.length === 0) {
      throw new BrainDataAdapterError(
        "BRAIN_PERMISSION_DENIED",
        "Brain has no host-granted Data read capability in this workspace.",
      );
    }
  }

  function requireReadSpace(space: string): void {
    assertUsable();
    if (!canReadSpace(space)) {
      throw new BrainDataAdapterError(
        "BRAIN_PERMISSION_DENIED",
        `Brain has no host-granted Data read capability in space '${space}'.`,
      );
    }
  }

  function requireRead(space: string, entity: string): void {
    assertUsable();
    if (!canRead(space, entity)) {
      throw new BrainDataAdapterError(
        "BRAIN_PERMISSION_DENIED",
        `Brain has no host-granted Data read capability for ${space}/${entity}.`,
      );
    }
  }

  function transactionReadable(transactionId: string): boolean {
    const receipts =
      client.provenance.listTransactionReceipts(transactionId).result;
    const targets = receipts.filter(
      (receipt) => receipt.spaceId !== null && receipt.entity !== null,
    );
    return (
      targets.length > 0 &&
      targets.every((receipt) =>
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
      transactionReadable(receipt.transactionId)
    );
  }

  function eventReadable(event: import("../provenance/index.js").DataEvent): boolean {
    if (event.spaceId !== null && event.entity !== null) {
      return canRead(event.spaceId, event.entity);
    }
    return (
      event.transactionId !== null &&
      transactionReadable(event.transactionId)
    );
  }

  function requireReadableReceipt(receipt: DataMutationReceipt): void {
    if (!receiptReadable(receipt)) {
      throw new BrainDataAdapterError(
        "BRAIN_PERMISSION_DENIED",
        "Brain cannot read provenance outside its host-granted Data entities.",
      );
    }
  }

  function provenanceFor<Result>(
    out: DataSuccessResult<Result>,
    count: number,
  ): BrainDataQuestionProvenance {
    return {
      answeredAt: new Date().toISOString(),
      scope: { ...out.scope },
      actor: { ...out.actor },
      authorization: { ...out.authorization },
      recordCount: count,
    };
  }

  return {
    get closed(): boolean {
      return client.closed;
    },
    spaces: {
      get(input: SpaceGetPayload) {
        requireReadSpace(input.spaceId);
        return client.spaces.get(input);
      },
      list() {
        requireAnyRead();
        const out = client.spaces.list();
        return {
          ...out,
          result: out.result.filter((space) => canReadSpace(space.spaceId)),
        };
      },
      summarize(input: SpaceGetPayload) {
        requireReadSpace(input.spaceId);
        const space = client.spaces.get(input);
        const schemas = client.schemas.list({ spaceId: input.spaceId });
        const readableSchemas = schemas.result.filter((schema) =>
          canRead(input.spaceId, schema.entity),
        );
        return {
          ...space,
          result: {
            space: space.result,
            schemaCount: readableSchemas.length,
          },
        };
      },
    },
    schemas: {
      get(input: SchemaGetPayload) {
        requireRead(input.spaceId, input.entity);
        return client.schemas.get(input);
      },
      list(input: SchemaListPayload) {
        requireReadSpace(input.spaceId);
        const out = client.schemas.list(input);
        return {
          ...out,
          result: out.result.filter((schema) =>
            canRead(input.spaceId, schema.entity),
          ),
        };
      },
      summarize(input: SchemaGetPayload) {
        requireRead(input.spaceId, input.entity);
        const schema = client.schemas.get(input);
        return {
          ...schema,
          result: {
            summary: {
              spaceId: schema.result.spaceId,
              entity: schema.result.entity,
              name: schema.result.name,
              schemaVersion: schema.result.schemaVersion,
              schemaDigest: schema.result.schemaDigest,
              fieldCount: Object.keys(schema.result.fields).length,
              entityUpdatedAt: schema.result.versionCreatedAt,
            },
            currentVersion: schema.result.schemaVersion,
          },
        };
      },
    },
    records: {
      get(input: RecordGetPayload) {
        requireRead(input.spaceId, input.entity);
        const out = client.records.get(input);
        return {
          ...out,
          result: {
            record: out.result,
            provenance: provenanceFor(out, 1),
          },
        };
      },
      list(input: RecordListPayload) {
        requireRead(input.spaceId, input.entity);
        const out = client.records.list(input);
        return {
          ...out,
          result: {
            records: out.result,
            provenance: provenanceFor(out, out.result.length),
          },
        };
      },
    },
    query: {
      ask(input: QueryPayload) {
        requireRead(input.spaceId, input.entity);
        const out = client.query.query(input);
        return {
          ...out,
          result: {
            page: out.result,
            provenance: provenanceFor(out, out.result.items.length),
          },
        };
      },
      summarize(input: AggregatePayload) {
        requireRead(input.spaceId, input.entity);
        const out = client.query.aggregate(input);
        return {
          ...out,
          result: {
            values: out.result.values,
            provenance: provenanceFor(out, Object.keys(out.result.values).length),
          },
        };
      },
    },
    provenance: {
      listEvents(input?: EventsListPayload) {
        assertUsable();
        if (input?.spaceId !== undefined && input.entity !== undefined) {
          requireRead(input.spaceId, input.entity);
        } else if (input?.spaceId !== undefined) {
          requireReadSpace(input.spaceId);
        } else {
          requireAnyRead();
        }
        const out = client.provenance.listEvents(input);
        const page = {
          ...out.result,
          items: out.result.items.filter(eventReadable),
        };
        return {
          ...out,
          result: {
            page,
            provenance: provenanceFor(out, page.items.length),
          },
        };
      },
      getReceipt(receiptId: string) {
        assertUsable();
        const out = client.provenance.getReceipt(receiptId);
        requireReadableReceipt(out.result);
        return {
          ...out,
          result: {
            receipt: out.result,
            provenance: provenanceFor(out, 1),
          },
        };
      },
      getReceiptByIdempotencyKey(idempotencyKey: string) {
        assertUsable();
        const out = client.provenance.getReceiptByIdempotencyKey(
          idempotencyKey,
        );
        requireReadableReceipt(out.result);
        return {
          ...out,
          result: {
            receipt: out.result,
            provenance: provenanceFor(out, 1),
          },
        };
      },
    },
    health: {
      metadata() {
        requireAnyRead();
        return client.health.metadata();
      },
      diagnostics() {
        requireAnyRead();
        return client.health.diagnostics();
      },
      migrationStatus() {
        requireAnyRead();
        return client.health.migrationStatus();
      },
    },
  };
}
