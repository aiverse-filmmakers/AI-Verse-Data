export const AI_VERSE_DATA_IDEMPOTENCY_FINGERPRINT_VERSION = 1 as const;

export interface StoredIdempotencyEntry {
  readonly idempotencyKey: string;
  readonly operation: string;
  readonly fingerprintVersion: typeof AI_VERSE_DATA_IDEMPOTENCY_FINGERPRINT_VERSION;
  readonly requestFingerprint: string;
  readonly resultJson: string;
  readonly resultDigest: string;
  readonly createdAt: string;
}

export interface DataIdempotencyStorage {
  initialize(): void;
  get(idempotencyKey: string): StoredIdempotencyEntry | null;
  create(entry: StoredIdempotencyEntry): boolean;
}
