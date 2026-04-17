# @swarmclawai/mcp-core

> Transport-agnostic MCP gateway primitives: downstream multiplexing, tool namespacing, lazy connect, token estimation. The library half of [`@swarmclawai/mcp-gateway`](../mcp-gateway/), made embeddable.

[![npm version](https://img.shields.io/npm/v/@swarmclawai/mcp-core.svg)](https://www.npmjs.com/package/@swarmclawai/mcp-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../../LICENSE)

## What this is

`@swarmclawai/mcp-gateway` is a CLI that runs as a separate process and exposes itself as an MCP server to Claude Code / Cursor / etc. `@swarmclawai/mcp-core` is the library inside it — no CLI, no stdio server binding, just the pieces you need to embed gateway behavior in-process in your own agent runtime.

SwarmClaw uses it for exactly this reason.

## Install

```bash
pnpm add @swarmclawai/mcp-core
# or
npm i @swarmclawai/mcp-core
```

## Quick start

```ts
import { McpMultiClient } from "@swarmclawai/mcp-core";

const mc = new McpMultiClient({
  config: {
    version: 1,
    namespaceSeparator: "__",
    servers: [
      {
        name: "fs",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
        alwaysExpose: true,
      },
      {
        name: "github",
        command: "docker",
        args: ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "ghcr.io/github/github-mcp-server"],
        alwaysExpose: false,
      },
      {
        name: "remote",
        url: "https://mcp.example.com/mcp",
        headers: { Authorization: "Bearer …" },
        alwaysExpose: false,
      },
    ],
  },
});

await mc.connectEager();

// list_tools — includes fs__* eagerly, github__* + remote__* only after
// mcp_tool_search has promoted them.
const tools = await mc.listExposedTools();

// call a tool by its namespaced name
const result = await mc.callTool("fs__read_file", { path: "/tmp/x" });

await mc.shutdown();
```

## Public API

### `McpMultiClient`

One-stop convenience class. Wraps `DownstreamManager` + `McpRequestRouter` + `SessionToolPromoter`.

```ts
new McpMultiClient({
  config,               // GatewayConfig or raw object (parseConfig is run either way)
  transportFactory?,    // Inject stdio/http/in-memory; defaults to auto-select by spec shape
  toolSearch?,          // true (default) to enable mcp_tool_search; false to disable; or pass your own SessionToolPromoter
  isToolExposureAllowed?, // (prefixedName) => boolean, additional host policy
  onLog?, clientName?, clientVersion?,
})
```

Methods: `connectEager()`, `connect(name)`, `ensureConnected(name)`, `listExposedTools()`, `callTool(name, args)`, `tokenReport()`, `shutdown()`, `register(spec)`, `exposedTools()`, `allKnownTools()`.

### `McpRequestRouter`

Pure request routing — the transport-agnostic piece of the Gateway. Build your own server wrapper around it.

```ts
const router = new McpRequestRouter({ config, downstreams, promoter, isToolExposureAllowed });
await router.lazyConnectAll();
const tools = await router.listExposedTools();
const result = await router.callTool(name, args);
const report = router.tokenReport();
```

### `DownstreamManager`

Maintains one MCP `Client` per downstream spec, routes tool calls, tracks tool schemas. Accepts any `ClientTransportFactory` — ships with stdio, streamable-http, and an auto-selecting default.

### `SessionToolPromoter`

Session-scoped state for the `mcp_tool_search` meta-tool. `promote(name)` marks a tool as eager for subsequent `list_tools` calls; `allow(name)` reports whether a name is promoted.

### Config

- `configSchema` / `serverSpecSchema` — Zod schemas for `mcp-gateway.config.json`.
- `parseConfig(raw)` — validate + apply defaults.
- `loadConfigFile(path)` — read + parse.
- `resolvedServerAlwaysExposed(spec, toolName)` — helper for the `alwaysExpose: true | false | string[]` tri-state.

### Transports

- `stdioClientTransportFactory` — spawn a subprocess per spec.
- `streamableHttpClientTransportFactory` — hit a spec's `url` with optional `headers`.
- `defaultClientTransportFactory` — picks stdio if `command` is set, HTTP if `url` is set, throws otherwise.

### Tokens

- `estimateTokens(text)` — tokenizer-free heuristic (chars / 3.5).
- `estimateToolTokens({ name, description?, inputSchema? })` — per-tool cost.
- `TokenReport` type with totals + per-server / per-tool breakdowns via `McpMultiClient#tokenReport()`.

## Architecture

```
┌─────────────────────────────────────────────────┐
│ Your agent host (SwarmClaw, a custom runtime, …)│
│                                                 │
│  ┌──────────────┐   ┌───────────────────┐       │
│  │ McpMulti     │──▶│ McpRequestRouter  │       │
│  │ Client       │   │  (pure routing)   │       │
│  └──────┬───────┘   └──────────┬────────┘       │
│         │                      │                │
│         ▼                      ▼                │
│  ┌──────────────┐   ┌───────────────────┐       │
│  │ Downstream   │   │ SessionTool       │       │
│  │ Manager      │   │ Promoter          │       │
│  └──────┬───────┘   └───────────────────┘       │
└─────────┼───────────────────────────────────────┘
          │ transportFactory (stdio | http | custom)
          ▼
   ┌──────────────────────────────┐
   │ Downstream MCP servers       │
   │ (fs, github, sentry, remote) │
   └──────────────────────────────┘
```

## License

MIT. See [LICENSE](../../LICENSE) at the monorepo root.
