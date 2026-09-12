import type { DataClient } from "../client/index.js";
import type { EventsListPayload } from "../protocol/index.js";
import type { DataMutationReceipt } from "../provenance/index.js";
import {
  createBotsDataAdapter as createBaseBotsDataAdapter,
  type BotsDataAdapter,
} from "./adapter.js";
import {
  BotsDataAdapterError,
  type BotsDataCapabilityLease,
} from "./errors.js";

function invalid(message: string): never {
  throw new BotsDataAdapterError("LEASE_INVALID", message);
}

function denied(message: string): never {
  throw new BotsDataAdapterError("CAPABILITY_DENIED", message);
}

function validatePrincipalShape(lease: BotsDataCapabilityLease): void {
  if (typeof lease !== "object" || lease === null || Array.isArray(lease)) {
    invalid("Lease must be a host-passed trusted object.");
  }
  const principal = (lease as unknown as Record<string, unknown>)["principal"];
  if (typeof principal !== "object" || principal === null || Array.isArray(principal)) {
    invalid("Lease principal must be { kind: bot|worker, id }.");
  }
}

function hasRead(
  lease: BotsDataCapabilityLease,
  spaceId: string,
  entity: string,
): boolean {
  return lease.capabilities.some((raw) => {
    const parts = raw.split(":");
    if (parts.length !== 4 || parts[0] !== "data" || parts[3] !== "read") {
      return false;
    }
    return (parts[1] === "*" || parts[1] === spaceId) &&
      (parts[2] === "*" || parts[2] === entity);
  });
}

function requireReceiptRead(
  lease: BotsDataCapabilityLease,
  receipt: DataMutationReceipt,
): void {
  if (
    receipt.spaceId === null ||
    receipt.entity === null ||
    !hasRead(lease, receipt.spaceId, receipt.entity)
  ) {
    denied("Capability lease does not permit reading provenance for this space/entity.");
  }
}

export function createBotsDataAdapter(
  client: DataClient,
  lease: BotsDataCapabilityLease,
): BotsDataAdapter {
  validatePrincipalShape(lease);
  const base = createBaseBotsDataAdapter(client, lease);

  return {
    ...base,
    provenance: {
      listEvents(input?: EventsListPayload) {
        const out = base.provenance.listEvents(input);
        return {
          ...out,
          result: {
            ...out.result,
            items: out.result.items.filter(
              (event) =>
                event.spaceId !== null &&
                event.entity !== null &&
                hasRead(lease, event.spaceId, event.entity),
            ),
          },
        };
      },
      getReceipt(receiptId: string) {
        const out = base.provenance.getReceipt(receiptId);
        requireReceiptRead(lease, out.result);
        return out;
      },
      getReceiptByIdempotencyKey(idempotencyKey: string) {
        const out = base.provenance.getReceiptByIdempotencyKey(idempotencyKey);
        requireReceiptRead(lease, out.result);
        return out;
      },
      listTransactionReceipts(transactionId: string) {
        const out = base.provenance.listTransactionReceipts(transactionId);
        return {
          ...out,
          result: out.result.filter(
            (receipt) =>
              receipt.spaceId !== null &&
              receipt.entity !== null &&
              hasRead(lease, receipt.spaceId, receipt.entity),
          ),
        };
      },
    },
  };
}
