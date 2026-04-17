// Re-export the transport-agnostic primitives so consumers who only have
// @swarmclawai/mcp-gateway installed can still reach the library bits.
// SwarmClaw and other embedders should depend on @swarmclawai/mcp-core directly.
export {
  configSchema,
  serverSpecSchema,
  parseConfig,
  loadConfigFile,
  defaultConfigPath,
  resolvedServerAlwaysExposed,
  DownstreamManager,
  McpRequestRouter,
  McpMultiClient,
  stdioClientTransportFactory,
  streamableHttpClientTransportFactory,
  defaultClientTransportFactory,
  estimateTokens,
  estimateToolTokens,
} from "@swarmclawai/mcp-core";
export type {
  GatewayConfig,
  ServerSpec,
  DownstreamClient,
  DownstreamTool,
  DownstreamManagerOptions,
  ClientTransportFactory,
  McpRequestRouterOptions,
  McpMultiClientOptions,
  TokenReport,
  ServerTokenLine,
  ToolTokenLine,
} from "@swarmclawai/mcp-core";

export { Gateway } from "./server.js";
export type { GatewayOptions } from "./server.js";
