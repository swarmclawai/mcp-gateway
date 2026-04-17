# Launch post drafts

Not shipped content — just drafts ready to post on launch day. The title is the pitch; lead with the number.

---

## Hacker News (Show HN)

**Title:** Show HN: mcp-gateway — your coding agent is spending 47K tokens on MCP boilerplate

**Body:**

Every time you wire an MCP server into Claude Code, Cursor, Cline, or Windsurf, it eagerly loads that server's full tool schemas into your agent's context. Install five or six and you're up to 30–60K tokens of tool definitions before you've typed a single message. The recent 1M-context upgrades didn't fix this — people just install more servers.

`mcp-gateway` is a local runtime that sits between your agent and N downstream MCP servers. It namespaces their tools (so `fs__read_file` and `github__read_file` stop colliding), exposes only the tools you mark `alwaysExpose: true`, and ships a built-in meta-tool called `mcp_tool_search` that agents call to discover the rest on demand.

The whole thing is a single `npx` command:

```
npx @swarmclawai/mcp-gateway@latest add claude-code
```

That edits your agent's MCP config (with a `.bak`) so it points at one gateway endpoint instead of every server individually.

Numbers from my own Claude Code setup after installing it: 47,230 → 2,840 tokens on startup. Source, launch post, and a weekly auto-generated leaderboard of popular MCP servers by token cost: https://github.com/swarmclawai/mcp-gateway

Also ships as `@swarmclawai/mcp-core` — a transport-agnostic library other agents can embed in-process (SwarmClaw uses it for exactly this reason).

What I'd love feedback on:
1. The `mcp_tool_search` pattern — is this the right shape for lazy discovery, or is there a cleaner protocol-level fix?
2. What MCP servers should go in the leaderboard? Open a PR against `bench/servers.json`.
3. HTTP/SSE transport for the gateway side is in — has anyone actually deployed a local gateway as an HTTP endpoint, or is stdio enough?

MIT. No telemetry.

---

## r/ClaudeAI

**Title:** I built a gateway that cuts Claude Code's startup tokens by ~95%

**Body (short, Reddit style):**

If you've noticed Claude Code burning tens of thousands of tokens on MCP tool schemas before you even open a chat — here's the tool I wish existed.

`npx @swarmclawai/mcp-gateway@latest add claude-code` and it consolidates all your MCP servers behind one endpoint. Only the tools you explicitly mark as `alwaysExpose: true` get bound at startup. The rest hide until Claude calls `mcp_tool_search({query: "the thing I need"})`.

My setup went 47K → 3K on `/context` after installing.

Code + config examples: https://github.com/swarmclawai/mcp-gateway

Also compatible with Cursor / Cline / Windsurf — `add cursor`, `add cline`, `add windsurf`. MIT, no telemetry.

---

## r/LocalLLaMA

**Title:** mcp-gateway — stop MCP tool schemas from eating your agent's context window

**Body (technical):**

If you self-host a coding agent (Ollama + Cline, llama.cpp + your own glue, etc.) you've probably noticed that every MCP server you install dumps its tool schemas into your system prompt. For a local 32K context model this is brutal — five MCP servers can eat 20% of your window before the first token.

`mcp-gateway` is a Node process you run locally. Point your agent at it over stdio (or streamable-HTTP if your client prefers that), configure the downstream servers in one JSON file, and the gateway only surfaces the tools you explicitly pre-load. Agents discover lazy tools on demand via an always-exposed `mcp_tool_search` meta-tool.

- Stdio + streamable-HTTP upstream
- Stdio + HTTP downstream (so you can mix local processes and remote MCP endpoints)
- Pure library (`@swarmclawai/mcp-core`) if you want the primitives without the CLI
- Weekly auto-generated leaderboard of public MCP servers by token cost

https://github.com/swarmclawai/mcp-gateway

MIT.

---

## r/mcp

**Title:** New: mcp-gateway consolidates downstream MCP servers + adds tool_search meta-tool

**Body:**

Sharing a gateway I built for my own use and open-sourced: https://github.com/swarmclawai/mcp-gateway

The shape:
1. Runs as an MCP server (stdio or streamable-HTTP).
2. Fans out to N downstream MCP servers — stdio subprocesses or HTTP endpoints — and namespaces their tools with a configurable separator.
3. Only tools marked `alwaysExpose` are bound at startup. The rest are discovered through a built-in `mcp_tool_search` tool that runs a fuzzy match over all known downstream tools and promotes matches for the rest of the session.
4. `token-report` command estimates how many tokens each downstream spends on its schemas.
5. Library half is published as `@swarmclawai/mcp-core` — no MCP-server binding, just primitives: `DownstreamManager`, `McpRequestRouter`, `McpMultiClient`, `SessionToolPromoter`, token estimation. Useful if you're embedding gateway behavior in your own host.

Looking for:
- Feedback on the `mcp_tool_search` shape — especially whether anyone has tried something similar and hit rough edges.
- MCP servers to add to the weekly leaderboard.
- Reports from anyone deploying it on a remote host via the HTTP mode.

MIT, no telemetry.
