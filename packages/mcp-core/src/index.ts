export {
  configSchema,
  serverSpecSchema,
  parseConfig,
  loadConfigFile,
  defaultConfigPath,
  resolvedServerAlwaysExposed,
} from "./config.js";
export type { GatewayConfig, ServerSpec } from "./config.js";

export { DownstreamManager } from "./downstream.js";
export type {
  DownstreamClient,
  DownstreamTool,
  DownstreamManagerOptions,
  ClientTransportFactory,
} from "./downstream.js";

export { McpRequestRouter } from "./router.js";
export type { McpRequestRouterOptions } from "./router.js";

export { McpMultiClient } from "./multi-client.js";
export type { McpMultiClientOptions } from "./multi-client.js";

export {
  SessionToolPromoter,
  TOOL_SEARCH_NAME,
  toolSearchToolDescriptor,
  searchTools,
} from "./tool-search.js";
export type {
  ToolSearchInput,
  ToolSearchMatch,
  ToolSearchResult,
} from "./tool-search.js";

export { stdioClientTransportFactory } from "./transports/stdio.js";
export { streamableHttpClientTransportFactory } from "./transports/http.js";
export { defaultClientTransportFactory } from "./transports/default.js";

export {
  estimateTokens,
  estimateToolTokens,
} from "./tokens.js";
export type {
  TokenReport,
  ServerTokenLine,
  ToolTokenLine,
} from "./tokens.js";
