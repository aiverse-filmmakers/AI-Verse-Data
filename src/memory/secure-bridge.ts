import type { DataClient, DataSuccessResult } from "../client/index.js";
import type { DataEvent, DataMutationReceipt } from "../provenance/index.js";
import type { EventsListPayload } from "../protocol/index.js";
import { MemoryBridgeError } from "./errors.js";
import {
  createMemoryBridge as createBaseMemoryBridge,
  type DataProvenanceReference,
  type MemoryBridge,
  type MemoryCandidate,
  type MemoryEvidenceEvent,
  type MemoryEvidenceQuery,
  type MemoryEvidenceRecord,
  type MemoryEventEvidenceQuery,
} from "./bridge.js";

const MAX_TEXT_LENGTH = 4096;

function invalid(message: string, cause?: unknown): never {
  throw new MemoryBridgeError("MEMORY_INVALID", message, undefined, cause);
}

function checkText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > MAX_TEXT_LENGTH) {
    invalid(`${field} must be 1..${MAX_TEXT_LENGTH} characters.`);
  }
  return value;
}

function checkExpiry(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    invalid("expiresAt must be a valid timestamp when present.");
  }
  return value;
}

function checkOpaqueId(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length < 5 || value.length > 128 || value.includes("\u0000")) {
    invalid(`${field} must be a non-empty opaque identifier.`);
  }
  return value;
}

function findEvent(
  client: DataClient,
  eventId: string,
  filters: Omit<EventsListPayload, "after" | "limit"> = {},
): DataSuccessResult<DataEvent> {
  let after: string | null = null;
  for (;;) {
    const out = client.provenance.listEvents({ ...filters, after, limit: 200 });
    const found = out.result.items.find((event) => event.eventId === eventId);
    if (found !== undefined) return { ...out, result: found };
    if (!out.result.hasMore || out.result.nextCursor === null) {
      invalid(`Event '${eventId}' was not found in this workspace.`);
    }
    after = out.result.nextCursor;
  }
}

function receiptEvent(client: DataClient, receipt: DataMutationReceipt): DataSuccessResult<DataEvent> {
  return findEvent(client, receipt.eventId, {
    ...(receipt.spaceId === null ? {} : { spaceId: receipt.spaceId }),
    ...(receipt.entity === null ? {} : { entity: receipt.entity }),
    ...(receipt.recordId === null ? {} : { recordId: receipt.recordId }),
  });
}

