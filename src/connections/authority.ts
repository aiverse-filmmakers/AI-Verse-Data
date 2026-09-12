import type { DataClient, DataSuccessResult } from "../client/index.js";
import type {
  DataActor,
  DataAuthorization,
  DataScope,
  QueryPayload,
  RecordGetPayload,
  RecordListPayload,
} from "../protocol/index.js";
import type { DataQueryPage } from "../query/index.js";
import type { DataRecordSnapshot } from "../records/index.js";
import { ConnectionsAuthorityError } from "./errors.js";

export type ConnectionsAuthorityClass =
  | "local_canonical"
  | "external_canonical"
  | "replicated"
  | "snapshot"
  | "derived";

export type ConnectionsSyncDirection = "none" | "import-only";

export interface ConnectionsSourceRef {
  readonly sourceType: "ai-verse-connections";
  readonly connectionId: string;
  readonly externalSystem: string;
  readonly externalId: string;
  readonly externalVersion: string | null;
  readonly authority: Exclude<ConnectionsAuthorityClass, "local_canonical">;
  readonly sync: ConnectionsSyncDirection;
  readonly uri: string;
}

export interface ConnectionsAuthorityPolicy {
  readonly local: "local_canonical";
  readonly external: readonly Exclude<
    ConnectionsAuthorityClass,
    "local_canonical"
  >[];
  readonly defaultDirection: ConnectionsSyncDirection;
}

export interface ConnectionsImportInput {
  readonly spaceId: string;
  readonly entity: string;
  readonly idempotencyKey: string;
  readonly data: Record<string, unknown>;
  readonly source: {
    readonly connectionId: string;
    readonly externalSystem: string;
    readonly externalId: string;
    readonly externalVersion?: string | null;
    readonly authority: Exclude<ConnectionsAuthorityClass, "local_canonical">;
    readonly direction?: ConnectionsSyncDirection;
  };
}

export interface ConnectionsImportedRecord {
  readonly record: DataRecordSnapshot;
  readonly source: ConnectionsSourceRef;
  readonly provenance: ConnectionsOperationProvenance;
}

export interface ConnectionsOperationProvenance {
  readonly performedAt: string;
  readonly scope: DataScope;
  readonly actor: DataActor;
  readonly authorization: DataAuthorization;
  readonly direction: ConnectionsSyncDirection;
}

export interface ConnectionsAuthority {
  readonly closed: boolean;
  readonly policy: {
    describe(): DataSuccessResult<ConnectionsAuthorityPolicy>;
  };
  readonly authority: {
    classify(input: {
      readonly spaceId: string;
      readonly entity: string;
    }): DataSuccessResult<{
      readonly spaceId: string;
      readonly entity: string;
      readonly authority: "local_canonical";
    }>;
  };
  readonly sources: {
    ref(input: {
      readonly connectionId: string;
      readonly externalSystem: string;
      readonly externalId: string;
      readonly externalVersion?: string | null;
      readonly authority: Exclude<ConnectionsAuthorityClass, "local_canonical">;
      readonly direction?: ConnectionsSyncDirection;
    }): ConnectionsSourceRef;
    parse(uri: string): ConnectionsSourceRef;
  };
  readonly records: {
    get(input: RecordGetPayload): DataSuccessResult<DataRecordSnapshot>;
    list(input: RecordListPayload): DataSuccessResult<readonly DataRecordSnapshot[]>;
    import(
      input: ConnectionsImportInput,
    ): DataSuccessResult<ConnectionsImportedRecord>;
  };
  readonly query: {
    query(input: QueryPayload): DataSuccessResult<DataQueryPage>;
  };
  readonly lifecycle: {
    syncNotice(): DataSuccessResult<{
      readonly direction: ConnectionsSyncDirection;
      readonly rule: "no-implicit-bidirectional-sync";
      readonly detail: string;
    }>;
  };
}

const SLUG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const WORKSPACE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_ID_LENGTH = 128;
const MAX_TEXT_LENGTH = 4096;
const FUTURE_CLASSES = [
  "external_canonical",
  "replicated",
  "snapshot",
  "derived",
] as const;

function fail(
  code:
    | "CONNECTIONS_INVALID"
    | "CONNECTIONS_CLOSED"
    | "CONNECTIONS_AUTHORITY_DENIED",
  message: string,
): never {
  throw new ConnectionsAuthorityError(code, message);
}

function checkSlug(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 64 ||
    !SLUG_RE.test(value)
  ) {
    fail("CONNECTIONS_INVALID", `${field} must be a lowercase slug.`);
  }
  return value;
}

