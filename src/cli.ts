#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { promises as fs } from "node:fs";
import { Command, InvalidArgumentError } from "commander";
import {
  defaultConfigPath,
  loadConfigFile,
  parseConfig,
  configSchema,
  serverSpecSchema,
  type GatewayConfig,
} from "./config.js";
import { Gateway } from "./server.js";

const PKG_VERSION = "0.1.0";
const OK = 0;
const USER_ERROR = 1;
const INTERNAL_ERROR = 2;

interface GlobalFlags {
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  cwd?: string;
  config?: string;
}

function successJson(data: unknown): void {
  process.stdout.write(JSON.stringify({ ok: true, data }) + "\n");
}

function errorJson(code: string, message: string, hint?: string): void {
  process.stdout.write(
    JSON.stringify({ ok: false, error: { code, message, ...(hint ? { hint } : {}) } }) + "\n"
  );
}

function log(msg: string, flags: GlobalFlags): void {
  if (flags.quiet) return;
  process.stderr.write(msg + "\n");
}

function mergeFlags(cmd: Command): GlobalFlags {
  let current: Command | null = cmd;
  const merged: Record<string, unknown> = {};
  while (current) {
    Object.assign(merged, current.opts());
    current = current.parent;
  }
  return merged as GlobalFlags;
}

function resolveArg(arg: string, flags: GlobalFlags): string {
  if (path.isAbsolute(arg)) return arg;
  return path.resolve(flags.cwd ? path.resolve(flags.cwd) : process.cwd(), arg);
}

function resolveConfigPath(flags: GlobalFlags): string {
  if (flags.config) return resolveArg(flags.config, flags);
  return defaultConfigPath();
}

async function readConfig(flags: GlobalFlags): Promise<GatewayConfig> {
  const p = resolveConfigPath(flags);
  const exists = await fs
    .stat(p)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    throw new Error(
      `config not found at ${p}. Create one with 'mcp-gateway init' or pass --config <path>.`
    );
  }
  return loadConfigFile(p);
}

