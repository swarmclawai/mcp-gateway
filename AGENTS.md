# mcp-gateway — agent-facing reference

Machine-friendly spec for driving `mcp-gateway` from a coding agent (Claude Code, Codex, Cursor, Cline, Aider, Copilot, etc.).

**Tip:** Run `mcp-gateway help-agents` (or any other command with `--json`) for the full catalog in one line of JSON.

## Global flags

| Flag | Type | Effect |
|---|---|---|
| `--json` | boolean | Emit a one-line JSON envelope on stdout |
| `--quiet` | boolean | Suppress stderr logs |
| `--verbose` | boolean | More detail on stderr |
| `--cwd <path>` | path | Override the working directory |
| `--config <path>` | path | Config file (default `./mcp-gateway.config.json`) |

## JSON envelope

```json
{"ok": true, "data": {...}}
```

Error:

```json
{"ok": false, "error": {"code": "E_VALIDATION", "message": "...", "hint": "..."}}
```

Stable error codes: `E_VALIDATION`, `E_INTERNAL`.

Exit codes: `0` success, `1` user error, `2` internal error.

## Config schema

```ts
{
  version: 1,
  namespaceSeparator: string,  // default "__"
  servers: [
    {
      name: string,                   // lowercase alphanumeric + underscore, used as namespace prefix
      command: string,                // executable
      args?: string[],
      env?: Record<string,string>,
      cwd?: string,
      alwaysExpose: boolean | string[], // true | false | list of tool names to pre-expose
      enabled?: boolean,              // default true
      description?: string
    }
  ]
}
```

## Commands

### `start`

Run the gateway as a stdio MCP server. Your upstream client (Claude Code, Cursor, etc.) connects to this single process instead of each individual downstream server. Returns a streaming MCP session, not JSON.

### `status`

Connect to each enabled downstream, list tools, then disconnect. Emit a snapshot.

```json
{
  "ok": true,
  "data": {
    "config": {"path": "...", "servers": 3},
    "downstreams": [
      {"name": "fs", "status": "ready", "enabled": true, "alwaysExpose": true, "tools": 12, "lastError": null}
    ]
  }
}
```

### `token-report`

Estimate tokens per downstream's tool schemas.

```json
{
  "ok": true,
  "data": {
    "totalExposedTokens": 4800,
    "totalAvailableTokens": 61200,
    "servers": [
      {"name": "fs", "exposed": true, "alwaysExposed": true, "tokens": 4800, "tools": [{"name": "fs__read_file", "tokens": 380}]}
    ]
  }
}
```

### `validate`

Validate the config without connecting to downstreams. Exits `1` on any schema or file error.

### `add-server <name> <command> [args...]`

Append a server to the config. With `--write` it modifies the file; without, it prints the resulting config to stdout.

Flags: `--always-expose <tools>` (`all` | `none` | comma-separated tool names), `--write`.

### `init`

Create a starter `mcp-gateway.config.json`. `--write` writes to disk (refuses to overwrite existing file); without, prints to stdout.

### `help-agents`

Returns the full CLI catalog as JSON. Preferred discovery entry point for agents.

## Tool namespacing

Every downstream tool is exposed as `<server_name><separator><tool_name>` — e.g. `fs__read_file`. This prevents collisions and lets the gateway route `call_tool` by looking at the prefix. The separator is configurable (`namespaceSeparator`) but must be consistent across the gateway's lifetime.

## Lazy exposure semantics

- `alwaysExpose: true` — gateway connects at startup and exposes every tool.
- `alwaysExpose: false` — gateway does not expose any tool from the server until the upstream client calls `call_tool` with that server's prefix. At that moment the gateway connects, fetches the schema, and fulfills the call.
- `alwaysExpose: [tool_a, tool_b]` — only the listed tools appear in `tools/list` replies, even though the server is connected. This is useful for large servers (like GitHub's) where most of the surface is noise for a specific project.
