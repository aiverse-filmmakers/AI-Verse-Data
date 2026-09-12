import type { DataClient } from "../client/index.js";
import { DataProvenanceError } from "../provenance/errors.js";
import {
  createAutomationEvents as createBaseAutomationEvents,
  type AutomationEvents,
} from "./events.js";

export function createAutomationEvents(client: DataClient): AutomationEvents {
  const base = createBaseAutomationEvents(client);
  return {
    ...base,
    events: {
      poll(filter, cursor) {
        const out = base.events.poll(filter, cursor);
        const envelopes = out.result.envelopes.map((envelope) => {
          if (envelope.receipt !== null) return envelope;
          try {
            const receipt = client.provenance.getReceiptByIdempotencyKey(
              envelope.event.idempotencyKey,
            ).result;
            return { ...envelope, receipt };
          } catch (error) {
            if (
              error instanceof DataProvenanceError &&
              error.code === "RECEIPT_NOT_FOUND"
            ) {
              return envelope;
            }
            throw error;
          }
        });
        return {
          ...out,
          result: {
            ...out.result,
            envelopes,
          },
        };
      },
    },
  };
}
