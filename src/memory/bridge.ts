import type { DataClient, DataSuccessResult } from "../client/index.js";
import type {
  AggregatePayload,
  DataActor,
  DataAuthorization,
  DataScope,
  QueryPayload,
  RecordGetPayload,
} from "../protocol/index.js";
import type {
  DataAggregateResult,
  DataQueryPage,
} from "../query/index.js";
import type { DataRecordSnapshot } from "../records/index.js";
import type {
  DataEvent,
  DataMutationReceipt,
} from "../provenance/index.js";
import { MemoryBridgeError } from "./errors.js";

export type MemoryCandidateKind =
  | "record_reference"
  | "event_reference"
  | "aggregate_summary";

export interface DataProvenanceReference {
  readonly sourceType: "ai-verse-data";
  readonly workspaceId: string;
  readonly spaceId: string;
  readonly entity: string | null;
  readonly recordId: string | null;
  readonly recordVersion: number | null;
  readonly eventId: string | null;
  readonly receiptId: string | null;
  readonly uri: string;
}

export interface MemoryEvidenceRecord {
  readonly reference: DataProvenanceReference;
  readonly record: DataRecordSnapshot;
  readonly receipt: DataMutationReceipt | null;
}

export interface MemoryEvidenceEvent {
  readonly reference: DataProvenanceReference;
  readonly event: DataEvent;
}

export interface MemoryCandidate {
  readonly kind: MemoryCandidateKind;
  readonly reference: DataProvenanceReference;
  readonly title: string;
  readonly summary: string;
  readonly recordCount: number;
  readonly scope: DataScope;
  readonly actor: DataActor;
  readonly authorization: DataAuthorization;
  readonly proposedAt: string;
  readonly expiresAt: string | null;
}

export interface MemoryEvidenceQuery {
  readonly spaceId: string;
  readonly entity: string;
  readonly recordId: string;
  readonly includeReceipt?: boolean;
  readonly idempotencyKey?: string;
  readonly eventId?: string | null;
  readonly receiptId?: string | null;
}

export interface MemoryEventEvidenceQuery {
  readonly eventId?: string;
  readonly receiptId?: string;
  readonly idempotencyKey?: string;
}

export interface MemoryBridge {
  readonly closed: boolean;
  readonly references: {
    forRecord(input: {
      readonly spaceId: string;
      readonly entity: string;
      readonly recordId: string;
      readonly recordVersion?: number | null;
      readonly eventId?: string | null;
      readonly receiptId?: string | null;
    }): DataProvenanceReference;
    parse(
      uri: string,
    ): DataProvenanceReference;
  };
  readonly evidence: {
    lookupRecord(
      input: MemoryEvidenceQuery,
    ): DataSuccessResult<MemoryEvidenceRecord>;
    lookupEvent(
      input: MemoryEventEvidenceQuery,
    ): DataSuccessResult<MemoryEvidenceEvent>;
    lookupByReference(
      reference: DataProvenanceReference | string,
    ): DataSuccessResult<MemoryEvidenceRecord | MemoryEvidenceEvent>;
  };
  readonly candidates: {
    proposeRecordCandidate(input: {
      readonly spaceId: string;
      readonly entity: string;
      readonly recordId: string;
      readonly title: string;
      readonly summary: string;
      readonly expiresAt?: string | null;
    }): DataSuccessResult<MemoryCandidate>;
    proposeEventCandidate(input: {
      readonly eventId?: string;
      readonly receiptId?: string;
      readonly idempotencyKey?: string;
      readonly title: string;
      readonly summary: string;
      readonly expiresAt?: string | null;
    }): DataSuccessResult<MemoryCandidate>;
    proposeAggregateCandidate(input: {
      readonly query: QueryPayload;
      readonly aggregate: AggregatePayload;
      readonly title: string;
      readonly summary: string;
      readonly expiresAt?: string | null;
    }): DataSuccessResult<MemoryCandidate>;
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

const SLUG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const WORKSPACE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_ID_LENGTH = 128;
const MAX_TEXT_LENGTH = 4096;
const URI_RE =
  /^data:\/\/([^/]+)\/([^/]+)\/([^/]+)\/([^?@#]+)(?:@([0-9]+))?(?:\?(.*))?$/;

function failInvalid(message: string, cause?: unknown): never {
  throw new MemoryBridgeError("MEMORY_INVALID", message, undefined, cause);
}

function checkSlug(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 64 ||
    !SLUG_RE.test(value)
  ) {
    failInvalid(`${field} must be a lowercase Data identifier slug.`);
  }
  return value;
}

function checkRecordId(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_ID_LENGTH ||
    value === "." ||
    value === ".." ||
    !SAFE_ID_RE.test(value)
  ) {
    failInvalid(`${field} must be a safe identifier.`);
  }
  return value;
}

function checkVersion(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    failInvalid("recordVersion must be a positive integer when present.");
  }
  return value as number;
}

function checkOpaqueId(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "string" ||
    value.length < 5 ||
    value.length > MAX_ID_LENGTH ||
    value.includes("\u0000")
  ) {
    failInvalid(`${field} must be a non-empty opaque identifier.`);
  }
  return value;
}

