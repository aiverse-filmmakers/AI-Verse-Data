import type { DataActor } from "../protocol/index.js";
import type {
  DataIdempotencyStorage,
  DataStorageDatabase,
  StoredIdempotencyEntry,
} from "../storage/index.js";
import {
  AI_VERSE_DATA_IDEMPOTENCY_FINGERPRINT_VERSION,
} from "../storage/index.js";
import { DataIdempotencyError } from "./errors.js";
import {
  canonicalRequestFingerprint,
  canonicalResultJson,
  idempotencyResultDigest,
} from "./fingerprint.js";

export interface IdempotencyFresh {
  readonly kind: "fresh";
  readonly requestFingerprint: string;
}

export interface IdempotencyReplay<T> {
  readonly kind: "replay";
  readonly value: T;
  readonly committedAt: string;
}

export type IdempotencyPreparation<T> =
  | IdempotencyFresh
  | IdempotencyReplay<T>;

export class DataIdempotency {
  private readonly store: DataIdempotencyStorage;

  constructor(database: DataStorageDatabase) {
    this.store = database.idempotencyStorage();
    this.store.initialize();
  }

  prepare<T>(
    idempotencyKey: string,
    operation: string,
    actor: DataActor,
    request: unknown,
  ): IdempotencyPreparation<T> {
    const requestFingerprint = canonicalRequestFingerprint(
      operation,
      actor,
      request,
    );
    const existing = this.store.get(idempotencyKey);

    if (existing === null) {
      return {
        kind: "fresh",
        requestFingerprint,
      };
    }

    if (
      existing.operation !== operation ||
      existing.requestFingerprint !== requestFingerprint
    ) {
      throw new DataIdempotencyError(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key is already bound to a different committed mutation.",
        {
          idempotencyKey,
          requestedOperation: operation,
          existingOperation: existing.operation,
        },
      );
    }

    return {
      kind: "replay",
      value: this.decodeResult<T>(existing),
      committedAt: existing.createdAt,
    };
  }

  complete<T>(
    idempotencyKey: string,
    operation: string,
    requestFingerprint: string,
    value: T,
  ): T {
    const resultJson = canonicalResultJson(value);
    const entry: StoredIdempotencyEntry = {
      idempotencyKey,
      operation,
      fingerprintVersion: AI_VERSE_DATA_IDEMPOTENCY_FINGERPRINT_VERSION,
      requestFingerprint,
      resultJson,
      resultDigest: idempotencyResultDigest(resultJson),
      createdAt: new Date().toISOString(),
    };

    if (!this.store.create(entry)) {
      throw new DataIdempotencyError(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key became bound before the mutation result could be recorded.",
        {
          idempotencyKey,
          requestedOperation: operation,
        },
      );
    }

    return value;
  }

  private decodeResult<T>(entry: StoredIdempotencyEntry): T {
    if (
      entry.fingerprintVersion !==
      AI_VERSE_DATA_IDEMPOTENCY_FINGERPRINT_VERSION
    ) {
      throw new DataIdempotencyError(
        "DATABASE_CORRUPT",
        "Stored idempotency fingerprint version is unsupported.",
        { idempotencyKey: entry.idempotencyKey },
      );
    }

    if (idempotencyResultDigest(entry.resultJson) !== entry.resultDigest) {
      throw new DataIdempotencyError(
        "DATABASE_CORRUPT",
        "Stored idempotency result digest does not match its canonical result.",
        { idempotencyKey: entry.idempotencyKey },
      );
    }

    try {
      return JSON.parse(entry.resultJson) as T;
    } catch (error) {
      throw new DataIdempotencyError(
        "DATABASE_CORRUPT",
        "Stored idempotency result JSON cannot be decoded.",
        { idempotencyKey: entry.idempotencyKey },
        error,
      );
    }
  }
}
