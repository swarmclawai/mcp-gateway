# Release process

Two packages ship from this monorepo:

- `@swarmclawai/mcp-core` — the library primitives
- `@swarmclawai/mcp-gateway` — the CLI + stdio/HTTP server that wraps them

`mcp-gateway` depends on `mcp-core` via `workspace:^`, so `pnpm publish` rewrites that to the published version automatically. **Always use `pnpm publish`** — `npm publish` will leave the `workspace:^` literal in the published package.json and break installs.

## Manual release

From a clean working tree on `main`:

```bash
pnpm install --frozen-lockfile
pnpm -r run build
pnpm -r run typecheck
pnpm -r run test

# Bump versions — bump mcp-core first so the gateway's workspace:^ resolves
# to the new version.
pnpm --filter @swarmclawai/mcp-core version patch   # or minor / major
pnpm --filter @swarmclawai/mcp-gateway version patch

git add .
git commit -m "release: mcp-core vX.Y.Z + mcp-gateway vX.Y.Z"
git tag vX.Y.Z
git push && git push --tags

# Publish mcp-core first (gateway depends on it being resolvable).
pnpm --filter @swarmclawai/mcp-core publish --access public
pnpm --filter @swarmclawai/mcp-gateway publish --access public
```

## Automated release

Tagging a commit matching `v*` triggers `.github/workflows/release.yml`, which runs the full build + test + publish for both packages using an `NPM_TOKEN` secret.

## Pre-release checklist

- `pnpm -r run test` — all green.
- `pnpm -r run typecheck` — clean.
- `pnpm --filter @swarmclawai/mcp-gateway exec node dist/cli.js help-agents` — CLI snapshot works.
- README is up to date with the new surface area.
- Breaking changes have a `CHANGELOG.md` entry and a migration note.
- For major bumps of `mcp-core`: downstream embedders (SwarmClaw at minimum) have a PR open against the new API.
