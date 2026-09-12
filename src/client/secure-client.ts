import { DataRecordError } from "../records/index.js";
import { createDataClient as createBaseDataClient } from "./client.js";
import type { CreateDataClientOptions, DataClient } from "./types.js";

export function createDataClient(options: CreateDataClientOptions): DataClient {
  const base = createBaseDataClient(options);
  const client: DataClient = {
    ...base,
    records: {
      ...base.records,
      list(input) {
        if (input.cursor !== undefined && input.cursor !== null) {
          throw new DataRecordError(
            "FIELD_INVALID",
            "records.list does not support cursor pagination. Use data.query for cursor-based paging.",
          );
        }
        return base.records.list(input);
      },
    },
    close() {
      base.close();
    },
    get closed(): boolean {
      return base.closed;
    },
  };

  // The base client intentionally defines scope as a non-enumerable trusted
  // object. Object spread does not carry non-enumerable properties, so restore
  // the exact trusted scope descriptor instead of synthesizing/copying it.
  Object.defineProperty(client, "scope", {
    value: base.scope,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return client;
}
