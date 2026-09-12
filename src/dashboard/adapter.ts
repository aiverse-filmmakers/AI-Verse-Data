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
import { DashboardProjectionError } from "./errors.js";

export interface DashboardProjectionProvenance {
  readonly generatedAt: string;
  readonly scope: DataScope;
  readonly actor: DataActor;
  readonly authorization: DataAuthorization;
  readonly recordCount: number;
}

export interface DashboardSpaceCard {
  readonly space: DataSpaceSnapshot;
  readonly schemaCount: number;
}

export interface DashboardTableView {
  readonly schema: EntitySchemaSnapshot;
  readonly page: DataQueryPage;
  readonly provenance: DashboardProjectionProvenance;
}

export interface DashboardFormDescriptor {
  readonly spaceId: string;
  readonly entity: string;
  readonly name: string;
  readonly schemaVersion: number;
  readonly fields: readonly DashboardFormField[];
}

export interface DashboardFormField {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly default: unknown;
}

export interface DashboardRecordDetail {
  readonly record: DataRecordSnapshot;
  readonly references: readonly DashboardResolvedReference[];
  readonly provenance: DashboardProjectionProvenance;
}

export interface DashboardResolvedReference {
  readonly field: string;
  readonly target: DataRecordSnapshot | null;
}

export interface DashboardChart {
  readonly values: DataAggregateResult["values"];
  readonly provenance: DashboardProjectionProvenance;
}

export interface DashboardEventHistory {
  readonly page: DataEventPage;
  readonly provenance: DashboardProjectionProvenance;
}

export interface DashboardReceiptView {
  readonly receipt: DataMutationReceipt;
  readonly provenance: DashboardProjectionProvenance;
}

export interface DashboardHealthSummary {
  readonly metadata: {
    readonly driverKind: string;
    readonly scopeKind: "standalone" | "workspace";
    readonly workspaceId: string;
  };
  readonly diagnostics: import("../client/types.js").DataClientStorageFacts;
  readonly integrity: import("../client/types.js").DataClientIntegrity;
  readonly migration: import("../client/types.js").DataClientMigrationStatus;
  readonly provenance: DashboardProjectionProvenance;
}

export interface DashboardProjection {
  readonly closed: boolean;
  readonly spaces: {
    get(
      input: SpaceGetPayload,
    ): DataSuccessResult<DataSpaceSnapshot>;
    list(): DataSuccessResult<readonly DataSpaceSnapshot[]>;
    card(
      input: SpaceGetPayload,
    ): DataSuccessResult<DashboardSpaceCard>;
  };
  readonly schemas: {
    get(input: SchemaGetPayload): DataSuccessResult<EntitySchemaSnapshot>;
    list(
      input: SchemaListPayload,
    ): DataSuccessResult<readonly EntitySchemaSummary[]>;
    form(input: SchemaGetPayload): DataSuccessResult<DashboardFormDescriptor>;
  };
  readonly tables: {
    view(input: {
      readonly spaceId: string;
      readonly entity: string;
      readonly where?: QueryPayload["where"];
      readonly orderBy?: QueryPayload["orderBy"];
      readonly limit?: number;
      readonly cursor?: string | null;
    }): DataSuccessResult<DashboardTableView>;
  };
  readonly records: {
    detail(input: RecordGetPayload): DataSuccessResult<DashboardRecordDetail>;
    list(input: RecordListPayload): DataSuccessResult<readonly DataRecordSnapshot[]>;
  };
  readonly charts: {
    aggregate(
      input: AggregatePayload,
    ): DataSuccessResult<DashboardChart>;
  };
  readonly events: {
    history(
      input?: EventsListPayload,
    ): DataSuccessResult<DashboardEventHistory>;
  };
  readonly receipts: {
    get(receiptId: string): DataSuccessResult<DashboardReceiptView>;
    byKey(idempotencyKey: string): DataSuccessResult<DashboardReceiptView>;
  };
  readonly health: {
    summary(): DataSuccessResult<DashboardHealthSummary>;
  };
}

function failInvalid(message: string, cause?: unknown): never {
  throw new DashboardProjectionError(
    "DASHBOARD_INVALID",
    message,
    undefined,
    cause,
  );
}

