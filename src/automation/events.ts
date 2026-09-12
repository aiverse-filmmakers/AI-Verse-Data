import type { DataClient, DataSuccessResult } from "../client/index.js";
import type {
  DataActor,
  DataAuthorization,
  DataScope,
  EventsListPayload,
} from "../protocol/index.js";
import type {
  DataEvent,
  DataEventPage,
  DataMutationReceipt,
} from "../provenance/index.js";
import { AutomationEventsError } from "./errors.js";

export type AutomationEventType = DataEvent["eventType"];

export interface AutomationSubscriptionFilter {
  readonly spaceId?: string;
  readonly entity?: string;
  readonly recordId?: string;
  readonly eventTypes?: readonly AutomationEventType[];
}

export interface AutomationEventEnvelope {
  readonly event: DataEvent;
  readonly receipt: DataMutationReceipt | null;
  readonly scope: DataScope;
  readonly actor: DataActor;
  readonly authorization: DataAuthorization;
  readonly emittedAt: string;
  readonly cursor: string | null;
}

export interface AutomationEventsPage {
  readonly envelopes: readonly AutomationEventEnvelope[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export interface AutomationSubscription {
  readonly filter: Required<
    Pick<AutomationSubscriptionFilter, "spaceId" | "entity" | "recordId">
  > &
    Pick<AutomationSubscriptionFilter, "eventTypes"> & {
      readonly limit: number;
    };
  readonly cursor: string | null;
}

export interface AutomationEvents {
  readonly closed: boolean;
  readonly subscriptions: {
    describe(
      filter?: AutomationSubscriptionFilter,
    ): DataSuccessResult<AutomationSubscription>;
  };
  readonly events: {
    poll(
      filter?: AutomationSubscriptionFilter,
      cursor?: string | null,
    ): DataSuccessResult<AutomationEventsPage>;
  };
  readonly receipts: {
    get(receiptId: string): DataSuccessResult<DataMutationReceipt>;
    byKey(idempotencyKey: string): DataSuccessResult<DataMutationReceipt>;
  };
  readonly policy: {
    notice(): DataSuccessResult<{
      readonly rule: "no-scheduler-in-data";
      readonly detail: string;
    }>;
  };
}

const SLUG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const MAX_ID_LENGTH = 128;
const MAX_LIMIT = 200;
const EVENT_TYPES: readonly AutomationEventType[] = [
  "record.created",
  "record.updated",
  "record.deleted",
  "transaction.committed",
];

function fail(
  code: "AUTOMATION_INVALID" | "AUTOMATION_CLOSED",
  message: string,
): never {
  throw new AutomationEventsError(code, message);
}

function checkSlug(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 64 ||
    !SLUG_RE.test(value)
  ) {
    fail("AUTOMATION_INVALID", `${field} must be a lowercase Data slug.`);
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
    fail("AUTOMATION_INVALID", `${field} must be a safe identifier.`);
  }
  return value;
}

function checkLimit(value: unknown): number {
  if (value === undefined) return 100;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_LIMIT) {
    fail("AUTOMATION_INVALID", `limit must be an integer in 1..${MAX_LIMIT}.`);
  }
  return value as number;
}

function normalizeFilter(
  filter?: AutomationSubscriptionFilter,
): Required<Pick<AutomationSubscriptionFilter, "spaceId" | "entity" | "recordId">> &
  Pick<AutomationSubscriptionFilter, "eventTypes"> & { readonly limit: number } {
  if (filter === undefined) {
    return { spaceId: "*", entity: "*", recordId: "*", limit: 100 };
  }
  if (typeof filter !== "object" || filter === null) {
    fail("AUTOMATION_INVALID", "Subscription filter must be an object.");
  }
  const candidate = filter as Record<string, unknown>;
  const spaceId =
    candidate["spaceId"] === undefined
      ? "*"
      : checkSlug(candidate["spaceId"], "filter spaceId");
  const entity =
    candidate["entity"] === undefined
      ? "*"
      : checkSlug(candidate["entity"], "filter entity");
  const recordId =
    candidate["recordId"] === undefined
      ? "*"
      : checkRecordId(candidate["recordId"], "filter recordId");
  if (entity === "*" && recordId !== "*") {
    fail("AUTOMATION_INVALID", "recordId requires an entity filter.");
  }
  if (spaceId === "*" && entity !== "*") {
    fail("AUTOMATION_INVALID", "entity requires a spaceId filter.");
  }
  let eventTypes: readonly AutomationEventType[] | undefined;
  if (candidate["eventTypes"] !== undefined) {
    if (!Array.isArray(candidate["eventTypes"])) {
      fail("AUTOMATION_INVALID", "eventTypes must be an array.");
    }
    const listed = candidate["eventTypes"] as unknown[];
    if (listed.length < 1 || listed.length > EVENT_TYPES.length) {
      fail("AUTOMATION_INVALID", "eventTypes must list 1..4 event types.");
    }
    for (const entry of listed) {
      if (!(EVENT_TYPES as readonly string[]).includes(entry as string)) {
        fail(
          "AUTOMATION_INVALID",
          "eventTypes allow only record.created, record.updated, record.deleted, transaction.committed.",
        );
      }
    }
    eventTypes = [...(listed as AutomationEventType[])];
  }
  const limit = checkLimit(
    (candidate as { limit?: unknown })["limit"] ?? 100,
  );
  return eventTypes === undefined
    ? { spaceId, entity, recordId, limit }
    : { spaceId, entity, recordId, eventTypes, limit };
}

