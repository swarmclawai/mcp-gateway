# @swarmclawai/mcp-gateway — Changelog

## 0.2.0 — Library split + HTTP + agent installer + tool search

### Breaking

- **Monorepo split.** The pure primitives (config, DownstreamManager, router, token estimator) moved to a new package: `@swarmclawai/mcp-core`. `@swarmclawai/mcp-gateway` re-exports everything from `mcp-core` for back-compat, so typical CLI users are unaffected — but if you imported internals like `DownstreamManager` directly, prefer importing from `@swarmclawai/mcp-core` going forward.
- **Config schema extension.** Downstream servers now accept either `command` (stdio, as before) or `url` (streamable-http, new). Exactly one must be set — a config with both, or with neither, is rejected by `parseConfig`. Existing stdio-only configs keep working unchanged.

### Added

- **`mcp_tool_search` meta-tool.** The gateway now exposes one built-in tool by default. Agents call it with `{query, limit?}` to discover lazy (`alwaysExpose: false`) tools by name or description. Matched tools are promoted for the rest of the session and start appearing in subsequent `list_tools` responses. Disable with `toolSearch: false` on the `Gateway` options.
- **HTTP/SSE upstream transport.** `npx mcp-gateway start --http --port 3477 [--host 127.0.0.1]` runs the gateway as a streamable-http server at `POST /mcp` instead of stdio. Useful when an agent on a VPS wants to reach a local gateway, or when a client prefers HTTP to spawning subprocesses. `GET /healthz` returns `{ok: true}`.
- **HTTP downstream transport.** Downstream servers can now be remote HTTP endpoints — set `url` + optional `headers` in the config. The gateway auto-selects stdio vs HTTP via `defaultClientTransportFactory` based on which field the spec provides.
- **`npx mcp-gateway add <agent>`.** One-command install into an upstream agent's MCP config. Supports `claude-code`, `cursor`, `cline`, `windsurf`. `--dry-run` prints the planned merge without writing; `--force` overwrites an existing entry with a different command; `.bak` backup of the original config is always created when the config exists.
- **Token leaderboard scaffolding.** `bench/servers.json` + `scripts/benchmark.ts` + a weekly `.github/workflows/leaderboard.yml` workflow publish per-server token costs to `bench/leaderboard.md`.
- **`SessionToolPromoter`** re-exported from `@swarmclawai/mcp-core` for embedders that want to share promoter state across multiple clients.

### Changed

- Default behavior of `Gateway` is now to enable the `mcp_tool_search` meta-tool. Pass `toolSearch: false` to restore pre-0.2.0 behavior where only `alwaysExpose: true` servers contribute to `list_tools`.
- CLI `start` command gained `--http`, `--port`, `--host` options. Running `start` with no flags is still stdio mode as before.
- `help-agents` output expanded with the new `add` command and `start` flags.
- Bumped `name` of the gateway's client identity from `mcp-gateway 0.1.0` to `mcp-gateway 0.2.0` in downstream handshake.

### Notes

- `@swarmclawai/mcp-gateway` now depends on `@swarmclawai/mcp-core` via `workspace:^`. `pnpm publish` rewrites this to the published version automatically — **do not use `npm publish`** or the `workspace:^` literal will leak into the published `package.json`.

## 0.1.0 — Initial release

- Local MCP gateway that fans out to N downstream stdio servers, namespaces their tools with a configurable separator, and lazy-loads schemas.
- CLI: `init`, `validate`, `status`, `token-report`, `add-server`, `start`, `help-agents`.
- `alwaysExpose: true | false | string[]` per-server policy.
