import type { DataClient } from "../client/index.js";
import type { RecordGetPayload } from "../protocol/index.js";
import { isDataRecordError } from "../records/index.js";
import {
  createDashboardProjection as createBaseDashboardProjection,
  type DashboardProjection,
  type DashboardResolvedReference,
} from "./adapter.js";

export function createDashboardProjection(client: DataClient): DashboardProjection {
  const base = createBaseDashboardProjection(client);

  const secured: DashboardProjection = {
    ...base,
    records: {
      ...base.records,
      detail(input: RecordGetPayload) {
        const out = client.records.get(input);
        const schema = client.schemas.get({
          spaceId: input.spaceId,
          entity: input.entity,
        });
        const fields = schema.result.fields as unknown as Record<
          string,
          { type?: unknown; entity?: unknown; spaceId?: unknown }
        >;
        const data = out.result.data as unknown as Record<string, unknown>;
        const references: DashboardResolvedReference[] = [];

        for (const [name, definition] of Object.entries(fields)) {
          if (definition.type !== "reference") continue;
          const targetId = data[name];
          if (typeof targetId !== "string") {
            references.push({ field: name, target: null });
            continue;
          }
          const targetEntity =
            typeof definition.entity === "string" ? definition.entity : input.entity;
          const targetSpace =
            typeof definition.spaceId === "string" ? definition.spaceId : input.spaceId;
          try {
            const target = client.records.get({
              spaceId: targetSpace,
              entity: targetEntity,
              recordId: targetId,
            }).result;
            references.push({ field: name, target });
          } catch (error) {
            if (isDataRecordError(error) && error.code === "RECORD_NOT_FOUND") {
              references.push({ field: name, target: null });
              continue;
            }
            throw error;
          }
        }

        return {
          ...out,
          result: {
            record: out.result,
            references,
            provenance: {
              generatedAt: new Date().toISOString(),
              scope: { ...out.scope },
              actor: { ...out.actor },
              authorization: { ...out.authorization },
              recordCount: 1,
            },
          },
        };
      },
    },
  };

  Object.defineProperty(secured, "closed", {
    get: () => base.closed,
    enumerable: true,
    configurable: false,
  });
  return secured;
}
