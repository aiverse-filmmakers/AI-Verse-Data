import type { DataClient, DataSuccessResult } from "../client/index.js";
import type { BulkMutationOperation, EventsListPayload, TransactionExecutePayload } from "../protocol/index.js";
import type { DataMutationReceipt } from "../provenance/index.js";
import type { BulkExecuteParams } from "../client/types.js";
import { AppsDataError } from "./errors.js";
import {
  createAppsDataKit as createBaseAppsDataKit,
  type AppsDataKit,
  type AppsDataManifest,
} from "./kit.js";

function deny(message: string): never {
  throw new AppsDataError("APPS_PERMISSION_DENIED", message);
}

function invalid(message: string): never {
  throw new AppsDataError("APPS_INVALID", message);
}

function hasRead(kit: AppsDataKit, spaceId: string, entity: string): boolean {
  return kit.grant.spaces.some(
    (space) =>
      space.spaceId === spaceId &&
      space.capabilities.includes("read") &&
      (space.entities.includes("*") || space.entities.includes(entity)),
  );
}

function requireReceiptRead(kit: AppsDataKit, receipt: DataMutationReceipt): void {
  if (
    receipt.spaceId === null ||
    receipt.entity === null ||
    !hasRead(kit, receipt.spaceId, receipt.entity)
  ) {
    deny("App is not allowed to read provenance outside its granted space/entity scope.");
  }
}

function rejectDeleteOperations(
  operations: readonly { readonly operation: string }[],
): void {
  if (operations.some((operation) => operation.operation === "data.record.delete")) {
    deny("Delete is never granted to Apps, including through transactions or bulk operations.");
  }
}

function validateManifestShape(manifest: AppsDataManifest): void {
  const raw = manifest as unknown as Record<string, unknown>;
  const data = raw["data"];
  if (typeof data !== "object" || data === null) return;
  const spaces = (data as Record<string, unknown>)["spaces"];
  if (typeof spaces !== "object" || spaces === null) return;
  for (const [spaceId, entry] of Object.entries(spaces as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      invalid(`Manifest space '${spaceId}' must be an object containing schemas.`);
    }
  }
}

export function createAppsDataKit(
  client: DataClient,
  manifest: AppsDataManifest,
  options?: { readonly schemaOrigins?: Readonly<Record<string, string>> },
): AppsDataKit {
  validateManifestShape(manifest);
  const base = createBaseAppsDataKit(client, manifest, options);

  return {
    ...base,
    transactions: {
      execute(input: TransactionExecutePayload) {
        rejectDeleteOperations(input.operations);
        return base.transactions.execute(input);
      },
      executeWithReceipt(input: TransactionExecutePayload) {
        rejectDeleteOperations(input.operations);
        return base.transactions.executeWithReceipt(input);
      },
    },
    bulk: {
      preview(operations: readonly BulkMutationOperation[]) {
        rejectDeleteOperations(operations);
        return base.bulk.preview(operations);
      },
      execute(input: BulkExecuteParams) {
        rejectDeleteOperations(input.operations);
        return base.bulk.execute(input);
      },
    },
    provenance: {
      listEvents(input?: EventsListPayload) {
        const out = base.provenance.listEvents(input);
        const items = out.result.items.filter(
          (event) =>
            event.spaceId !== null &&
            event.entity !== null &&
            hasRead(base, event.spaceId, event.entity),
        );
        return {
          ...out,
          result: {
            ...out.result,
            items,
          },
        } as DataSuccessResult<typeof out.result>;
      },
      getReceipt(receiptId: string) {
        const out = base.provenance.getReceipt(receiptId);
        requireReceiptRead(base, out.result);
        return out;
      },
      getReceiptByIdempotencyKey(idempotencyKey: string) {
        const out = base.provenance.getReceiptByIdempotencyKey(idempotencyKey);
        requireReceiptRead(base, out.result);
        return out;
      },
    },
  };
}
