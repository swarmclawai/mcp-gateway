import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  DownstreamManager,
  McpRequestRouter,
  SessionToolPromoter,
  defaultClientTransportFactory,
  type GatewayConfig,
} from "@swarmclawai/mcp-core";

export interface GatewayOptions {
  config: GatewayConfig;
  name?: string;
  version?: string;
  onLog?: (msg: string) => void;
  /**
   * Enable the `mcp_tool_search` meta-tool and session-scoped tool
   * promotion. Defaults to true — this is the whole point of the gateway.
   * Set to false to get the pre-B2 listing behavior.
   */
  toolSearch?: boolean;
}

/**
 * The stdio-facing MCP gateway server. Thin composition on top of
 * `@swarmclawai/mcp-core`:
 *
 *   - builds a DownstreamManager wired to the stdio client transport
 *   - builds an McpRequestRouter pointed at it
 *   - wraps the router in an MCP Server speaking stdio to the upstream agent
 *
 * Anything transport-agnostic (routing, token report, tool lookup) lives in
 * `@swarmclawai/mcp-core` — embedders can reuse that without pulling in the
 * stdio server binding.
 */
export class Gateway {
  readonly downstreams: DownstreamManager;
  readonly router: McpRequestRouter;
  readonly server: Server;
  readonly promoter: SessionToolPromoter | undefined;
  private _started = false;
  private _httpServer: HttpServer | undefined;

  constructor(private readonly opts: GatewayOptions) {
    this.downstreams = new DownstreamManager({
      namespaceSeparator: opts.config.namespaceSeparator,
      onLog: opts.onLog,
      clientName: opts.name ?? "mcp-gateway",
      clientVersion: opts.version ?? "0.2.0",
      transportFactory: defaultClientTransportFactory,
    });
    for (const s of opts.config.servers) {
      if (s.enabled) this.downstreams.register(s);
    }

    this.promoter = opts.toolSearch === false ? undefined : new SessionToolPromoter();
    this.router = new McpRequestRouter({
      config: opts.config,
      downstreams: this.downstreams,
      promoter: this.promoter,
    });

    this.server = new Server(
      {
        name: opts.name ?? "mcp-gateway",
        version: opts.version ?? "0.2.0",
      },
      { capabilities: { tools: {} } }
    );
    this.wireHandlers();
  }

  private wireHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: await this.router.listExposedTools(),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const res = await this.router.callTool(
        req.params.name,
        req.params.arguments
      );
      return res as Awaited<ReturnType<typeof this.router.callTool>> & object;
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

  /**
   * Start a streamable-HTTP server instead of stdio. Each inbound POST
   * creates a fresh transport + Server bound to the same shared router —
   * downstream connections and the tool-search promoter are shared across
   * requests so there's no per-request reconnect cost.
   */
  async startHttp(port: number, host = "127.0.0.1"): Promise<HttpServer> {
    if (this._started) {
      throw new Error("gateway is already started on another transport");
    }
    void this.downstreams.connectEager();
    const handleMcp = async (
      req: IncomingMessage,
      res: ServerResponse
    ): Promise<void> => {
      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Method not allowed." },
            id: null,
          })
        );
        return;
      }
      const body = await readJsonBody(req);
      const perRequestServer = new Server(
        {
          name: this.opts.name ?? "mcp-gateway",
          version: this.opts.version ?? "0.2.0",
        },
        { capabilities: { tools: {} } }
      );
      perRequestServer.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: await this.router.listExposedTools(),
      }));
      perRequestServer.setRequestHandler(CallToolRequestSchema, async (r) => {
        const out = await this.router.callTool(r.params.name, r.params.arguments);
        return out as Awaited<ReturnType<typeof this.router.callTool>> & object;
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await perRequestServer.connect(transport);
      await transport.handleRequest(req, res, body);
      res.on("close", () => {
        void transport.close();
        void perRequestServer.close();
      });
    };
    const httpServer = createServer((req, res) => {
      if (req.url && req.url.replace(/\/$/, "") === "/mcp") {
        handleMcp(req, res).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32603, message: `Internal error: ${msg}` },
                id: null,
              })
            );
          }
        });
        return;
      }
      if (req.url === "/healthz") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ ok: false, error: "not found — POST /mcp" })
      );
    });
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(port, host, () => {
        httpServer.off("error", reject);
        resolve();
      });
    });
    this._started = true;
    this._httpServer = httpServer;
    this.opts.onLog?.(`mcp-gateway listening on http://${host}:${port}/mcp`);
    return httpServer;
  }

  async shutdown(): Promise<void> {
    await this.downstreams.shutdown();
    if (this._httpServer) {
      await new Promise<void>((resolve) =>
        this._httpServer?.close(() => resolve())
      );
      this._httpServer = undefined;
    }
    await this.server.close();
    this._started = false;
  }

  async lazyConnectAll(): Promise<void> {
    await this.router.lazyConnectAll();
  }

  tokenReport(): ReturnType<McpRequestRouter["tokenReport"]> {
    return this.router.tokenReport();
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(
          new Error(
            `invalid JSON request body: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }
    });
    req.on("error", reject);
  });
}