function checkText(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_TEXT_LENGTH
  ) {
    failInvalid(`${field} must be 1..${MAX_TEXT_LENGTH} characters.`);
  }
  return value;
}

function checkExpiry(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "string" ||
    Number.isNaN(Date.parse(value))
  ) {
    failInvalid("expiresAt must be a valid timestamp when present.");
  }
  return value;
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

function buildUri(input: {
  readonly workspaceId: string;
  readonly spaceId: string;
  readonly entity: string;
  readonly recordId: string;
  readonly recordVersion: number | null;
  readonly eventId: string | null;
  readonly receiptId: string | null;
}): string {
  const base = `data://${encodeSegment(input.workspaceId)}/${encodeSegment(input.spaceId)}/${encodeSegment(input.entity)}/${encodeSegment(input.recordId)}`;
  const version = input.recordVersion === null ? "" : `@${input.recordVersion}`;
  const params = new URLSearchParams();
  if (input.eventId !== null) params.set("event", input.eventId);
  if (input.receiptId !== null) params.set("receipt", input.receiptId);
  const suffix = params.size === 0 ? "" : `?${params.toString()}`;
  return `${base}${version}${suffix}`;
}

function parseUri(uri: string): DataProvenanceReference {
  if (typeof uri !== "string" || uri.length > 4096 || !uri.startsWith("data://")) {
    failInvalid("Reference URI must start with data://.");
  }
  const match = URI_RE.exec(uri);
  if (match === null) {
    failInvalid(
      "Reference URI must match data://<workspace>/<space>/<entity>/<record>[@version][?event=&receipt=].",
    );
  }
  const workspaceId = decodeURIComponent(match[1] as string);
  const spaceId = decodeURIComponent(match[2] as string);
  const entity = decodeURIComponent(match[3] as string);
  const recordId = decodeURIComponent(match[4] as string);
  if (
    workspaceId.length < 1 ||
    workspaceId.length > MAX_ID_LENGTH ||
    !WORKSPACE_RE.test(workspaceId)
  ) {
    failInvalid("Reference workspaceId is invalid.");
  }
  checkSlug(spaceId, "reference spaceId");
  checkSlug(entity, "reference entity");
  checkRecordId(recordId, "reference recordId");
  const recordVersion =
    match[5] === undefined ? null : Number.parseInt(match[5], 10);
  if (
    match[5] !== undefined &&
    (!Number.isSafeInteger(recordVersion) || (recordVersion as number) < 1)
  ) {
    failInvalid("Reference recordVersion must be a positive integer.");
  }
  let eventId: string | null = null;
  let receiptId: string | null = null;
  if (match[6] !== undefined) {
    const params = new URLSearchParams(match[6]);
    for (const key of params.keys()) {
      if (key !== "event" && key !== "receipt") {
        failInvalid("Reference query may only carry event and receipt.");
      }
    }
    eventId = checkOpaqueId(params.get("event"), "reference event");
    receiptId = checkOpaqueId(params.get("receipt"), "reference receipt");
  }
  return {
    sourceType: "ai-verse-data",
    workspaceId,
    spaceId,
    entity,
    recordId,
    recordVersion: (recordVersion ?? null) as number | null,
    eventId,
    receiptId,
    uri,
  };
}

