import { describe, it, expect } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { McpMultiClient } from "../src/multi-client.js";
import type { ClientTransportFactory } from "../src/downstream.js";

async function makeDownstreamServer(
  tools: Tool[]
): Promise<{ server: Server; transport: InMemoryTransport; calls: { name: string; args: unknown }[] }> {
  const server = new Server(
    { name: "test-downstream", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );
  const calls: { name: string; args: unknown }[] = [];
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    calls.push({ name: req.params.name, args: req.params.arguments });
    return { content: [{ type: "text", text: `echo:${req.params.name}` }] };
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  return { server, transport: clientTransport as unknown as InMemoryTransport, calls };
}

describe("McpMultiClient", () => {
  it("lists exposed tools from alwaysExpose:true servers and routes call_tool", async () => {
    const fs = await makeDownstreamServer([
      { name: "read_file", description: "read", inputSchema: { type: "object" } },
    ]);
    const gh = await makeDownstreamServer([
      { name: "list_issues", description: "list", inputSchema: { type: "object" } },
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

    const listed = await mc.listExposedTools();
    const names = listed.map((t) => t.name).sort();
    // mcp_tool_search is exposed by default so agents have a discovery path
    expect(names).toEqual(["fs__read_file", "mcp_tool_search"]);

    await mc.callTool("fs__read_file", { path: "/tmp/x" });
    expect(fs.calls).toEqual([{ name: "read_file", args: { path: "/tmp/x" } }]);

    // Lazy server's tool is still reachable by its prefixed name
    await mc.callTool("gh__list_issues", { state: "open" });
    expect(gh.calls).toEqual([{ name: "list_issues", args: { state: "open" } }]);

    await mc.shutdown();
  });

  it("tokenReport separates exposed vs. total tokens", async () => {
    const fs = await makeDownstreamServer([
      {
        name: "read_file",
        description: "read a file",
        inputSchema: { type: "object", properties: { path: { type: "string" } } },
      },
    ]);
    const gh = await makeDownstreamServer([
      {
        name: "list_issues",
        description: "list issues",
        inputSchema: { type: "object", properties: { state: { type: "string" } } },
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
    // force gh connect so its schema is discovered for the token report
    await mc.connect("gh");

    const report = mc.tokenReport();
    expect(report.totalAvailableTokens).toBeGreaterThan(report.totalExposedTokens);
    const fsLine = report.servers.find((s) => s.name === "fs")!;
    const ghLine = report.servers.find((s) => s.name === "gh")!;
    expect(fsLine.alwaysExposed).toBe(true);
    expect(ghLine.alwaysExposed).toBe(false);

    await mc.shutdown();
  });
});
