import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { DownstreamManager } from "./downstream.js";
import type { GatewayConfig } from "./config.js";
import {
  estimateToolTokens,
  type ServerTokenLine,
  type TokenReport,
} from "./tokens.js";

export interface GatewayOptions {
  config: GatewayConfig;
  name?: string;
  version?: string;
  onLog?: (msg: string) => void;
}

export class Gateway {
  readonly downstreams: DownstreamManager;
  readonly server: Server;
  private _started = false;

  constructor(private readonly opts: GatewayOptions) {
    this.downstreams = new DownstreamManager({
      namespaceSeparator: opts.config.namespaceSeparator,
      onLog: opts.onLog,
      clientName: opts.name ?? "mcp-gateway",
      clientVersion: opts.version ?? "0.1.0",
    });
    for (const s of opts.config.servers) {
      if (s.enabled) this.downstreams.register(s);
    }

    this.server = new Server(
      {
        name: opts.name ?? "mcp-gateway",
        version: opts.version ?? "0.1.0",
      },
      { capabilities: { tools: {} } }
    );
    this.wireHandlers();
  }

  private wireHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      // Lazy-load: on the first list_tools call from upstream, we try to
      // connect any downstream that isn't already connected and isn't
      // marked alwaysExpose:false. Tools from alwaysExpose:false servers
      // only surface once an upstream client has explicitly listed them
      // after a prior call_tool attempt against a namespace prefix.
      await this.lazyConnectAll();
      const tools: Tool[] = this.downstreams
        .allKnownTools()
        .filter((t) => t.alwaysExposed || this.isToolExposureAllowed(t.prefixedName))
        .map((t) => ({
          name: t.prefixedName,
          description: t.description,
          inputSchema: (t.inputSchema as Tool["inputSchema"]) ?? {
            type: "object",
            properties: {},
          },
        }));
      return { tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const name = req.params.name;
      const entry = this.downstreams.findTool(name);
      if (!entry) {
        // Before giving up, try to connect any downstream matching the prefix —
        // this covers lazy-loaded servers where the agent is calling a tool
        // whose namespace hasn't been probed yet.
        const separator = this.opts.config.namespaceSeparator;
        const [maybePrefix] = name.split(separator);
        if (maybePrefix) {
          const ds = this.downstreams.downstreams.get(maybePrefix);
          if (ds && ds.status !== "ready") {
            await this.downstreams.connect(ds.spec.name).catch(() => {
              // fall through — if it still isn't registered we'll error below
            });
          }
        }
      }
      const resolved = this.downstreams.findTool(name);
      if (!resolved) {
        throw new Error(
          `unknown tool '${name}' — not registered with any downstream server`
        );
      }
      if (resolved.downstream.status !== "ready") {
        await this.downstreams.connect(resolved.downstream.spec.name);
      }
      const client = resolved.downstream._client;
      if (!client) {
        throw new Error(
          `downstream '${resolved.downstream.spec.name}' has no active client`
        );
      }
      const res = await client.callTool({
        name: resolved.tool.name,
        arguments: req.params.arguments ?? {},
      });
      return res;
    });
  }

  async start(): Promise<void> {
    if (this._started) return;
    // Kick off eager connects in parallel; don't block on them — the
    // transport needs to come up regardless so the upstream client can
    // begin querying.
    void this.downstreams.connectEager();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this._started = true;
    this.opts.onLog?.("mcp-gateway started");
  }

  async shutdown(): Promise<void> {
    await this.downstreams.shutdown();
    await this.server.close();
    this._started = false;
  }

  async lazyConnectAll(): Promise<void> {
    const pending: Promise<void>[] = [];
    for (const ds of this.downstreams.downstreams.values()) {
      if (ds.status === "idle") {
        pending.push(this.downstreams.connect(ds.spec.name).catch(() => undefined));
      }
    }
    await Promise.all(pending);
  }

  tokenReport(): TokenReport {
    const servers: ServerTokenLine[] = [];
    let totalExposed = 0;
    let totalAvailable = 0;
    for (const ds of this.downstreams.downstreams.values()) {
      const tools = ds.tools.map((t) => ({
        name: t.prefixedName,
        tokens: estimateToolTokens({
          name: t.prefixedName,
          description: t.description,
          inputSchema: t.inputSchema,
        }),
      }));
      const serverTotal = tools.reduce((n, x) => n + x.tokens, 0);
      const exposed =
        ds.spec.alwaysExpose === true ||
        (Array.isArray(ds.spec.alwaysExpose) && ds.spec.alwaysExpose.length > 0);
      const alwaysExposed = ds.spec.alwaysExpose === true;
      servers.push({
        name: ds.spec.name,
        exposed,
        alwaysExposed,
        tokens: serverTotal,
        tools,
      });
      if (ds.spec.alwaysExpose === true) totalExposed += serverTotal;
      else if (Array.isArray(ds.spec.alwaysExpose)) {
        totalExposed += ds.tools
          .filter((t) => (ds.spec.alwaysExpose as string[]).includes(t.name))
          .reduce(
            (n, t) =>
              n +
              estimateToolTokens({
                name: t.prefixedName,
                description: t.description,
                inputSchema: t.inputSchema,
              }),
            0
          );
      }
      totalAvailable += serverTotal;
    }
    return {
      totalExposedTokens: totalExposed,
      totalAvailableTokens: totalAvailable,
      servers,
    };
  }

  private isToolExposureAllowed(_prefixedName: string): boolean {
    // Currently: lazy-loaded tools are only listed when their server has
    // alwaysExpose = true or their name is on the alwaysExpose allow-list.
    // In a future version we'll add session-scoped explicit exposure.
    return false;
  }
}