export function createMemoryBridge(client: DataClient): MemoryBridge {
  if (typeof client !== "object" || client === null) {
    failInvalid("A Task 27 Data client is required.");
  }

  function assertUsable(): void {
    if (client.closed) {
      throw new MemoryBridgeError(
        "MEMORY_CLOSED",
        "Bound client is closed and cannot serve Memory evidence.",
      );
    }
  }

  function workspaceId(): string {
    return client.scope.workspaceId;
  }

  function forRecord(input: {
    readonly spaceId: string;
    readonly entity: string;
    readonly recordId: string;
    readonly recordVersion?: number | null;
    readonly eventId?: string | null;
    readonly receiptId?: string | null;
  }): DataProvenanceReference {
    const spaceId = checkSlug(input.spaceId, "spaceId");
    const entity = checkSlug(input.entity, "entity");
    const recordId = checkRecordId(input.recordId, "recordId");
    const recordVersion = checkVersion(input.recordVersion ?? null);
    const eventId = checkOpaqueId(input.eventId ?? null, "eventId");
    const receiptId = checkOpaqueId(input.receiptId ?? null, "receiptId");
    const uri = buildUri({
      workspaceId: workspaceId(),
      spaceId,
      entity,
      recordId,
      recordVersion,
      eventId,
      receiptId,
    });
    return {
      sourceType: "ai-verse-data",
      workspaceId: workspaceId(),
      spaceId,
      entity,
      recordId,
      recordVersion,
      eventId,
      receiptId,
      uri,
    };
  }

  function resolveReference(
    reference: DataProvenanceReference | string,
  ): DataProvenanceReference {
    const parsed =
      typeof reference === "string" ? parseUri(reference) : reference;
    if (parsed.workspaceId !== workspaceId()) {
      failInvalid(
        `Reference workspace '${parsed.workspaceId}' does not match bridge workspace '${workspaceId()}'. Cross-workspace evidence is denied.`,
      );
    }
    return parsed;
  }

  function recordEvidence(
    reference: DataProvenanceReference,
    includeReceipt: boolean,
    idempotencyKey?: string,
  ): DataSuccessResult<MemoryEvidenceRecord> {
    assertUsable();
    const getInput: RecordGetPayload = {
      spaceId: reference.spaceId,
      entity: reference.entity as string,
      recordId: reference.recordId as string,
    };
    const out = client.records.get(getInput);
    let receipt: DataMutationReceipt | null = null;
    if (includeReceipt) {
      if (idempotencyKey !== undefined) {
        receipt = client.provenance.getReceiptByIdempotencyKey(
          idempotencyKey,
        ).result;
      } else if (reference.receiptId !== null) {
        try {
          receipt = client.provenance.getReceipt(reference.receiptId).result;
        } catch {
          receipt = null;
        }
      } else if (reference.eventId !== null) {
        const event = client.provenance.getEvent(reference.eventId).result;
        if (
          event.spaceId !== reference.spaceId ||
          event.entity !== reference.entity ||
          event.recordId !== reference.recordId
        ) {
          failInvalid(
            "Reference event does not belong to the referenced record.",
          );
        }
        receipt = client.provenance.getReceiptByIdempotencyKey(
          event.idempotencyKey,
        ).result;
      }
    }
    return {
      ...out,
      result: {
        reference,
        record: out.result,
        receipt,
      },
    };
  }

  function eventEvidence(
    event: DataEvent,
  ): DataSuccessResult<MemoryEvidenceEvent> {
    const reference = forRecord({
      spaceId: event.spaceId ?? "unknown",
      entity: event.entity ?? "unknown",
      recordId: event.recordId ?? "unknown",
      recordVersion: event.afterVersion,
      eventId: event.eventId,
      receiptId: null,
    });
    const scopeOut = client.spaces.list();
    return {
      ...scopeOut,
      result: { reference, event },
    };
  }

  return {
    get closed(): boolean {
      return client.closed;
    },
    references: {
      forRecord,
      parse(uri: string) {
        return resolveReference(uri);
      },
    },
    evidence: {
      lookupRecord(input: MemoryEvidenceQuery) {
        const reference = forRecord({
          spaceId: input.spaceId,
          entity: input.entity,
          recordId: input.recordId,
          ...(input.eventId === undefined ? {} : { eventId: input.eventId }),
          ...(input.receiptId === undefined
            ? {}
            : { receiptId: input.receiptId }),
        });
        return recordEvidence(
          reference,
          input.includeReceipt ?? false,
          input.idempotencyKey,
        );
      },
      lookupEvent(input: MemoryEventEvidenceQuery) {
        assertUsable();
        const provided = [
          input.eventId,
          input.receiptId,
          input.idempotencyKey,
        ].filter((value) => value !== undefined);
        if (provided.length !== 1) {
          failInvalid(
            "Exactly one of eventId, receiptId, or idempotencyKey is required.",
          );
        }
        if (input.eventId !== undefined) {
          const id = checkOpaqueId(input.eventId, "eventId") as string;
          return eventEvidence(client.provenance.getEvent(id).result);
        }
        if (input.receiptId !== undefined) {
          const id = checkOpaqueId(input.receiptId, "receiptId") as string;
          const receipt = client.provenance.getReceipt(id).result;
          return eventEvidence(
            client.provenance.getEvent(receipt.eventId).result,
          );
        }
        const key = checkOpaqueId(
          input.idempotencyKey as string,
          "idempotencyKey",
        ) as string;
        const receipt =
          client.provenance.getReceiptByIdempotencyKey(key).result;
        return eventEvidence(
          client.provenance.getEvent(receipt.eventId).result,
        );
      },
      lookupByReference(reference: DataProvenanceReference | string) {
        assertUsable();
        const resolved = resolveReference(reference);
        if (resolved.eventId !== null && resolved.recordId === "unknown") {
          return eventEvidence(
            client.provenance.getEvent(resolved.eventId).result,
          ) as DataSuccessResult<
            MemoryEvidenceRecord | MemoryEvidenceEvent
          >;
        }
        return recordEvidence(resolved, true) as DataSuccessResult<
          MemoryEvidenceRecord | MemoryEvidenceEvent
        >;
      },
    },
    candidates: {
      proposeRecordCandidate(input: {
        readonly spaceId: string;
        readonly entity: string;
        readonly recordId: string;
        readonly title: string;
        readonly summary: string;
        readonly expiresAt?: string | null;
      }) {
        assertUsable();
        const recordOut = client.records.get({
          spaceId: checkSlug(input.spaceId, "spaceId"),
          entity: checkSlug(input.entity, "entity"),
          recordId: checkRecordId(input.recordId, "recordId"),
        });
        const reference = forRecord({
          spaceId: input.spaceId,
          entity: input.entity,
          recordId: input.recordId,
          recordVersion: recordOut.result.version,
        });
        const title = checkText(input.title, "title");
        const summary = checkText(input.summary, "summary");
        const expiresAt = checkExpiry(input.expiresAt ?? null);
        return {
          ...recordOut,
          result: {
            kind: "record_reference",
            reference,
            title,
            summary,
            recordCount: 1,
            scope: { ...recordOut.scope },
            actor: { ...recordOut.actor },
            authorization: { ...recordOut.authorization },
            proposedAt: new Date().toISOString(),
            expiresAt,
          },
        };
      },
      proposeEventCandidate(input: {
        readonly eventId?: string;
        readonly receiptId?: string;
        readonly idempotencyKey?: string;
        readonly title: string;
        readonly summary: string;
        readonly expiresAt?: string | null;
      }) {
        assertUsable();
        const provided = [
          input.eventId,
          input.receiptId,
          input.idempotencyKey,
        ].filter((value) => value !== undefined);
        if (provided.length !== 1) {
          failInvalid(
            "Exactly one of eventId, receiptId, or idempotencyKey is required.",
          );
        }
        let event: DataEvent;
        if (input.eventId !== undefined) {
          const id = checkOpaqueId(input.eventId, "eventId") as string;
          event = client.provenance.getEvent(id).result;
        } else if (input.receiptId !== undefined) {
          const id = checkOpaqueId(input.receiptId, "receiptId") as string;
          const receipt = client.provenance.getReceipt(id).result;
          event = client.provenance.getEvent(receipt.eventId).result;
        } else {
          const key = checkOpaqueId(
            input.idempotencyKey as string,
            "idempotencyKey",
          ) as string;
          const receipt =
            client.provenance.getReceiptByIdempotencyKey(key).result;
          event = client.provenance.getEvent(receipt.eventId).result;
        }
        const reference = forRecord({
          spaceId: event.spaceId ?? "unknown",
          entity: event.entity ?? "unknown",
          recordId: event.recordId ?? "unknown",
          recordVersion: event.afterVersion,
          eventId: event.eventId,
        });
        const out = client.spaces.list();
        return {
          ...out,
          result: {
            kind: "event_reference",
            reference,
            title: checkText(input.title, "title"),
            summary: checkText(input.summary, "summary"),
            recordCount: 1,
            scope: { ...out.scope },
            actor: { ...out.actor },
            authorization: { ...out.authorization },
            proposedAt: new Date().toISOString(),
            expiresAt: checkExpiry(input.expiresAt ?? null),
          },
        };
      },
      proposeAggregateCandidate(input: {
        readonly query: QueryPayload;
        readonly aggregate: AggregatePayload;
        readonly title: string;
        readonly summary: string;
        readonly expiresAt?: string | null;
      }) {
        assertUsable();
        const page: DataQueryPage = client.query.query(input.query).result;
        const aggregate: DataAggregateResult = client.query.aggregate(
          input.aggregate,
        ).result;
        const first = page.items[0];
        const reference =
          first === undefined
            ? forRecord({
                spaceId: input.query.spaceId,
                entity: input.query.entity,
                recordId: "unknown",
              })
            : forRecord({
                spaceId: first.spaceId,
                entity: first.entity,
                recordId: first.recordId,
                recordVersion: first.version,
              });
        void aggregate;
        const out = client.spaces.list();
        return {
          ...out,
          result: {
            kind: "aggregate_summary",
            reference,
            title: checkText(input.title, "title"),
            summary: checkText(input.summary, "summary"),
            recordCount: page.items.length,
            scope: { ...out.scope },
            actor: { ...out.actor },
            authorization: { ...out.authorization },
            proposedAt: new Date().toISOString(),
            expiresAt: checkExpiry(input.expiresAt ?? null),
          },
        };
      },
    },
    health: {
      metadata() {
        return client.health.metadata();
      },
    },
  };
}
