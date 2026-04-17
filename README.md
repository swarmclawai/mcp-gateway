# mcp-gateway

> Local MCP gateway that fans out to N downstream MCP servers, namespaces their tools, and lazy-loads their schemas — so your coding agent's context isn't eaten by MCP boilerplate.

[![npm version](https://img.shields.io/npm/v/@swarmclawai/mcp-gateway.svg)](https://www.npmjs.com/package/@swarmclawai/mcp-gateway)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![CI](https://github.com/swarmclawai/mcp-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/swarmclawai/mcp-gateway/actions/workflows/ci.yml)

## Why this exists

Install more than a handful of MCP servers and something ugly happens: every one of them dumps its full tool schema into your coding agent's context at startup. People routinely report **30,000 – 60,000 tokens** of MCP boilerplate consumed before they've typed a single message. The 1M-context upgrade makes this worse, not better — people just install more servers.

Existing tooling solves the wrong half:

- Registries (wong2/awesome-mcp-servers, mcp.so, smithery, glama) solve **discovery**.
- Docker's own gateway is great at **multi-tenancy** and **auth**.
- Nobody owns the **local runtime** problem: "I have 15 MCP servers installed. I want 3 of them exposed by default and the other 12 to only show up when I actually ask for them."

`mcp-gateway` is that tool. You point your upstream client (Claude Code, Cursor, Cline, Aider, Windsurf, etc.) at one MCP endpoint — the gateway. It fans out to all your downstream servers, prefixes their tool names to prevent collisions, and only exposes the tools you've explicitly chosen to pre-load.

## 30-second demo

```bash
# Generate a starter config
npx @swarmclawai/mcp-gateway@latest init --write

# Edit mcp-gateway.config.json — set alwaysExpose per server

# See how many tokens each server is spending
npx @swarmclawai/mcp-gateway token-report

# Point Claude Code at the gateway instead of at each server individually
claude mcp add gateway -- npx -y @swarmclawai/mcp-gateway@latest start
```

## Config

A single `mcp-gateway.config.json` at your project root (or `--config <path>`):

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
    }
  ]
}
```

- `alwaysExpose: true` — every tool from this server is in your agent's context on startup.
- `alwaysExpose: false` — tools aren't exposed at first; the gateway connects to the server when the agent calls a tool whose name begins with `<prefix>__`.
- `alwaysExpose: ["tool_a", "tool_b"]` — only the listed tools are pre-exposed.

The gateway prefixes every downstream tool with its server name and the namespace separator (`__` by default) so two servers can both expose a tool called `read_file` without collision — your agent sees `fs__read_file` and `github__read_file`.

## Install

```bash
pnpm add -g @swarmclawai/mcp-gateway
# or
npm i -g @swarmclawai/mcp-gateway
# or run on demand
npx @swarmclawai/mcp-gateway@latest --help
```

## Commands

| Command | Purpose |
|---|---|
| `init` | Create a starter config |
| `validate` | Validate the config file without connecting to any downstream |
| `status` | Connect to every enabled downstream and report status + tool counts |
| `token-report` | Estimate how many tokens each downstream's schemas cost |
| `add-server <name> <command> [args...]` | Append a server to the config |
| `start` | Start the gateway (stdio MCP server for an upstream client) |
| `help-agents` | Print the machine-readable command catalog |

Every command accepts `--json` and returns a one-line JSON envelope. Exit codes: `0` success, `1` user error, `2` internal error.

## How token-report works

The report walks every downstream server, connects to it over stdio, calls `tools/list`, and estimates the token cost of each tool's name + description + input schema. We don't call a real tokenizer — that'd introduce a heavy dep for a directional number. Chars / 3.5 is close enough to tell you which server is blowing up your window.

## Wiring it into your agent

### Claude Code

```bash
claude mcp add gateway -- npx -y @swarmclawai/mcp-gateway@latest start
```

Remove your individual server entries — the gateway replaces them.

### Cursor

In `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "gateway": {
      "command": "npx",
      "args": ["-y", "@swarmclawai/mcp-gateway@latest", "start"]
    }
  }
}
```

### Cline, Aider, Windsurf

Same pattern: one `mcp-gateway start` entry in place of N individual server entries. See [`awesome-mcp-for-coding-agents`](https://github.com/swarmclawai/awesome-mcp-for-coding-agents#how-to-install) for the exact config syntax per agent.

## Built for coding agents

Every swarmclawai CLI follows the same agent conventions so Claude Code, Cursor, Cline, Aider, Codex et al can drive them without guessing:

- `--json` everywhere, one-line envelope on stdout
- Stderr for logs, stdout for data
- Stable exit codes: `0` / `1` / `2`
- Non-interactive by default
- `mcp-gateway help-agents` returns the entire command catalog as JSON

See [`AGENTS.md`](./AGENTS.md) for the full machine-readable reference.

## Roadmap

- Session-scoped explicit exposure: an agent can ask the gateway "expose github__* for the rest of this session" without restarting
- Schema compression: strip optional descriptions on lazy-exposed tools to shrink `tools/list` replies further
- Observability endpoint: count tool calls per server to justify what should actually be alwaysExpose
- Remote (HTTP/SSE) transport for upstream clients, not just stdio
- Per-tool deny/allow list beyond the name prefix

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
