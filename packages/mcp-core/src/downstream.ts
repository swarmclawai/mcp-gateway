import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { resolvedServerAlwaysExposed, type ServerSpec } from "./config.js";

export interface DownstreamTool {
  /** tool name as reported by the downstream server (unprefixed) */
  name: string;
  /** flavor-prefixed name we expose upstream */
  prefixedName: string;
  description?: string;
  inputSchema?: unknown;
  alwaysExposed: boolean;
}

export interface DownstreamClient {
  spec: ServerSpec;
  status: "idle" | "connecting" | "ready" | "error";
  tools: DownstreamTool[];
  lastError?: string;
  _client?: Client;
  _transport?: Transport;
}

export type ClientTransportFactory = (spec: ServerSpec) => Transport;

export interface DownstreamManagerOptions {
  namespaceSeparator: string;
  onLog?: (msg: string) => void;
  clientName?: string;
  clientVersion?: string;
  /**
   * Factory that produces a Transport for a given downstream spec. Embedders
   * can inject HTTP/SSE/in-memory transports; the CLI gateway uses the stdio
   * factory exported from `@swarmclawai/mcp-core`.
   */
  transportFactory?: ClientTransportFactory;
}

export class DownstreamManager {
  readonly downstreams = new Map<string, DownstreamClient>();
  readonly toolLookup = new Map<
    string,
    { downstream: DownstreamClient; tool: DownstreamTool }
  >();

  constructor(private readonly opts: DownstreamManagerOptions) {}

  register(spec: ServerSpec): DownstreamClient {
    const ds: DownstreamClient = {
      spec,
      status: "idle",
      tools: [],
    };
    this.downstreams.set(spec.name, ds);
    return ds;
  }

  async connect(name: string): Promise<void> {
    const ds = this.mustGet(name);
    if (ds.status === "ready" || ds.status === "connecting") return;
    if (!this.opts.transportFactory) {
      throw new Error(
        "DownstreamManager requires a transportFactory for connect(); inject one via constructor options"
      );
    }
    ds.status = "connecting";
    const transport = this.opts.transportFactory(ds.spec);
    const client = new Client(
      {
        name: this.opts.clientName ?? "mcp-gateway",
        version: this.opts.clientVersion ?? "0.1.0",
      },
      { capabilities: {} }
    );
    try {
      await client.connect(transport);
      const list = await client.listTools();
      ds._client = client;
      ds._transport = transport;
      ds.tools = list.tools.map((t: Tool) => this.toDownstreamTool(ds, t));
      ds.status = "ready";
      for (const t of ds.tools) {
        this.toolLookup.set(t.prefixedName, { downstream: ds, tool: t });
      }
      this.opts.onLog?.(
        `downstream ${ds.spec.name} connected with ${ds.tools.length} tools`
      );
    } catch (err) {
      ds.status = "error";
      ds.lastError = err instanceof Error ? err.message : String(err);
      this.opts.onLog?.(
        `downstream ${ds.spec.name} failed to connect: ${ds.lastError}`
      );
      throw err;
    }
  }

  async connectEager(): Promise<void> {
    const eager: Promise<void>[] = [];
    for (const ds of this.downstreams.values()) {
      if (!ds.spec.enabled) continue;
      if (ds.spec.alwaysExpose !== false) {
        eager.push(
          this.connect(ds.spec.name).catch((err: unknown) => {
            // eager connect errors are surfaced via ds.status/lastError
            void err;
          })
        );
      }
    }
    await Promise.all(eager);
  }

  async ensureConnected(name: string): Promise<void> {
    const ds = this.mustGet(name);
    if (ds.status === "ready") return;
    await this.connect(name);
  }

  exposedTools(): DownstreamTool[] {
    const out: DownstreamTool[] = [];
    for (const ds of this.downstreams.values()) {
      if (!ds.spec.enabled) continue;
      if (ds.status !== "ready") continue;
      for (const t of ds.tools) {
        if (t.alwaysExposed) out.push(t);
      }
    }
    return out;
  }

  allKnownTools(): DownstreamTool[] {
    const out: DownstreamTool[] = [];
    for (const ds of this.downstreams.values()) {
      if (!ds.spec.enabled) continue;
      out.push(...ds.tools);
    }
    return out;
  }

  findTool(
    prefixedName: string
  ): { downstream: DownstreamClient; tool: DownstreamTool } | undefined {
    return this.toolLookup.get(prefixedName);
  }

  async shutdown(): Promise<void> {
    for (const ds of this.downstreams.values()) {
      try {
        await ds._client?.close();
      } catch {
        // ignore — we're tearing down anyway
      }
    }
  }

  private mustGet(name: string): DownstreamClient {
    const ds = this.downstreams.get(name);
    if (!ds) throw new Error(`unknown downstream '${name}'`);
    return ds;
  }

  private toDownstreamTool(ds: DownstreamClient, t: Tool): DownstreamTool {
    const prefixedName = `${ds.spec.name}${this.opts.namespaceSeparator}${t.name}`;
    return {
      name: t.name,
      prefixedName,
      description: t.description ?? undefined,
      inputSchema: (t as { inputSchema?: unknown }).inputSchema,
      alwaysExposed: resolvedServerAlwaysExposed(ds.spec, t.name),
    };
  }
}
