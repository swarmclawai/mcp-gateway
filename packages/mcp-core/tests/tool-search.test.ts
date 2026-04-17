import { describe, it, expect } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  searchTools,
  SessionToolPromoter,
  TOOL_SEARCH_NAME,
} from "../src/tool-search.js";
import { McpMultiClient } from "../src/multi-client.js";
import type { ClientTransportFactory, DownstreamTool } from "../src/downstream.js";

describe("searchTools", () => {
  const pool: DownstreamTool[] = [
    {
      name: "read_file",
      prefixedName: "fs__read_file",
      description: "Read a file from disk",
      alwaysExposed: true,
    },
    {
      name: "list_issues",
      prefixedName: "github__list_issues",
      description: "List GitHub issues in a repository",
      alwaysExposed: false,
    },
    {
      name: "run_sql",
      prefixedName: "db__run_sql",
      description: "Execute a SQL query against Postgres",
      alwaysExposed: false,
    },
  ];

  it("returns no matches for empty query", () => {
    expect(searchTools(pool, { query: "" }).matches).toHaveLength(0);
  });

  it("matches on tool name substring", () => {
    const matches = searchTools(pool, { query: "read_file" }).matches;
    expect(matches[0]?.name).toBe("fs__read_file");
  });

  it("matches on description keywords", () => {
    const matches = searchTools(pool, { query: "github issues" }).matches;
    expect(matches[0]?.name).toBe("github__list_issues");
  });

  it("honors limit", () => {
    const matches = searchTools(pool, { query: "read list run", limit: 2 }).matches;
    expect(matches.length).toBeLessThanOrEqual(2);
  });
});

describe("SessionToolPromoter", () => {
  it("promotes names and reports them as allowed", () => {
    const p = new SessionToolPromoter();
    expect(p.allow("fs__read_file")).toBe(false);
    p.promote("fs__read_file");
    expect(p.allow("fs__read_file")).toBe(true);
    expect(p.promoted()).toEqual(["fs__read_file"]);
  });
});

async function makeDownstream(tools: Tool[]) {
  const server = new Server(
    { name: "t", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );
  const calls: { name: string; args: unknown }[] = [];
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    calls.push({ name: req.params.name, args: req.params.arguments });
    return { content: [{ type: "text", text: `ok:${req.params.name}` }] };
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  return { server, transport: clientTransport, calls };
}

describe("router + mcp_tool_search integration", () => {
  it("exposes the meta-tool and promotes lazy tools after search", async () => {
    const fs = await makeDownstream([
      { name: "read_file", description: "read a file", inputSchema: { type: "object" } },
    ]);
    const gh = await makeDownstream([
      {
        name: "list_issues",
        description: "list github issues",
        inputSchema: { type: "object" },
      },
    ]);
    const transportFactory: ClientTransportFactory = (spec) => {
      if (spec.name === "fs") return fs.transport as never;
      if (spec.name === "gh") return gh.transport as never;
      throw new Error(`no transport for ${spec.name}`);
    };
    const mc = new McpMultiClient({
      config: {
        version: 1,
        namespaceSeparator: "__",
        servers: [
          { name: "fs", command: "unused", alwaysExpose: true },
          { name: "gh", command: "unused", alwaysExpose: false },
        ],
      },
      transportFactory,
    });
    await mc.connectEager();
    await mc.connect("gh"); // ensure gh schema discovered

    // Before search: only fs__read_file + mcp_tool_search are exposed
    const before = (await mc.listExposedTools()).map((t) => t.name).sort();
    expect(before).toContain("fs__read_file");
    expect(before).toContain(TOOL_SEARCH_NAME);
    expect(before).not.toContain("gh__list_issues");

    // Run the search tool
    const searchResult = (await mc.callTool(TOOL_SEARCH_NAME, {
      query: "issues",
    })) as { content: Array<{ type: "text"; text: string }> };
    const parsed = JSON.parse(searchResult.content[0].text) as {
      matches: Array<{ name: string }>;
    };
    expect(parsed.matches.some((m) => m.name === "gh__list_issues")).toBe(true);

    // After search: gh__list_issues now shows up in list_tools
    const after = (await mc.listExposedTools()).map((t) => t.name).sort();
    expect(after).toContain("gh__list_issues");

    // And the agent can actually call it
    await mc.callTool("gh__list_issues", { state: "open" });
    expect(gh.calls).toEqual([{ name: "list_issues", args: { state: "open" } }]);

    await mc.shutdown();
  });

  it("omits the meta-tool when toolSearch is false", async () => {
    const fs = await makeDownstream([
      { name: "read_file", description: "read", inputSchema: { type: "object" } },
    ]);
    const transportFactory: ClientTransportFactory = () => fs.transport as never;
    const mc = new McpMultiClient({
      config: {
        version: 1,
        namespaceSeparator: "__",
        servers: [{ name: "fs", command: "unused", alwaysExpose: true }],
      },
      transportFactory,
      toolSearch: false,
    });
    await mc.connectEager();
    const names = (await mc.listExposedTools()).map((t) => t.name);
    expect(names).toEqual(["fs__read_file"]);
    await mc.shutdown();
  });
});
