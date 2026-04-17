/**
 * Token-cost benchmark for public MCP servers. Runs each entry in
 * bench/servers.json through the gateway's tokenReport and writes results
 * to bench/results.json + bench/leaderboard.md.
 *
 * Designed to run in CI on a weekly cron. Servers that fail to start (missing
 * dependency, timeout, API key required) are included in the output with
 * status=error so the leaderboard stays honest.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  McpMultiClient,
  estimateToolTokens,
  type DownstreamTool,
} from "@swarmclawai/mcp-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SERVERS_PATH = path.join(ROOT, "bench", "servers.json");
const RESULTS_JSON = path.join(ROOT, "bench", "results.json");
const LEADERBOARD_MD = path.join(ROOT, "bench", "leaderboard.md");

interface BenchServer {
  name: string;
  command: string;
  args?: string[];
  homepage?: string;
  category?: string;
}

interface BenchEntry {
  name: string;
  command: string;
  args: string[];
  homepage?: string;
  category?: string;
  status: "ok" | "error";
  tokens?: number;
  tools?: number;
  toolBreakdown?: Array<{ name: string; tokens: number }>;
  error?: string;
  durationMs: number;
}

interface BenchReport {
  generatedAt: string;
  gatewayVersion: string;
  totals: {
    servers: number;
    ok: number;
    error: number;
    totalTokens: number;
  };
  entries: BenchEntry[];
}

const PER_SERVER_TIMEOUT_MS = 30_000;

async function loadServers(): Promise<BenchServer[]> {
  const raw = JSON.parse(await fs.readFile(SERVERS_PATH, "utf8")) as {
    servers: BenchServer[];
  };
  return raw.servers;
}

async function benchmarkOne(server: BenchServer): Promise<BenchEntry> {
  const started = Date.now();
  const base: Omit<BenchEntry, "status"> = {
    name: server.name,
    command: server.command,
    args: server.args ?? [],
    homepage: server.homepage,
    category: server.category,
    durationMs: 0,
  };
  try {
    const mc = new McpMultiClient({
      config: {
        version: 1,
        namespaceSeparator: "__",
        servers: [
          {
            name: server.name,
            command: server.command,
            args: server.args ?? [],
            alwaysExpose: true,
          },
        ],
      },
      toolSearch: false,
    });
    const timed = await withTimeout(mc.connectEager(), PER_SERVER_TIMEOUT_MS);
    void timed;
    const tools: DownstreamTool[] = mc.allKnownTools();
    const toolBreakdown = tools.map((t) => ({
      name: t.prefixedName,
      tokens: estimateToolTokens({
        name: t.prefixedName,
        description: t.description,
        inputSchema: t.inputSchema,
      }),
    }));
    const totalTokens = toolBreakdown.reduce((n, t) => n + t.tokens, 0);
    await mc.shutdown();
    return {
      ...base,
      status: "ok",
      tokens: totalTokens,
      tools: tools.length,
      toolBreakdown,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ...base,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout after ${ms}ms`)),
      ms
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    );
  });
}

function renderMarkdown(report: BenchReport): string {
  const ok = report.entries.filter((e) => e.status === "ok");
  const failed = report.entries.filter((e) => e.status === "error");
  const byTokensAsc = [...ok].sort((a, b) => (a.tokens ?? 0) - (b.tokens ?? 0));
  const byTokensDesc = [...ok].sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0));
  const leanest = byTokensAsc.slice(0, 10);
  const heaviest = byTokensDesc.slice(0, 10);

  const lines: string[] = [];
  lines.push(`# MCP Server Token Leaderboard`);
  lines.push("");
  lines.push(`_Generated: ${report.generatedAt} · gateway v${report.gatewayVersion}_`);
  lines.push("");
  lines.push(
    `**${report.totals.ok}** of ${report.totals.servers} benchmarked servers started successfully, ` +
      `spending **${report.totals.totalTokens.toLocaleString()}** tokens total on tool schemas.`
  );
  lines.push("");
  lines.push(
    `> Measured by connecting each server and running \`list_tools\`, then summing estimated tokens across every advertised tool (name + description + JSON Schema). Numbers are directional — an MCP client that picks up 5 of these is spending this much just on boilerplate before you type a message.`
  );
  lines.push("");
  lines.push(`## Top 10 leanest servers`);
  lines.push("");
  lines.push(`| # | Server | Tools | Tokens | Category |`);
  lines.push(`| --: | :-- | --: | --: | :-- |`);
  leanest.forEach((e, i) => {
    lines.push(
      `| ${i + 1} | ${linkName(e)} | ${e.tools ?? 0} | ${(e.tokens ?? 0).toLocaleString()} | ${e.category ?? "-"} |`
    );
  });
  lines.push("");
  lines.push(`## Top 10 heaviest servers`);
  lines.push("");
  lines.push(`| # | Server | Tools | Tokens | Category |`);
  lines.push(`| --: | :-- | --: | --: | :-- |`);
  heaviest.forEach((e, i) => {
    lines.push(
      `| ${i + 1} | ${linkName(e)} | ${e.tools ?? 0} | ${(e.tokens ?? 0).toLocaleString()} | ${e.category ?? "-"} |`
    );
  });
  if (failed.length) {
    lines.push("");
    lines.push(`## Failed to benchmark`);
    lines.push("");
    lines.push(`| Server | Error |`);
    lines.push(`| :-- | :-- |`);
    for (const e of failed) {
      lines.push(`| ${linkName(e)} | \`${(e.error ?? "").replace(/\|/g, "\\|").slice(0, 160)}\` |`);
    }
  }
  lines.push("");
  lines.push(
    `Want your server included? Open a PR against [bench/servers.json](../bench/servers.json).`
  );
  lines.push("");
  return lines.join("\n");
}

function linkName(e: BenchEntry): string {
  return e.homepage ? `[${e.name}](${e.homepage})` : e.name;
}

async function main(): Promise<void> {
  const servers = await loadServers();
  const entries: BenchEntry[] = [];
  for (const s of servers) {
    process.stderr.write(`benchmarking ${s.name}... `);
    const entry = await benchmarkOne(s);
    process.stderr.write(
      `${entry.status}${entry.status === "ok" ? ` ${entry.tokens} tokens, ${entry.tools} tools` : ` (${entry.error})`} [${entry.durationMs}ms]\n`
    );
    entries.push(entry);
  }
  const ok = entries.filter((e) => e.status === "ok");
  const totalTokens = ok.reduce((n, e) => n + (e.tokens ?? 0), 0);
  const report: BenchReport = {
    generatedAt: new Date().toISOString(),
    gatewayVersion: "0.2.0",
    totals: {
      servers: entries.length,
      ok: ok.length,
      error: entries.length - ok.length,
      totalTokens,
    },
    entries,
  };
  await fs.writeFile(RESULTS_JSON, JSON.stringify(report, null, 2) + "\n", "utf8");
  await fs.writeFile(LEADERBOARD_MD, renderMarkdown(report), "utf8");
  process.stderr.write(`\nwrote ${RESULTS_JSON}\nwrote ${LEADERBOARD_MD}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `benchmark failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`
  );
  process.exit(1);
});