export function createAutomationEvents(
  client: DataClient,
): AutomationEvents {
  if (typeof client !== "object" || client === null) {
    fail("AUTOMATION_INVALID", "A Task 27 Data client is required.");
  }

  function assertUsable(): void {
    if (client.closed) {
      fail("AUTOMATION_CLOSED", "Bound client is closed.");
    }
  }

  function receiptFor(event: DataEvent): DataMutationReceipt | null {
    try {
      return client.provenance.getReceiptByIdempotencyKey(
        event.idempotencyKey,
      ).result;
    } catch {
      return null;
    }
  }

  function toEnvelope(
    event: DataEvent,
    cursor: string | null,
  ): AutomationEventEnvelope {
    return {
      event,
      receipt: receiptFor(event),
      scope: { workspaceId: client.scope.workspaceId },
      actor: { ...client.actor },
      authorization: { ...client.authorization },
      emittedAt: event.committedAt,
      cursor,
    };
  }

  function matches(
    event: DataEvent,
    filter: ReturnType<typeof normalizeFilter>,
  ): boolean {
    if (filter.spaceId !== "*" && event.spaceId !== filter.spaceId) {
      return false;
    }
    if (filter.entity !== "*" && event.entity !== filter.entity) {
      return false;
    }
    if (filter.recordId !== "*" && event.recordId !== filter.recordId) {
      return false;
    }
    if (
      filter.eventTypes !== undefined &&
      !filter.eventTypes.includes(event.eventType)
    ) {
      return false;
    }
    return true;
  }

  return {
    get closed(): boolean {
      return client.closed;
    },
    subscriptions: {
      describe(filter?: AutomationSubscriptionFilter) {
        assertUsable();
        const normalized = normalizeFilter(filter);
        const out = client.spaces.list();
        return {
          ...out,
          result: {
            filter: normalized,
            cursor: null,
          },
        };
      },
    },
    events: {
      poll(filter?: AutomationSubscriptionFilter, cursor?: string | null) {
        assertUsable();
        const normalized = normalizeFilter(filter);
        if (cursor !== undefined && cursor !== null) {
          if (typeof cursor !== "string" || cursor.length > MAX_ID_LENGTH) {
            fail("AUTOMATION_INVALID", "cursor must be an opaque string.");
          }
        }
        const input: EventsListPayload = {
          ...(normalized.spaceId === "*" ? {} : { spaceId: normalized.spaceId }),
          ...(normalized.entity === "*" ? {} : { entity: normalized.entity }),
          ...(normalized.recordId === "*" ? {} : { recordId: normalized.recordId }),
          limit: normalized.limit,
          ...(cursor === undefined || cursor === null ? {} : { after: cursor }),
        };
        const page: DataEventPage = client.provenance.listEvents(input).result;
        const envelopes = page.items
          .filter((event) => matches(event, normalized))
          .map((event) => toEnvelope(event, page.nextCursor));
        const out = client.spaces.list();
        return {
          ...out,
          result: {
            envelopes,
            nextCursor: page.nextCursor,
            hasMore: page.hasMore,
          },
        };
      },
    },
    receipts: {
      get(receiptId: string) {
        assertUsable();
        return client.provenance.getReceipt(receiptId);
      },
      byKey(idempotencyKey: string) {
        assertUsable();
        return client.provenance.getReceiptByIdempotencyKey(idempotencyKey);
      },
    },
    policy: {
      notice() {
        assertUsable();
        const out = client.spaces.list();
        return {
          ...out,
          result: {
            rule: "no-scheduler-in-data" as const,
            detail:
              "Committed events are facts for OS/automation policy. Data runs no scheduler, trigger engine, or recurring workflow; the owning OS/automation layer subscribes and decides invocations.",
          },
        };
      },
    },
  };
}
