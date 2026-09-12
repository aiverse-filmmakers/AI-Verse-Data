import type { DataClient } from "../client/index.js";
import { ConnectionsAuthorityError } from "./errors.js";
import {
  createConnectionsAuthority as createBaseConnectionsAuthority,
  type ConnectionsAuthority,
} from "./authority.js";

export function createConnectionsAuthority(client: DataClient): ConnectionsAuthority {
  const base = createBaseConnectionsAuthority(client);
  return {
    ...base,
    sources: {
      ...base.sources,
      parse(uri: string) {
        try {
          return base.sources.parse(uri);
        } catch (error) {
          if (error instanceof URIError) {
            throw new ConnectionsAuthorityError(
              "CONNECTIONS_INVALID",
              "Source URI contains invalid percent encoding.",
              undefined,
              error,
            );
          }
          throw error;
        }
      },
    },
  };
}
