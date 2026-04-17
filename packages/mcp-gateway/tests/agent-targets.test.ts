import { describe, it, expect } from "vitest";
import {
  AGENT_TARGETS,
  findTarget,
  planInstall,
  GATEWAY_ENTRY_COMMAND,
  GATEWAY_ENTRY_ARGS,
  type McpServersContainer,
} from "../src/agent-targets.js";

describe("findTarget", () => {
  it("returns known agent targets", () => {
    expect(findTarget("claude-code")).toBeDefined();
    expect(findTarget("cursor")).toBeDefined();
    expect(findTarget("windsurf")).toBeDefined();
    expect(findTarget("cline")).toBeDefined();
  });
  it("returns undefined for unknown", () => {
    expect(findTarget("not-a-real-agent")).toBeUndefined();
  });
});

describe("planInstall", () => {
  const target = findTarget("claude-code")!;

  it("creates a fresh config when none exists", () => {
    const { next, plan } = planInstall(undefined, {
      target,
      configPath: "/tmp/settings.json",
      entryName: "mcp-gateway",
    });
    expect(plan.action).toBe("create");
    expect((next.mcpServers as Record<string, unknown>)["mcp-gateway"]).toEqual({
      command: GATEWAY_ENTRY_COMMAND,
      args: GATEWAY_ENTRY_ARGS,
    });
  });

  it("inserts into an existing config that has other servers", () => {
    const existing: McpServersContainer = {
      mcpServers: { filesystem: { command: "npx", args: ["-y", "fs"] } },
      otherKey: true,
    };
    const { next, plan } = planInstall(existing, {
      target,
      configPath: "/tmp/settings.json",
      entryName: "mcp-gateway",
    });
    expect(plan.action).toBe("insert");
    const servers = next.mcpServers as Record<string, unknown>;
    expect(servers["filesystem"]).toBeDefined();
    expect(servers["mcp-gateway"]).toBeDefined();
    // Preserves unrelated top-level keys
    expect(next.otherKey).toBe(true);
  });

  it("is a noop when the entry is identical", () => {
    const existing: McpServersContainer = {
      mcpServers: {
        "mcp-gateway": {
          command: GATEWAY_ENTRY_COMMAND,
          args: GATEWAY_ENTRY_ARGS,
        },
      },
    };
    const { plan } = planInstall(existing, {
      target,
      configPath: "/tmp/settings.json",
      entryName: "mcp-gateway",
    });
    expect(plan.action).toBe("noop");
  });

  it("reports replace when the existing entry differs", () => {
    const existing: McpServersContainer = {
      mcpServers: {
        "mcp-gateway": { command: "something-else", args: ["x"] },
      },
    };
    const { plan } = planInstall(existing, {
      target,
      configPath: "/tmp/settings.json",
      entryName: "mcp-gateway",
    });
    expect(plan.action).toBe("replace");
    expect(plan.existing).toEqual({ command: "something-else", args: ["x"] });
  });

  it("includes cwd when gatewayCwd is provided", () => {
    const { next } = planInstall(undefined, {
      target,
      configPath: "/tmp/settings.json",
      entryName: "mcp-gateway",
      gatewayCwd: "/var/vaults/mine",
    });
    const entry = (next.mcpServers as Record<string, unknown>)["mcp-gateway"];
    expect(entry).toMatchObject({ cwd: "/var/vaults/mine" });
  });
});

describe("AGENT_TARGETS", () => {
  it("has at least claude-code, cursor, windsurf, cline", () => {
    const ids = AGENT_TARGETS.map((t) => t.id);
    expect(ids).toContain("claude-code");
    expect(ids).toContain("cursor");
    expect(ids).toContain("windsurf");
    expect(ids).toContain("cline");
  });
});
