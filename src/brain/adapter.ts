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
        assertUsable();
        return client.spaces.get(input);
      },
      list() {
        assertUsable();
        return client.spaces.list();
      },
      summarize(input: SpaceGetPayload) {
        assertUsable();
        const space = client.spaces.get(input);
        const schemas = client.schemas.list({ spaceId: input.spaceId });
        return {
          ...space,
          result: {
            space: space.result,
            schemaCount: schemas.result.length,
          },
        };
      },
    },
    schemas: {
      get(input: SchemaGetPayload) {
        assertUsable();
        return client.schemas.get(input);
      },
      list(input: SchemaListPayload) {
        assertUsable();
        return client.schemas.list(input);
      },
      summarize(input: SchemaGetPayload) {
        assertUsable();
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
        assertUsable();
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
        assertUsable();
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
        assertUsable();
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
        assertUsable();
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
        const out = client.provenance.listEvents(input);
        return {
          ...out,
          result: {
            page: out.result,
            provenance: provenanceFor(out, out.result.items.length),
          },
        };
      },
      getReceipt(receiptId: string) {
        assertUsable();
        const out = client.provenance.getReceipt(receiptId);
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
        return client.health.metadata();
      },
      diagnostics() {
        assertUsable();
        return client.health.diagnostics();
      },
      migrationStatus() {
        assertUsable();
        return client.health.migrationStatus();
      },
    },
  };
}