export function createMemoryBridge(client: DataClient): MemoryBridge {
  const base = createBaseMemoryBridge(client);

  function eventEvidence(eventOut: DataSuccessResult<DataEvent>): DataSuccessResult<MemoryEvidenceEvent> {
    const event = eventOut.result;
    const reference = base.references.forRecord({
      spaceId: event.spaceId ?? "unknown",
      entity: event.entity ?? "unknown",
      recordId: event.recordId ?? "unknown",
      recordVersion: event.afterVersion,
      eventId: event.eventId,
    });
    return { ...eventOut, result: { reference, event } };
  }

  function lookupEvent(input: MemoryEventEvidenceQuery): DataSuccessResult<MemoryEvidenceEvent> {
    const provided = [input.eventId, input.receiptId, input.idempotencyKey].filter(
      (value) => value !== undefined,
    );
    if (provided.length !== 1) {
      invalid("Exactly one of eventId, receiptId, or idempotencyKey is required.");
    }
    if (input.eventId !== undefined) {
      return eventEvidence(findEvent(client, checkOpaqueId(input.eventId, "eventId")));
    }
    if (input.receiptId !== undefined) {
      const receipt = client.provenance.getReceipt(
        checkOpaqueId(input.receiptId, "receiptId"),
      ).result;
      return eventEvidence(receiptEvent(client, receipt));
    }
    const receipt = client.provenance.getReceiptByIdempotencyKey(
      checkOpaqueId(input.idempotencyKey, "idempotencyKey"),
    ).result;
    return eventEvidence(receiptEvent(client, receipt));
  }

  function lookupRecord(input: MemoryEvidenceQuery): DataSuccessResult<MemoryEvidenceRecord> {
    const recordOut = client.records.get({
      spaceId: input.spaceId,
      entity: input.entity,
      recordId: input.recordId,
    });
    let receipt: DataMutationReceipt | null = null;
    if (input.includeReceipt ?? false) {
      if (input.idempotencyKey !== undefined) {
        receipt = client.provenance.getReceiptByIdempotencyKey(input.idempotencyKey).result;
      } else if (input.receiptId !== undefined && input.receiptId !== null) {
        receipt = client.provenance.getReceipt(input.receiptId).result;
      } else if (input.eventId !== undefined && input.eventId !== null) {
        const event = findEvent(client, input.eventId, {
          spaceId: input.spaceId,
          entity: input.entity,
          recordId: input.recordId,
        }).result;
        receipt = client.provenance.getReceiptByIdempotencyKey(event.idempotencyKey).result;
      }
    }
    const reference = base.references.forRecord({
      spaceId: input.spaceId,
      entity: input.entity,
      recordId: input.recordId,
      recordVersion: recordOut.result.version,
      ...(input.eventId === undefined ? {} : { eventId: input.eventId }),
      ...(input.receiptId === undefined ? {} : { receiptId: input.receiptId }),
    });
    return { ...recordOut, result: { reference, record: recordOut.result, receipt } };
  }

  return {
    ...base,
    references: {
      ...base.references,
      parse(uri: string) {
        try {
          return base.references.parse(uri);
        } catch (error) {
          if (error instanceof URIError) {
            invalid("Reference URI contains invalid percent encoding.", error);
          }
          throw error;
        }
      },
    },
    evidence: {
      lookupRecord,
      lookupEvent,
      lookupByReference(reference: DataProvenanceReference | string) {
        let resolved: DataProvenanceReference;
        try {
          resolved = typeof reference === "string" ? base.references.parse(reference) : reference;
        } catch (error) {
          if (error instanceof URIError) {
            invalid("Reference URI contains invalid percent encoding.", error);
          }
          throw error;
        }
        if (resolved.workspaceId !== client.scope.workspaceId) {
          invalid(
            `Reference workspace '${resolved.workspaceId}' does not match bridge workspace '${client.scope.workspaceId}'. Cross-workspace evidence is denied.`,
          );
        }
        if (resolved.eventId !== null && resolved.recordId === "unknown") {
          return eventEvidence(findEvent(client, resolved.eventId)) as DataSuccessResult<
            MemoryEvidenceRecord | MemoryEvidenceEvent
          >;
        }
        return lookupRecord({
          spaceId: resolved.spaceId,
          entity: resolved.entity as string,
          recordId: resolved.recordId as string,
          includeReceipt: true,
          ...(resolved.eventId === null ? {} : { eventId: resolved.eventId }),
          ...(resolved.receiptId === null ? {} : { receiptId: resolved.receiptId }),
        }) as DataSuccessResult<MemoryEvidenceRecord | MemoryEvidenceEvent>;
      },
    },
    candidates: {
      ...base.candidates,
      proposeEventCandidate(input) {
        const evidenceOut = lookupEvent({
          ...(input.eventId === undefined ? {} : { eventId: input.eventId }),
          ...(input.receiptId === undefined ? {} : { receiptId: input.receiptId }),
          ...(input.idempotencyKey === undefined
            ? {}
            : { idempotencyKey: input.idempotencyKey }),
        });
        const result: MemoryCandidate = {
          kind: "event_reference",
          reference: evidenceOut.result.reference,
          title: checkText(input.title, "title"),
          summary: checkText(input.summary, "summary"),
          recordCount: 1,
          scope: { ...evidenceOut.scope },
          actor: { ...evidenceOut.actor },
          authorization: { ...evidenceOut.authorization },
          proposedAt: new Date().toISOString(),
          expiresAt: checkExpiry(input.expiresAt ?? null),
        };
        return { ...evidenceOut, result };
      },
    },
  };
}
