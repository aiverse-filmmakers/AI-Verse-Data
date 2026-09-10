import { randomUUID } from "node:crypto";

import { DATA_PROTOCOL_LIMITS } from "../protocol/index.js";
import { DataProvenanceError } from "./errors.js";

const REQUEST_ID_RE = /^req_[A-Za-z0-9][A-Za-z0-9_-]*$/;
const TRANSACTION_ID_RE = /^txn_[A-Za-z0-9][A-Za-z0-9_-]*$/;
const EVENT_ID_RE = /^evt_[A-Za-z0-9][A-Za-z0-9_-]*$/;
const RECEIPT_ID_RE = /^rcpt_[A-Za-z0-9][A-Za-z0-9_-]*$/;

function generated(prefix: "req" | "txn" | "evt" | "rcpt"): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function validateOpaque(
  value: string,
  pattern: RegExp,
  name: string,
): string {
  if (
    typeof value !== "string" ||
    value.length < 5 ||
    value.length > DATA_PROTOCOL_LIMITS.maxIdLength ||
    !pattern.test(value)
  ) {
    throw new DataProvenanceError(
      "QUERY_INVALID",
      `${name} is invalid.`,
    );
  }
  return value;
}

export function createRequestId(): string {
  return generated("req");
}

export function createTransactionId(): string {
  return generated("txn");
}

export function createEventId(): string {
  return generated("evt");
}

export function createReceiptId(): string {
  return generated("rcpt");
}

export function validateRequestId(value: string): string {
  return validateOpaque(value, REQUEST_ID_RE, "Request ID");
}

export function validateTransactionId(value: string): string {
  return validateOpaque(value, TRANSACTION_ID_RE, "Transaction ID");
}

export function validateEventId(value: string): string {
  return validateOpaque(value, EVENT_ID_RE, "Event ID");
}

export function validateReceiptId(value: string): string {
  return validateOpaque(value, RECEIPT_ID_RE, "Receipt ID");
}
