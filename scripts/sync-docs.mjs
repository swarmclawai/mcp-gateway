#!/usr/bin/env node
/**
 * Sync the canonical monorepo-root docs (README, AGENTS, CONTRIBUTING, LICENSE)
 * into each publishable package. Each published tarball should carry its own
 * copy so npm readers see full context without hopping to the repo.
 *
 * mcp-core gets only LICENSE — its README is package-specific.
 * mcp-gateway gets the full set.
 *
 * Run manually: `pnpm sync-docs`. The release workflow runs this before
 * publishing so the tarballs never drift.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const TARGETS = [
  {
    package: "mcp-core",
    files: ["LICENSE"],
  },
  {
    package: "mcp-gateway",
    files: ["LICENSE", "README.md", "AGENTS.md", "CONTRIBUTING.md"],
  },
];

async function copyOne(src, dest) {
  await fs.copyFile(src, dest);
  const rel = path.relative(ROOT, dest);
  process.stdout.write(`  → ${rel}\n`);
}

async function main() {
  process.stdout.write(`Syncing docs from ${ROOT}\n`);
  for (const target of TARGETS) {
    const pkgDir = path.join(ROOT, "packages", target.package);
    const exists = await fs.stat(pkgDir).then(() => true).catch(() => false);
    if (!exists) {
      process.stderr.write(`skipping ${target.package}: ${pkgDir} does not exist\n`);
      continue;
    }
    for (const file of target.files) {
      const src = path.join(ROOT, file);
      const dest = path.join(pkgDir, file);
      const srcExists = await fs.stat(src).then(() => true).catch(() => false);
      if (!srcExists) {
        process.stderr.write(`skipping ${file}: not found at ${src}\n`);
        continue;
      }
      await copyOne(src, dest);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`sync-docs failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