function checkId(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_ID_LENGTH ||
    value === "." ||
    value === ".." ||
    !SAFE_ID_RE.test(value)
  ) {
    fail("CONNECTIONS_INVALID", `${field} must be a safe identifier.`);
  }
  return value;
}

function checkSystem(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_ID_LENGTH ||
    !/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)
  ) {
    fail(
      "CONNECTIONS_INVALID",
      "externalSystem must start with a letter and carry letters, digits, _ or -.",
    );
  }
  return value;
}

function checkAuthority(
  value: unknown,
): Exclude<ConnectionsAuthorityClass, "local_canonical"> {
  if (typeof value !== "string" || !(FUTURE_CLASSES as readonly string[]).includes(value)) {
    fail(
      "CONNECTIONS_INVALID",
      "authority must name a declared future class: external_canonical, replicated, snapshot, or derived. local_canonical records never claim external authority.",
    );
  }
  return value as Exclude<ConnectionsAuthorityClass, "local_canonical">;
}

function checkDirection(
  value: unknown,
): ConnectionsSyncDirection {
  if (value === undefined) return "import-only";
  if (value !== "none" && value !== "import-only") {
    fail(
      "CONNECTIONS_INVALID",
      'direction must be "none" or "import-only". Bidirectional sync is never implied.',
    );
  }
  return value;
}

function checkData(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("CONNECTIONS_INVALID", "import data must be a JSON object.");
  }
  let bytes = 0;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    fail("CONNECTIONS_INVALID", "import data must be JSON-serializable.");
  }
  if (bytes > 128 * 1024) {
    fail("CONNECTIONS_INVALID", "import data exceeds 128 KiB.");
  }
  return value as Record<string, unknown>;
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

function buildSourceUri(input: {
  readonly connectionId: string;
  readonly externalSystem: string;
  readonly externalId: string;
  readonly externalVersion: string | null;
  readonly authority: Exclude<ConnectionsAuthorityClass, "local_canonical">;
  readonly sync: ConnectionsSyncDirection;
}): string {
  const base = `connections://${encodeSegment(input.connectionId)}/${encodeSegment(input.externalSystem)}/${encodeSegment(input.externalId)}`;
  const params = new URLSearchParams();
  params.set("authority", input.authority);
  params.set("sync", input.sync);
  if (input.externalVersion !== null) params.set("version", input.externalVersion);
  return `${base}?${params.toString()}`;
}

function parseSourceUri(uri: string): ConnectionsSourceRef {
  if (
    typeof uri !== "string" ||
    uri.length < 1 ||
    uri.length > MAX_TEXT_LENGTH ||
    !uri.startsWith("connections://")
  ) {
    fail("CONNECTIONS_INVALID", "Source URI must start with connections://.");
  }
  const rest = uri.slice("connections://".length);
  const queryIndex = rest.indexOf("?");
  const path = queryIndex === -1 ? rest : rest.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : rest.slice(queryIndex + 1);
  const segments = path.split("/");
  if (segments.length !== 3) {
    fail(
      "CONNECTIONS_INVALID",
      "Source URI must match connections://<connection>/<system>/<externalId>?authority=&sync=[&version=].",
    );
  }
  const connectionId = decodeURIComponent(segments[0] as string);
  const externalSystem = decodeURIComponent(segments[1] as string);
  const externalId = decodeURIComponent(segments[2] as string);
  checkId(connectionId, "connectionId");
  checkSystem(externalSystem);
  checkId(externalId, "externalId");
  const params = new URLSearchParams(query);
  for (const key of params.keys()) {
    if (key !== "authority" && key !== "sync" && key !== "version") {
      fail("CONNECTIONS_INVALID", "Source URI may only carry authority, sync, and version.");
    }
  }
  const authority = checkAuthority(params.get("authority"));
  const sync = checkDirection(params.get("sync") ?? undefined);
  const rawVersion = params.get("version");
  const externalVersion =
    rawVersion === null ? null : checkId(rawVersion, "externalVersion");
  return {
    sourceType: "ai-verse-connections",
    connectionId,
    externalSystem,
    externalId,
    externalVersion,
    authority,
    sync,
    uri,
  };
}

