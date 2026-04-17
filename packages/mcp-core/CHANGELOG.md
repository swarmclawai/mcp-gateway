# @swarmclawai/mcp-core — Changelog

## 0.1.0 — Initial release

First publication of the transport-agnostic MCP gateway primitives, extracted from `@swarmclawai/mcp-gateway` so embedders (SwarmClaw, custom runtimes) can use them in-process without pulling in a CLI or a stdio server binding.

### Added

- `McpMultiClient` — one-stop class that wraps `DownstreamManager` + `McpRequestRouter` + `SessionToolPromoter`. The expected entry point for embedders.
- `McpRequestRouter` — pure (transport-agnostic) request routing for `list_tools`, `call_tool`, lazy-connect heuristics, and `tokenReport()`.
- `DownstreamManager` — maintains one MCP `Client` per downstream spec, namespaces tools with a configurable separator, tracks schemas, and routes tool calls. Transport-injectable.
- `SessionToolPromoter` — session-scoped bookkeeping for the `mcp_tool_search` meta-tool. Agents call the tool to discover lazy tools; matched names are promoted for the rest of the session.
- `searchTools(pool, {query, limit?})` — dependency-free fuzzy matcher used by the meta-tool.
- `toolSearchToolDescriptor` — `Tool`-shaped descriptor the router advertises when a promoter is attached.
- Transports: `stdioClientTransportFactory`, `streamableHttpClientTransportFactory`, `defaultClientTransportFactory` (auto-selects by spec shape).
- Config schema: stdio servers via `command` / HTTP servers via `url` (mutually exclusive, validated by `superRefine`). `alwaysExpose: true | false | string[]` tri-state policy. `enabled` per-server toggle.
- Token estimator: tokenizer-free chars/3.5 heuristic; `estimateToolTokens` + `TokenReport` types.

### Notes

- This is the library half of `@swarmclawai/mcp-gateway`. The CLI, the stdio/HTTP server wrapping, and the `add <agent>` installer live in the sibling package.
