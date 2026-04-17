import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ClientTransportFactory } from "../downstream.js";

/**
 * Client transport factory for downstream servers that expose a streamable-HTTP
 * MCP endpoint. The spec must provide `url`; `headers` is forwarded via
 * `requestInit` (e.g. Authorization bearer tokens).
 */
export const streamableHttpClientTransportFactory: ClientTransportFactory = (
  spec
) => {
  if (!spec.url) {
    throw new Error(
      `server '${spec.name}' needs a url to use the streamable-http transport`
    );
  }
  const requestInit: RequestInit | undefined = spec.headers
    ? { headers: spec.headers }
    : undefined;
  return new StreamableHTTPClientTransport(new URL(spec.url), { requestInit });
};
