import path from "node:path";
import os from "node:os";

/**
 * Minimal config shape we merge into — every supported agent today stores
 * MCP servers as a `{ [name]: { command, args, env?, ... } }` object under a
 * top-level key. Agents whose config lives in YAML or TOML (Goose, Codex)
 * aren't supported by this command yet — `--config-path` + manual edit is
 * the escape hatch.
 */
export interface McpServersContainer {
  [key: string]: unknown;
  mcpServers?: Record<string, unknown>;
}

export interface AgentTarget {
  /** CLI slug (e.g. "claude-code", "cursor"). */
  id: string;
  /** Human-friendly label for help output. */
  label: string;
  /** Absolute path to the config JSON file for the current user. */
  defaultConfigPath: () => string;
  /**
   * Key inside the config file that holds MCP servers. Every JSON agent we
   * support today uses "mcpServers"; kept configurable in case an agent
   * ships a different key later.
   */
  mcpServersKey: string;
  /**
   * Human-readable notes about where this agent's config lives and how to
   * verify the install. Surfaced by `help-agents` so an LLM installer sees
   * them alongside the flag it just set.
   */
  notes: string;
}

const HOME = os.homedir();

export const AGENT_TARGETS: AgentTarget[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    defaultConfigPath: () => path.join(HOME, ".claude", "settings.json"),
    mcpServersKey: "mcpServers",
    notes: "Installs globally. For a project-scoped install, pass --config-path ./.claude/settings.json.",
  },
  {
    id: "cursor",
    label: "Cursor",
    defaultConfigPath: () => path.join(HOME, ".cursor", "mcp.json"),
    mcpServersKey: "mcpServers",
    notes: "Installs globally. For a project-scoped install, pass --config-path ./.cursor/mcp.json.",
  },
  {
    id: "windsurf",
    label: "Windsurf",
    defaultConfigPath: () =>
      path.join(HOME, ".codeium", "windsurf", "mcp_config.json"),
    mcpServersKey: "mcpServers",
    notes: "Windsurf reloads MCP config automatically on save.",
  },
  {
    id: "cline",
    label: "Cline (VS Code extension)",
    defaultConfigPath: () =>
      process.platform === "darwin"
        ? path.join(
            HOME,
            "Library",
            "Application Support",
            "Code",
            "User",
            "globalStorage",
            "saoudrizwan.claude-dev",
            "settings",
            "cline_mcp_settings.json"
          )
        : process.platform === "win32"
          ? path.join(
              HOME,
              "AppData",
              "Roaming",
              "Code",
              "User",
              "globalStorage",
              "saoudrizwan.claude-dev",
              "settings",
              "cline_mcp_settings.json"
            )
          : path.join(
              HOME,
              ".config",
              "Code",
              "User",
              "globalStorage",
              "saoudrizwan.claude-dev",
              "settings",
              "cline_mcp_settings.json"
            ),
    mcpServersKey: "mcpServers",
    notes: "VS Code extension path varies by OS — override with --config-path if your install differs.",
  },
];

export function findTarget(id: string): AgentTarget | undefined {
  return AGENT_TARGETS.find((t) => t.id === id);
}

export const GATEWAY_ENTRY_COMMAND = "npx";
export const GATEWAY_ENTRY_ARGS = [
  "-y",
  "@swarmclawai/mcp-gateway@latest",
  "start",
];

export interface PlannedInstall {
  target: AgentTarget;
  configPath: string;
  entryName: string;
  entry: { command: string; args: string[]; cwd?: string };
  action: "create" | "insert" | "replace" | "noop";
  existing?: unknown;
}

/**
 * Pure planner — decides what the install would do without touching disk.
 * Returns the merged config plus a description of the action so the CLI can
 * dry-run it.
 */
export function planInstall(
  existingConfig: McpServersContainer | undefined,
  opts: {
    target: AgentTarget;
    configPath: string;
    entryName: string;
    gatewayCwd?: string;
  }
): { next: McpServersContainer; plan: PlannedInstall } {
  const next: McpServersContainer = existingConfig
    ? { ...existingConfig }
    : {};
  const servers: Record<string, unknown> = {
    ...((next[opts.target.mcpServersKey] as Record<string, unknown>) ?? {}),
  };
  const proposed = {
    command: GATEWAY_ENTRY_COMMAND,
    args: GATEWAY_ENTRY_ARGS,
    ...(opts.gatewayCwd ? { cwd: opts.gatewayCwd } : {}),
  };
  let action: PlannedInstall["action"];
  const existing = servers[opts.entryName];
  if (!existingConfig) {
    action = "create";
  } else if (!existing) {
    action = "insert";
  } else if (entriesMatch(existing, proposed)) {
    action = "noop";
  } else {
    action = "replace";
  }
  servers[opts.entryName] = proposed;
  next[opts.target.mcpServersKey] = servers;
  return {
    next,
    plan: {
      target: opts.target,
      configPath: opts.configPath,
      entryName: opts.entryName,
      entry: proposed,
      action,
      existing,
    },
  };
}

function entriesMatch(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a == null || b == null) {
    return false;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  if (ao.command !== bo.command) return false;
  if (JSON.stringify(ao.args ?? []) !== JSON.stringify(bo.args ?? [])) return false;
  if ((ao.cwd ?? undefined) !== (bo.cwd ?? undefined)) return false;
  return true;
}
