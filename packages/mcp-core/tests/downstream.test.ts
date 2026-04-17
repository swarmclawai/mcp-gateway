import { describe, it, expect } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { DownstreamManager } from "../src/downstream.js";
import type { DownstreamClient } from "../src/downstream.js";
import { serverSpecSchema } from "../src/config.js";

// Build a tiny in-memory MCP "downstream" so we can exercise the manager
// without spawning a child process.
function makeDownstreamServer(tools: Tool[]): {
  server: Server;
  handlerCalls: { name: string; args: unknown }[];
} {
  const server = new Server(
    { name: "test-downstream", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );
  const handlerCalls: { name: string; args: unknown }[] = [];
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    handlerCalls.push({
      name: req.params.name,
      args: req.params.arguments,
    });
    return {
      content: [{ type: "text", text: `echo:${req.params.name}` }],
    };
  });
  return { server, handlerCalls };
}

// Link a DownstreamManager entry to an in-memory transport pair so the manager
// talks to the test server directly (no child process).
async function linkDownstream(
  manager: DownstreamManager,
  name: string,
  tools: Tool[]
): Promise<{
  ds: DownstreamClient;
  handlerCalls: { name: string; args: unknown }[];
}> {
  const { server, handlerCalls } = makeDownstreamServer(tools);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const ds = manager.downstreams.get(name);
  if (!ds) throw new Error(`not registered: ${name}`);
  const client = new Client(
    { name: "mcp-gateway-test", version: "0.0.0" },
    { capabilities: {} }
  );
  await client.connect(clientTransport);
  const list = await client.listTools();
  ds._client = client;
  ds._transport = undefined;
  ds.tools = list.tools.map((t) => ({
    name: t.name,
    prefixedName: `${name}__${t.name}`,
    description: t.description ?? undefined,
    inputSchema: (t as { inputSchema?: unknown }).inputSchema,
    alwaysExposed:
      ds.spec.alwaysExpose === true ||
      (Array.isArray(ds.spec.alwaysExpose) && ds.spec.alwaysExpose.includes(t.name)),
  }));
  ds.status = "ready";
  for (const t of ds.tools) {
    manager.toolLookup.set(t.prefixedName, { downstream: ds, tool: t });
  }
  return { ds, handlerCalls };
}

describe("DownstreamManager + gateway routing", () => {
  it("namespaces tools using the configured separator", async () => {
    const manager = new DownstreamManager({ namespaceSeparator: "__" });
    manager.register(
      serverSpecSchema.parse({ name: "fs", command: "unused", alwaysExpose: true })
    );
    manager.register(
      serverSpecSchema.parse({ name: "github", command: "unused", alwaysExpose: true })
    );
    await linkDownstream(manager, "fs", [
      { name: "read_file", description: "read a file", inputSchema: { type: "object" } },
      { name: "write_file", description: "write a file", inputSchema: { type: "object" } },
    ]);
    await linkDownstream(manager, "github", [
      { name: "read_file", description: "gh read file", inputSchema: { type: "object" } },
    ]);

    const exposed = manager.exposedTools().map((t) => t.prefixedName);
    expect(exposed).toContain("fs__read_file");
    expect(exposed).toContain("fs__write_file");
    expect(exposed).toContain("github__read_file");
    // No collision on the unprefixed name "read_file"
    expect(exposed.filter((n) => n === "read_file").length).toBe(0);
  });

  it("only exposes tools on servers marked alwaysExpose=true (or alwaysExpose list)", async () => {
    const manager = new DownstreamManager({ namespaceSeparator: "__" });
    manager.register(
      serverSpecSchema.parse({ name: "fs", command: "unused", alwaysExpose: true })
    );
    manager.register(
      serverSpecSchema.parse({ name: "lazy", command: "unused", alwaysExpose: false })
    );
    manager.register(
      serverSpecSchema.parse({
        name: "partial",
        command: "unused",
        alwaysExpose: ["pinned"],
      })
    );
    await linkDownstream(manager, "fs", [
      { name: "read_file", inputSchema: { type: "object" } },
    ]);
    await linkDownstream(manager, "lazy", [
      { name: "hidden", inputSchema: { type: "object" } },
    ]);
    await linkDownstream(manager, "partial", [
      { name: "pinned", inputSchema: { type: "object" } },
      { name: "not_pinned", inputSchema: { type: "object" } },
    ]);

    const exposed = manager.exposedTools().map((t) => t.prefixedName);
    expect(exposed.sort()).toEqual(["fs__read_file", "partial__pinned"].sort());
    // hidden + not_pinned are still discoverable via allKnownTools for later lazy exposure
    const all = manager.allKnownTools().map((t) => t.prefixedName);
    expect(all).toContain("lazy__hidden");
    expect(all).toContain("partial__not_pinned");
  });

  it("routes call_tool by prefix to the right downstream and strips the prefix", async () => {
    const manager = new DownstreamManager({ namespaceSeparator: "__" });
    manager.register(
      serverSpecSchema.parse({ name: "fs", command: "unused", alwaysExpose: true })
    );
    manager.register(
      serverSpecSchema.parse({ name: "gh", command: "unused", alwaysExpose: true })
    );
    const fs = await linkDownstream(manager, "fs", [
      { name: "read", inputSchema: { type: "object" } },
    ]);
    const gh = await linkDownstream(manager, "gh", [
      { name: "read", inputSchema: { type: "object" } },
    ]);

    const fsEntry = manager.findTool("fs__read");
    const ghEntry = manager.findTool("gh__read");
    expect(fsEntry).toBeDefined();
    expect(ghEntry).toBeDefined();
    await fsEntry!.downstream._client!.callTool({
      name: fsEntry!.tool.name,
      arguments: { path: "/tmp/x" },
    });
    await ghEntry!.downstream._client!.callTool({
      name: ghEntry!.tool.name,
      arguments: { owner: "o", repo: "r" },
    });
    expect(fs.handlerCalls).toEqual([{ name: "read", args: { path: "/tmp/x" } }]);
    expect(gh.handlerCalls).toEqual([
      { name: "read", args: { owner: "o", repo: "r" } },
    ]);
  });
});
