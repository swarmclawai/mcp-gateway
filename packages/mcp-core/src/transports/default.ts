import type { ClientTransportFactory } from "../downstream.js";
import { stdioClientTransportFactory } from "./stdio.js";
import { streamableHttpClientTransportFactory } from "./http.js";

/**
 * Selects a client transport for a downstream spec based on which fields are
 * populated: `url` → streamable-http, `command` → stdio. This is the factory
 * `McpMultiClient` and the CLI gateway default to so a mixed config (some
 * servers spawned locally, some fetched over HTTP) just works.
 */
export const defaultClientTransportFactory: ClientTransportFactory = (spec) => {
  if (spec.url) {
    return streamableHttpClientTransportFactory(spec);
  }
  if (spec.command) {
    return stdioClientTransportFactory(spec);
  }
  throw new Error(
    `server '${spec.name}' has no command (stdio) or url (http) — cannot select a transport`
  );
};