function buildProgram(): Command {
  const program = new Command();
  program
    .name("mcp-gateway")
    .description(
      "Local MCP gateway: fans out to N downstream MCP servers, namespaces tools, and lazy-loads schemas so your context window isn't eaten by MCP boilerplate."
    )
    .version(PKG_VERSION)
    .option("--json", "emit machine-readable JSON on stdout")
    .option("--quiet", "suppress stderr logs")
    .option("--verbose", "print verbose logs on stderr")
    .option("--cwd <path>", "override working directory for relative paths")
    .option("--config <path>", "path to mcp-gateway.config.json");

  program
    .command("start")
    .description("start the gateway (speaks MCP over stdio to the upstream client)")
    .action(async (_opts, cmd: Command) => {
      const flags = mergeFlags(cmd);
      try {
        const config = await readConfig(flags);
        const gateway = new Gateway({
          config,
          name: "mcp-gateway",
          version: PKG_VERSION,
          onLog: (msg) => log(msg, flags),
        });
        const shutdown = async () => {
          await gateway.shutdown();
          process.exit(OK);
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
        await gateway.start();
      } catch (err) {
        exitUserOrInternal(err, flags);
      }
    });

  program
    .command("status")
    .description("print gateway configuration and connection status")
    .action(async (_opts, cmd: Command) => {
      const flags = mergeFlags(cmd);
      try {
        const config = await readConfig(flags);
        const gateway = new Gateway({
          config,
          onLog: (msg) => log(msg, flags),
        });
        await gateway.downstreams.connectEager();
        const snapshot = {
          config: { path: resolveConfigPath(flags), servers: config.servers.length },
          downstreams: Array.from(gateway.downstreams.downstreams.values()).map((ds) => ({
            name: ds.spec.name,
            status: ds.status,
            enabled: ds.spec.enabled,
            alwaysExpose: ds.spec.alwaysExpose,
            tools: ds.tools.length,
            lastError: ds.lastError ?? null,
          })),
        };
        await gateway.downstreams.shutdown();
        if (flags.json) {
          successJson(snapshot);
        } else {
          process.stdout.write(`config: ${snapshot.config.path}\n`);
          for (const ds of snapshot.downstreams) {
            process.stdout.write(
              `  ${ds.name.padEnd(20)} ${ds.status.padEnd(10)} tools=${ds.tools} alwaysExpose=${JSON.stringify(ds.alwaysExpose)}${ds.lastError ? `  error=${ds.lastError}` : ""}\n`
            );
          }
        }
        process.exit(OK);
      } catch (err) {
        exitUserOrInternal(err, flags);
      }
    });

  program
    .command("token-report")
    .description("estimate tokens each downstream spends on tool schemas")
    .action(async (_opts, cmd: Command) => {
      const flags = mergeFlags(cmd);
      try {
        const config = await readConfig(flags);
        const gateway = new Gateway({
          config,
          onLog: (msg) => log(msg, flags),
        });
        await gateway.downstreams.connectEager();
        const report = gateway.tokenReport();
        await gateway.downstreams.shutdown();
        if (flags.json) {
          successJson(report);
        } else {
          process.stdout.write(
            `total exposed: ${report.totalExposedTokens} tokens  |  total available: ${report.totalAvailableTokens} tokens\n`
          );
          for (const s of report.servers) {
            process.stdout.write(
              `  ${s.name.padEnd(20)} ${String(s.tokens).padStart(6)} tokens  ${s.exposed ? "(exposed)" : "(lazy)"}\n`
            );
            if (flags.verbose) {
              for (const t of s.tools) {
                process.stdout.write(
                  `      ${t.name.padEnd(50)} ${String(t.tokens).padStart(6)} tokens\n`
                );
              }
            }
          }
        }
        process.exit(OK);
      } catch (err) {
        exitUserOrInternal(err, flags);
      }
    });

  program
    .command("validate")
    .description("validate mcp-gateway.config.json without connecting to any downstream")
    .action(async (_opts, cmd: Command) => {
      const flags = mergeFlags(cmd);
      try {
        const config = await readConfig(flags);
        if (flags.json) {
          successJson({
            path: resolveConfigPath(flags),
            servers: config.servers.length,
            names: config.servers.map((s) => s.name),
          });
        } else {
          process.stdout.write(
            `ok: ${resolveConfigPath(flags)} has ${config.servers.length} server(s)\n`
          );
          for (const s of config.servers) {
            process.stdout.write(`  - ${s.name}  (${s.command})\n`);
          }
        }
        process.exit(OK);
      } catch (err) {
        exitUserOrInternal(err, flags);
      }
    });

  program
    .command("add-server")
    .description("append a downstream server to the config file")
    .argument("<name>", "server name (lowercase, used as namespace prefix)")
    .argument("<command>", "executable to spawn")
    .argument("[args...]", "arguments to pass to the command")
    .option("--always-expose <tools>", "comma-separated tool names to pre-expose, or 'all'")
    .option("--write", "write the updated config (otherwise print to stdout)")
    .action(async (name: string, command: string, args: string[], _opts, cmd: Command) => {
      const flags = mergeFlags(cmd);
      const opts = cmd.opts<{ alwaysExpose?: string; write?: boolean }>();
      try {
        const configPath = resolveConfigPath(flags);
        const exists = await fs.stat(configPath).then(() => true).catch(() => false);
        const existing: GatewayConfig = exists
          ? await loadConfigFile(configPath)
          : parseConfig({ version: 1, servers: [{ name: "__placeholder", command: "echo" }] });
        const servers = exists ? existing.servers : [];
        const spec = serverSpecSchema.parse({
          name,
          command,
          args,
          alwaysExpose: parseAlwaysExpose(opts.alwaysExpose),
        });
        const withoutDupe = servers.filter((s) => s.name !== name);
        const next: GatewayConfig = {
          ...existing,
          servers: [...withoutDupe, spec],
        };
        const serialized = JSON.stringify(next, null, 2) + "\n";
        if (opts.write) {
          await fs.writeFile(configPath, serialized, "utf8");
          if (flags.json) {
            successJson({ path: configPath, server: spec });
          } else {
            log(`wrote ${configPath}`, flags);
          }
        } else {
          if (flags.json) {
            successJson({ config: next, wouldWriteTo: configPath });
          } else {
            process.stdout.write(serialized);
          }
        }
        process.exit(OK);
      } catch (err) {
        exitUserOrInternal(err, flags);
      }
    });

  program
    .command("init")
    .description("create a starter mcp-gateway.config.json")
    .option("--write", "write the file (otherwise print to stdout)")
    .action(async (_opts, cmd: Command) => {
      const flags = mergeFlags(cmd);
      const opts = cmd.opts<{ write?: boolean }>();
      try {
        const starter = configSchema.parse({
          version: 1,
          namespaceSeparator: "__",
          servers: [
            {
              name: "filesystem",
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
              alwaysExpose: true,
              description: "Reference filesystem server, exposed by default",
            },
            {
              name: "github",
              command: "docker",
              args: [
                "run",
                "-i",
                "--rm",
                "-e",
                "GITHUB_PERSONAL_ACCESS_TOKEN",
                "ghcr.io/github/github-mcp-server",
              ],
              alwaysExpose: false,
              description: "Lazy-loaded — only surfaces when you ask for a github__ tool",
            },
          ],
        });
        const serialized = JSON.stringify(starter, null, 2) + "\n";
        const configPath = resolveConfigPath(flags);
        if (opts.write) {
          const exists = await fs.stat(configPath).then(() => true).catch(() => false);
          if (exists) {
            throw new Error(
              `refusing to overwrite existing config at ${configPath}. Delete it first if you want to regenerate.`
            );
          }
          await fs.writeFile(configPath, serialized, "utf8");
          if (flags.json) successJson({ path: configPath });
          else log(`wrote ${configPath}`, flags);
        } else if (flags.json) {
          successJson({ config: starter, wouldWriteTo: configPath });
        } else {
          process.stdout.write(serialized);
        }
        process.exit(OK);
      } catch (err) {
        exitUserOrInternal(err, flags);
      }
    });

  program
    .command("help-agents")
    .description("print machine-readable CLI catalog (for coding agents)")
    .action(() => {
      const catalog = {
        name: "mcp-gateway",
        version: PKG_VERSION,
        globals: [
          { name: "--json", type: "boolean" },
          { name: "--quiet", type: "boolean" },
          { name: "--verbose", type: "boolean" },
          { name: "--cwd", type: "path" },
          { name: "--config", type: "path", default: "./mcp-gateway.config.json" },
        ],
        commands: [
          {
            name: "start",
            description: "start the gateway (stdio server for an upstream MCP client)",
            args: [],
            flags: [],
            returns: { ok: "boolean", data: "streaming MCP protocol" },
          },
          {
            name: "status",
            description: "snapshot downstream connection state",
            args: [],
            flags: [],
            returns: {
              ok: "boolean",
              data: { config: "object", downstreams: "DownstreamStatus[]" },
            },
          },
          {
            name: "token-report",
            description: "estimate tokens each downstream spends on tool schemas",
            args: [],
            flags: [],
            returns: { ok: "boolean", data: "TokenReport" },
          },
          {
            name: "validate",
            description: "validate the config file without connecting to downstreams",
            args: [],
            flags: [],
            returns: {
              ok: "boolean",
              data: { path: "string", servers: "number", names: "string[]" },
            },
          },
          {
            name: "add-server",
            description: "append a downstream server to the config file",
            args: [
              { name: "name", required: true, type: "string" },
              { name: "command", required: true, type: "string" },
              { name: "args", required: false, type: "string[]" },
            ],
            flags: [
              { name: "--always-expose", type: "string" },
              { name: "--write", type: "boolean" },
            ],
            returns: { ok: "boolean", data: { path: "string", server: "ServerSpec" } },
          },
          {
            name: "init",
            description: "create a starter config file",
            args: [],
            flags: [{ name: "--write", type: "boolean" }],
            returns: { ok: "boolean", data: { path: "string" } },
          },
        ],
        fileConvention: "mcp-gateway.config.json at cwd (or --config <path>)",
      };
      process.stdout.write(JSON.stringify({ ok: true, data: catalog }) + "\n");
      process.exit(OK);
    });

  return program;
}

function parseAlwaysExpose(raw: string | undefined): boolean | string[] {
  if (raw === undefined) return false;
  if (raw === "all") return true;
  if (raw === "none") return false;
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length === 0 ? false : parts;
}

function exitUserOrInternal(err: unknown, flags: GlobalFlags): never {
  const message = err instanceof Error ? err.message : String(err);
  // Validation-ish messages should exit 1; surprise crashes should exit 2.
  const looksUserCaused =
    /config|unknown|refusing|duplicate|HTTP \d|parse|required/i.test(message);
  const code = looksUserCaused ? USER_ERROR : INTERNAL_ERROR;
  if (flags.json) {
    errorJson(looksUserCaused ? "E_VALIDATION" : "E_INTERNAL", message);
  } else {
    process.stderr.write(`error: ${message}\n`);
  }
  process.exit(code);
}

async function main(): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    const flags = program.opts<GlobalFlags>();
    if (err instanceof InvalidArgumentError) {
      if (flags.json) {
        errorJson("E_VALIDATION", err.message);
      } else {
        process.stderr.write(`error: ${err.message}\n`);
      }
      process.exit(USER_ERROR);
    }
    exitUserOrInternal(err, flags);
  }
}

main();