export function createDashboardProjection(
  client: DataClient,
): DashboardProjection {
  if (typeof client !== "object" || client === null) {
    failInvalid("A Task 27 Data client is required.");
  }

  function assertUsable(): void {
    if (client.closed) {
      throw new DashboardProjectionError(
        "DASHBOARD_CLOSED",
        "Bound client is closed and cannot serve Dashboard projections.",
      );
    }
  }

  function provenanceFor<Result>(
    out: DataSuccessResult<Result>,
    count: number,
  ): DashboardProjectionProvenance {
    return {
      generatedAt: new Date().toISOString(),
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
      card(input: SpaceGetPayload) {
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
      form(input: SchemaGetPayload) {
        assertUsable();
        const schema = client.schemas.get(input);
        const fields = Object.entries(
          schema.result.fields as unknown as Record<
            string,
            { type?: unknown; required?: unknown; default?: unknown }
          >,
        ).map(([name, definition]) => ({
          name,
          type:
            typeof definition.type === "string" ? definition.type : "unknown",
          required: definition.required === true,
          default: (definition.default ?? null) as unknown,
        }));
        return {
          ...schema,
          result: {
            spaceId: schema.result.spaceId,
            entity: schema.result.entity,
            name: schema.result.name,
            schemaVersion: schema.result.schemaVersion,
            fields,
          },
        };
      },
    },
    tables: {
      view(input: {
        readonly spaceId: string;
        readonly entity: string;
        readonly where?: QueryPayload["where"];
        readonly orderBy?: QueryPayload["orderBy"];
        readonly limit?: number;
        readonly cursor?: string | null;
      }) {
        assertUsable();
        const schema = client.schemas.get({
          spaceId: input.spaceId,
          entity: input.entity,
        });
        const page = client.query.query({
          spaceId: input.spaceId,
          entity: input.entity,
          ...(input.where === undefined ? {} : { where: input.where }),
          ...(input.orderBy === undefined ? {} : { orderBy: input.orderBy }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.cursor === undefined || input.cursor === null
            ? {}
            : { cursor: input.cursor }),
        });
        return {
          ...page,
          result: {
            schema: schema.result,
            page: page.result,
            provenance: provenanceFor(page, page.result.items.length),
          },
        };
      },
    },
    records: {
      detail(input: RecordGetPayload) {
        assertUsable();
        const out = client.records.get(input);
        const schema = client.schemas.get({
          spaceId: input.spaceId,
          entity: input.entity,
        });
        const fields = schema.result.fields as unknown as Record<
          string,
          { type?: unknown; entity?: unknown; space?: unknown }
        >;
        const references: DashboardResolvedReference[] = [];
        const data = out.result.data as unknown as Record<string, unknown>;
        for (const [name, definition] of Object.entries(fields)) {
          if (definition.type !== "reference") continue;
          const targetId = data[name];
          if (typeof targetId !== "string") {
            references.push({ field: name, target: null });
            continue;
          }
          const targetEntity =
            typeof definition.entity === "string"
              ? definition.entity
              : input.entity;
          const targetSpace =
            typeof definition.space === "string"
              ? definition.space
              : input.spaceId;
          try {
            const target = client.records.get({
              spaceId: targetSpace,
              entity: targetEntity,
              recordId: targetId,
            }).result;
            references.push({ field: name, target });
          } catch {
            references.push({ field: name, target: null });
          }
        }
        return {
          ...out,
          result: {
            record: out.result,
            references,
            provenance: provenanceFor(out, 1),
          },
        };
      },
      list(input: RecordListPayload) {
        assertUsable();
        return client.records.list(input);
      },
    },
    charts: {
      aggregate(input: AggregatePayload) {
        assertUsable();
        const out = client.query.aggregate(input);
        return {
          ...out,
          result: {
            values: out.result.values,
            provenance: provenanceFor(
              out,
              Object.keys(out.result.values).length,
            ),
          },
        };
      },
    },
    events: {
      history(input?: EventsListPayload) {
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
    },
    receipts: {
      get(receiptId: string) {
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
      byKey(idempotencyKey: string) {
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
      summary() {
        assertUsable();
        const diagnostics = client.health.diagnostics();
        const integrity = client.health.integrityCheck();
        const migration = client.health.migrationStatus();
        const meta = client.health.metadata();
        return {
          ...diagnostics,
          result: {
            metadata: {
              driverKind: meta.driverKind,
              scopeKind: meta.scopeKind,
              workspaceId: meta.workspaceId,
            },
            diagnostics: diagnostics.result,
            integrity: integrity.result,
            migration: migration.result,
            provenance: provenanceFor(diagnostics, 0),
          },
        };
      },
    },
  };
}
