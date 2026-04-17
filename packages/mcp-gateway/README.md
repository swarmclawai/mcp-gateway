# mcp-gateway

> **Your coding agent is spending 47,000 tokens on MCP boilerplate before you type a word.** `mcp-gateway` fans out to your downstream MCP servers, namespaces their tools, and only exposes what you ask for. Agents discover the rest on demand via `mcp_tool_search`.

[![npm version](https://img.shields.io/npm/v/@swarmclawai/mcp-gateway.svg)](https://www.npmjs.com/package/@swarmclawai/mcp-gateway)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![CI](https://github.com/swarmclawai/mcp-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/swarmclawai/mcp-gateway/actions/workflows/ci.yml)

<p align="center">
  <!-- TODO: replace with recorded before/after GIF of /context in Claude Code -->
  <img src="./docs/assets/before-after.gif" alt="Claude Code /context dropping from 47K to 3K tokens after installing mcp-gateway" width="720" />
</p>

## 30-second install

```bash
# Drop-in for Claude Code
npx @swarmclawai/mcp-gateway@latest add claude-code

# Or Cursor, Cline, Windsurf
npx @swarmclawai/mcp-gateway@latest add cursor
npx @swarmclawai/mcp-gateway@latest add cline
npx @swarmclawai/mcp-gateway@latest add windsurf
```

That edits the agent's MCP config (with a `.bak` backup) so it talks to one gateway endpoint instead of N individual servers. Then:

```bash
# Generate a starter config and edit to taste
npx @swarmclawai/mcp-gateway@latest init --write

# See how many tokens each downstream server is spending on tool schemas
npx @swarmclawai/mcp-gateway@latest token-report
```

## How it works

```
┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
│ Claude Code,    │        │                 │  stdio │ filesystem      │
│ Cursor, Cline,  │ stdio  │  mcp-gateway    ├────────┤ github          │
│ Windsurf, ...   ├────────┤  (one endpoint) │        │ sentry          │
│                 │        │                 │  http  │ your HTTP MCP   │
└─────────────────┘        └─────────────────┘        └─────────────────┘
                                    │
                                    └── only `alwaysExpose` tools are bound
                                        at startup. Rest surface via
                                        `mcp_tool_search` on demand.
```

- **Namespaces downstream tools.** Two servers can both expose `read_file` — you see `fs__read_file` and `github__read_file`.
- **Lazy-loads by default.** Tools from `alwaysExpose: false` servers stay hidden until an agent calls `mcp_tool_search({query: "..."})`, which promotes them for the rest of the session.
- **Speaks stdio upstream.** Or streamable-HTTP — see [HTTP mode](#http-mode).
- **Stdio or HTTP downstream.** Set `command` for local processes, `url` for remote MCP servers.

## Config

`mcp-gateway.config.json` at your project root (or `--config <path>`):

```json
{
  "version": 1,
  "namespaceSeparator": "__",
  "servers": [
    {
      "name": "fs",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "alwaysExpose": true
    },
    {
      "name": "github",
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "ghcr.io/github/github-mcp-server"],
      "alwaysExpose": false
    },
    {
      "name": "sentry",
      "command": "npx",
      "args": ["-y", "@sentry/mcp-server@latest"],
      "alwaysExpose": ["issue_details"]
    },
    {
      "name": "remote",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer ${SECRET_TOKEN}" },
      "alwaysExpose": false
    }
  ]
}
```

- `alwaysExpose: true` — every tool from this server is in your agent's context on startup.
- `alwaysExpose: false` — tools aren't exposed at first; `mcp_tool_search` surfaces them on demand.
- `alwaysExpose: ["tool_a", "tool_b"]` — only the listed tools are pre-exposed.
- Each server is **stdio** (`command`) or **HTTP** (`url`), not both.

## The `mcp_tool_search` meta-tool

The gateway always exposes one built-in tool: `mcp_tool_search({query, limit?})`. Agents call it to discover lazy tools by name or description keywords. Matched tools are promoted for the rest of the session and start showing up in subsequent `list_tools` responses.

This is the feature that makes `alwaysExpose: false` actually usable — an agent doesn't need to know a tool exists up-front, it searches when it needs one.

## HTTP mode

```bash
# Listen on http://127.0.0.1:3477/mcp instead of stdio
npx @swarmclawai/mcp-gateway@latest start --http --port 3477
```

Useful when:
- Your agent runs on a server (e.g. SwarmClaw on a VPS) and wants to talk to a local gateway over the network.
- You want to run one persistent gateway and point multiple agents at it.
- Your client prefers streamable-HTTP to spawning stdio child processes.

## Commands

| Command | Purpose |
|---|---|
| `add <agent>` | Install the gateway into an agent's MCP config (claude-code, cursor, cline, windsurf) |
| `init` | Create a starter `mcp-gateway.config.json` |
| `validate` | Validate the config without connecting |
| `status` | Connect to each downstream and report status + tool counts |
| `token-report` | Estimate token cost per downstream |
| `add-server` | Append a downstream server to the config |
| `start` | Start the gateway (stdio by default, `--http --port` for streamable-HTTP) |
| `help-agents` | Print the machine-readable command catalog |

Every command accepts `--json` and returns a one-line JSON envelope. Exit codes: `0` success, `1` user error, `2` internal error.

## Token leaderboard

Every week, `mcp-gateway` benchmarks a curated set of popular MCP servers and publishes the results: which are the leanest, which are the heaviest, how much you're spending.

See [`bench/leaderboard.md`](./bench/leaderboard.md) — or open a PR against [`bench/servers.json`](./bench/servers.json) to add your server.

## Used by

- **[SwarmClaw](https://github.com/swarmclawai/swarmclaw)** — self-hosted autonomous-agent runtime. Embeds `@swarmclawai/mcp-core` (the library half of this repo) so every SwarmClaw agent gets lazy tool exposure + `mcp_tool_search` without running a separate gateway process.

Ship something on top of it? Open a PR and we'll add you.

## Library use (`@swarmclawai/mcp-core`)

The pure primitives — config parsing, downstream multiplexing, token estimation, `McpRequestRouter`, `McpMultiClient`, `mcp_tool_search` — live in a separate package so embedders can use them in-process:

```bash
pnpm add @swarmclawai/mcp-core
```

```ts
import { McpMultiClient } from "@swarmclawai/mcp-core";

const mc = new McpMultiClient({
  config: {
    version: 1,
    servers: [
      { name: "fs", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."], alwaysExpose: true },
      { name: "github", command: "docker", args: [...], alwaysExpose: false },
    ],
  },
});
await mc.connectEager();
const tools = await mc.listExposedTools();
// → [fs__read_file, fs__write_file, ..., mcp_tool_search]
```

See the [package README](./packages/mcp-core/README.md) for the full API surface.

## Built for coding agents

Every `@swarmclawai/*` CLI follows the same agent conventions so Claude Code, Cursor, Cline, Codex, Factory Droid, Cursor Agent et al can drive them without guessing:

- `--json` everywhere, one-line envelope on stdout
- Stderr for logs, stdout for data
- Stable exit codes: `0` / `1` / `2`
- Non-interactive by default
- `mcp-gateway help-agents` returns the entire command catalog as JSON

See [`AGENTS.md`](./AGENTS.md) for the full machine-readable reference.

## Roadmap

- Tool **profiles / groups**: `"profile": "coding"` exposes a curated subset across servers
- Schema compression for lazy-exposed tools
- Per-agent session state so gateways serving multiple clients don't cross-promote tools
- Per-tool deny/allow list beyond the namespace prefix

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
