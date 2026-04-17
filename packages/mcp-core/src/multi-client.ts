import { parseConfig, type GatewayConfig, type ServerSpec } from "./config.js";
import {
  DownstreamManager,
  type ClientTransportFactory,
  type DownstreamTool,
} from "./downstream.js";
import { McpRequestRouter } from "./router.js";
import { defaultClientTransportFactory } from "./transports/default.js";
import { SessionToolPromoter } from "./tool-search.js";
import type { TokenReport } from "./tokens.js";

export interface McpMultiClientOptions {
  config: GatewayConfig | Parameters<typeof parseConfig>[0];
  /**
   * Transport factory used to connect to each downstream server. Defaults to
   * the stdio factory; embedders can supply HTTP/SSE or in-memory adapters.
   */
  transportFactory?: ClientTransportFactory;
  onLog?: (msg: string) => void;
  clientName?: string;
  clientVersion?: string;
  /**
   * Optional hook invoked per prefixed tool name to decide whether a tool
   * that is not `alwaysExpose` should still be listed. Used by hosts that
   * implement their own tool-promotion policy beyond what `promoter` provides.
   */
  isToolExposureAllowed?: (prefixedName: string) => boolean;
  /**
   * Enable the built-in `mcp_tool_search` meta-tool and session-scoped tool
   * promotion. When `true` (default), a fresh `SessionToolPromoter` is used.
   * Pass a specific instance to share promotion state across clients, or
   * `false` to disable the meta-tool.
   */
  toolSearch?: boolean | SessionToolPromoter;
}

/**
 * One-stop entry point for embedders that want gateway behavior in-process
 * without hand-wiring DownstreamManager + McpRequestRouter. SwarmClaw uses
 * this; the CLI gateway builds slightly higher-level `McpGatewayServer` on
 * top of the same components.
 *
 * Lifecycle:
 *
 *   const mc = new McpMultiClient({ config, transportFactory });
 *   await mc.connectEager();
 *   const tools = await mc.listExposedTools();
 *   const result = await mc.callTool("fs__read_file", { path: "/tmp/x" });
 *   await mc.shutdown();
 */
export class McpMultiClient {
  readonly config: GatewayConfig;
  readonly downstreams: DownstreamManager;
  readonly router: McpRequestRouter;
  readonly promoter: SessionToolPromoter | undefined;

  constructor(opts: McpMultiClientOptions) {
    // Always run parseConfig so schema defaults (enabled, alwaysExpose,
    // namespaceSeparator) are applied. Re-parsing an already-parsed config is
    // idempotent.
    this.config = parseConfig(opts.config);
    this.downstreams = new DownstreamManager({
      namespaceSeparator: this.config.namespaceSeparator,
      onLog: opts.onLog,
      clientName: opts.clientName ?? "mcp-multi-client",
      clientVersion: opts.clientVersion ?? "0.1.0",
      transportFactory: opts.transportFactory ?? defaultClientTransportFactory,
    });
    for (const s of this.config.servers) {
      if (s.enabled) this.downstreams.register(s);
    }
    this.promoter = resolvePromoter(opts.toolSearch);
    this.router = new McpRequestRouter({
      config: this.config,
      downstreams: this.downstreams,
      isToolExposureAllowed: opts.isToolExposureAllowed,
      promoter: this.promoter,
    });
  }

  register(spec: ServerSpec): void {
    this.downstreams.register(spec);
  }

  async connectEager(): Promise<void> {
    await this.downstreams.connectEager();
  }

  async connect(name: string): Promise<void> {
    await this.downstreams.connect(name);
  }

  async ensureConnected(name: string): Promise<void> {
    await this.downstreams.ensureConnected(name);
  }

  exposedTools(): DownstreamTool[] {
    return this.downstreams.exposedTools();
  }

  allKnownTools(): DownstreamTool[] {
    return this.downstreams.allKnownTools();
  }

  async listExposedTools(): Promise<ReturnType<McpRequestRouter["listExposedTools"]>> {
    return this.router.listExposedTools();
  }

  async callTool(
    prefixedName: string,
    args?: Record<string, unknown>
  ): Promise<unknown> {
    return this.router.callTool(prefixedName, args);
  }

  tokenReport(): TokenReport {
    return this.router.tokenReport();
  }

  async shutdown(): Promise<void> {
    await this.downstreams.shutdown();
  }
}

function resolvePromoter(
  opt: boolean | SessionToolPromoter | undefined
): SessionToolPromoter | undefined {
  if (opt === false) return undefined;
  if (opt instanceof SessionToolPromoter) return opt;
  return new SessionToolPromoter();
}