export function createConnectionsAuthority(
  client: DataClient,
): ConnectionsAuthority {
  if (typeof client !== "object" || client === null) {
    fail("CONNECTIONS_INVALID", "A Task 27 Data client is required.");
  }

  function assertUsable(): void {
    if (client.closed) {
      fail("CONNECTIONS_CLOSED", "Bound client is closed.");
    }
  }

  function provenance(
    direction: ConnectionsSyncDirection,
  ): ConnectionsOperationProvenance {
    return {
      performedAt: new Date().toISOString(),
      scope: { workspaceId: client.scope.workspaceId },
      actor: { ...client.actor },
      authorization: { ...client.authorization },
      direction,
    };
  }

  function makeRef(input: {
    readonly connectionId: string;
    readonly externalSystem: string;
    readonly externalId: string;
    readonly externalVersion?: string | null;
    readonly authority: Exclude<ConnectionsAuthorityClass, "local_canonical">;
    readonly direction?: ConnectionsSyncDirection;
  }): ConnectionsSourceRef {
    const connectionId = checkId(input.connectionId, "connectionId");
    const externalSystem = checkSystem(input.externalSystem);
    const externalId = checkId(input.externalId, "externalId");
    const externalVersion =
      input.externalVersion === undefined || input.externalVersion === null
        ? null
        : checkId(input.externalVersion, "externalVersion");
    const authority = checkAuthority(input.authority);
    const sync = checkDirection(input.direction);
    const uri = buildSourceUri({
      connectionId,
      externalSystem,
      externalId,
      externalVersion,
      authority,
      sync,
    });
    return {
      sourceType: "ai-verse-connections",
      connectionId,
      externalSystem,
      externalId,
      externalVersion,
      authority,
      sync,
      uri,
    };
  }

  return {
    get closed(): boolean {
      return client.closed;
    },
    policy: {
      describe() {
        assertUsable();
        const out = client.spaces.list();
        return {
          ...out,
          result: {
            local: "local_canonical" as const,
            external: [...FUTURE_CLASSES],
            defaultDirection: "import-only" as const,
          },
        };
      },
    },
    authority: {
      classify(input: { readonly spaceId: string; readonly entity: string }) {
        assertUsable();
        checkSlug(input.spaceId, "spaceId");
        checkSlug(input.entity, "entity");
        const out = client.schemas.get(input);
        return {
          ...out,
          result: {
            spaceId: input.spaceId,
            entity: input.entity,
            authority: "local_canonical" as const,
          },
        };
      },
    },
    sources: {
      ref(input) {
        assertUsable();
        return makeRef(input);
      },
      parse(uri: string) {
        assertUsable();
        if (
          typeof uri !== "string" ||
          !WORKSPACE_RE.test(client.scope.workspaceId)
        ) {
          fail("CONNECTIONS_INVALID", "Source URI is invalid.");
        }
        return parseSourceUri(uri);
      },
    },
    records: {
      get(input: RecordGetPayload) {
        assertUsable();
        return client.records.get(input);
      },
      list(input: RecordListPayload) {
        assertUsable();
        return client.records.list(input);
      },
      import(input: ConnectionsImportInput) {
        assertUsable();
        checkSlug(input.spaceId, "spaceId");
        checkSlug(input.entity, "entity");
        if (
          typeof input.idempotencyKey !== "string" ||
          input.idempotencyKey.length < 1 ||
          input.idempotencyKey.length > 256 ||
          input.idempotencyKey.includes(" ")
        ) {
          fail("CONNECTIONS_INVALID", "idempotencyKey must be 1..256 chars, no NUL.");
        }
        const data = checkData(input.data);
        const source = makeRef(input.source);
        const recordData = {
          ...data,
          sourceRef: {
            sourceType: source.sourceType,
            connectionId: source.connectionId,
            externalSystem: source.externalSystem,
            externalId: source.externalId,
            ...(source.externalVersion === null
              ? {}
              : { externalVersion: source.externalVersion }),
            authority: source.authority,
            sync: source.sync,
            uri: source.uri,
          },
        };
        const out = client.records.createWithReceipt({
          spaceId: input.spaceId,
          entity: input.entity,
          idempotencyKey: input.idempotencyKey,
          data: recordData as unknown as Parameters<
            DataClient["records"]["createWithReceipt"]
          >[0]["data"],
        });
        return {
          ...out,
          result: {
            record: out.result.record,
            source,
            provenance: provenance(source.sync),
          },
        };
      },
    },
    query: {
      query(input: QueryPayload) {
        assertUsable();
        return client.query.query(input);
      },
    },
    lifecycle: {
      syncNotice() {
        assertUsable();
        const out = client.spaces.list();
        return {
          ...out,
          result: {
            direction: "import-only" as const,
            rule: "no-implicit-bidirectional-sync" as const,
            detail:
              "Imports are one-way with source refs and provenance. Bidirectional sync needs explicit authority, direction, conflict, deletion, offline, and provenance answers first.",
          },
        };
      },
    },
  };
}
