# Contributing

## Local dev

```bash
pnpm install
pnpm run build
pnpm run test
pnpm run typecheck
```

## Testing strategy

- **Unit tests** cover config validation and token math.
- **Integration tests** exercise the `DownstreamManager` against real MCP servers via `@modelcontextprotocol/sdk`'s `InMemoryTransport`. No child processes are spawned during tests — the test plants a real `Server` and `Client` in memory.

If you're adding code that interacts with downstream servers, prefer writing the test as an in-memory integration test rather than mocking the SDK.

## Adding a new exposure mode

Today we support `alwaysExpose: true | false | string[]`. If you add a new mode (e.g. `alwaysExpose: { match: "regex" }`):

1. Extend `serverSpecSchema` in `src/config.ts`.
2. Update `resolvedServerAlwaysExposed` and the gateway's `tokenReport` logic.
3. Cover the new shape in `tests/config.test.ts` + `tests/gateway.test.ts`.
4. Document in `AGENTS.md`.

## Style

- Stderr for logs, stdout for data.
- Every command must support `--json` and update the `help-agents` catalog.
- Keep the CLI non-interactive.
- Don't call into the real MCP SDK transport layer from unit tests — use `InMemoryTransport`.

## Commit style

```
config: allow regex match on alwaysExpose
server: fix double-connect on lazy prefix hit
tokens: bump chars/token ratio to match Claude tokenizer
```
