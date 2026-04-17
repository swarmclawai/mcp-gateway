import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { GatewayConfig } from "./config.js";
import { DownstreamManager } from "./downstream.js";
import {
  estimateToolTokens,
  type ServerTokenLine,
  type TokenReport,
} from "./tokens.js";
import {
  searchTools,
  SessionToolPromoter,
  TOOL_SEARCH_NAME,
  toolSearchToolDescriptor,
  type ToolSearchResult,
} from "./tool-search.js";

export interface McpRequestRouterOptions {
  config: GatewayConfig;
  downstreams: DownstreamManager;
  /**
   * Allow-hook called per prefixed tool name when deciding whether a lazy
   * (alwaysExpose=false) tool should be surfaced in a list_tools response.
   * Returning true promotes a specific tool name for the current session.
   * Default: always false (lazy tools stay hidden until explicitly promoted).
   */
  isToolExposureAllowed?: (prefixedName: string) => boolean;
  /**
   * Session-scoped promoter for lazy tools. When set, the router advertises
   * the `mcp_tool_search` meta-tool in `listExposedTools`, intercepts its
   * invocation in `callTool`, and treats promoted names as exposed.
   */
  promoter?: SessionToolPromoter;
}

/**
 * Pure (transport-agnostic) MCP request routing. Takes a `DownstreamManager`
 * populated from a `GatewayConfig` and implements the three operations an MCP
 * server binding or an in-process embedder cares about:
 *
 *   - `listExposedTools()`  — what goes in `list_tools` responses
 *   - `callTool(name, args)` — routes `call_tool` to the right downstream
 *   - `tokenReport()`       — how much each downstream spends on tool schemas
 *
 * Keep the stdio/HTTP server wrapping, process lifecycle, and CLI plumbing
 * outside this class.
 */
export class McpRequestRouter {
  constructor(private readonly opts: McpRequestRouterOptions) {}

  get downstreams(): DownstreamManager {
    return this.opts.downstreams;
  }

  /**
   * Lazy-connect every downstream that is still idle. Called before producing
   * a `list_tools` response so we can discover tool schemas even for servers
   * the user hasn't eagerly loaded.
   */
  async lazyConnectAll(): Promise<void> {
    const pending: Promise<void>[] = [];
    for (const ds of this.opts.downstreams.downstreams.values()) {
      if (ds.status === "idle") {
        pending.push(
          this.opts.downstreams.connect(ds.spec.name).catch(() => undefined)
        );
      }
    }
    await Promise.all(pending);
  }

  /**
   * If the requested tool isn't registered yet, try to connect the downstream
   * matching its namespace prefix — this is the back-door that lets an agent
   * call a lazy tool it learned about via `mcp_tool_search` or other
   * out-of-band discovery.
   */
  async lazyConnectByPrefix(prefixedName: string): Promise<void> {
    const separator = this.opts.config.namespaceSeparator;
    const [maybePrefix] = prefixedName.split(separator);
    if (!maybePrefix) return;
    const ds = this.opts.downstreams.downstreams.get(maybePrefix);
    if (ds && ds.status !== "ready") {
      await this.opts.downstreams.connect(ds.spec.name).catch(() => undefined);
    }
  }

  /**
   * Build the `list_tools` response. Eagerly surfaces any tool marked
   * alwaysExposed (server-level or per-tool) plus anything the host has
   * explicitly allowed via `isToolExposureAllowed`.
   */
  async listExposedTools(): Promise<Tool[]> {
    await this.lazyConnectAll();
    const customAllow = this.opts.isToolExposureAllowed;
    const promoter = this.opts.promoter;
    const allow = (name: string): boolean =>
      (customAllow?.(name) ?? false) || (promoter?.allow(name) ?? false);
    const tools: Tool[] = this.opts.downstreams
      .allKnownTools()
      .filter((t) => t.alwaysExposed || allow(t.prefixedName))
      .map((t) => ({
        name: t.prefixedName,
        description: t.description,
        inputSchema: (t.inputSchema as Tool["inputSchema"]) ?? {
          type: "object",
          properties: {},
        },
      }));
    if (promoter) {
      tools.push(toolSearchToolDescriptor);
    }
    return tools;
  }

  /**
   * Route a `call_tool` request to the right downstream. Matches the
   * behavior of the previous `Gateway.server` handler: tries the exact
   * lookup, then lazy-connects by prefix, then forwards.
   */
  async callTool(
    prefixedName: string,
    args: Record<string, unknown> | undefined
  ): Promise<unknown> {
    if (prefixedName === TOOL_SEARCH_NAME && this.opts.promoter) {
      return this.handleToolSearch(args);
    }
    let entry = this.opts.downstreams.findTool(prefixedName);
    if (!entry) {
      await this.lazyConnectByPrefix(prefixedName);
      entry = this.opts.downstreams.findTool(prefixedName);
    }
    if (!entry) {
      throw new Error(
        `unknown tool '${prefixedName}' — not registered with any downstream server`
      );
    }
    if (entry.downstream.status !== "ready") {
      await this.opts.downstreams.connect(entry.downstream.spec.name);
    }
    const client = entry.downstream._client;
    if (!client) {
      throw new Error(
        `downstream '${entry.downstream.spec.name}' has no active client`
      );
    }
    return client.callTool({
      name: entry.tool.name,
      arguments: args ?? {},
    });
  }

  /**
   * Handler for the built-in `mcp_tool_search` meta-tool. Ensures every
   * downstream is connected (so descriptions are up to date), runs a fuzzy
   * search, promotes each match to exposed, and returns an MCP CallToolResult
   * whose content is the search result as JSON text — the agent parses it
   * and then calls the promoted tools by name.
   */
  private async handleToolSearch(
    args: Record<string, unknown> | undefined
  ): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
    const promoter = this.opts.promoter;
    if (!promoter) {
      throw new Error("mcp_tool_search called with no promoter configured");
    }
    const rawQuery = typeof args?.query === "string" ? args.query : "";
    const rawLimit = typeof args?.limit === "number" ? args.limit : undefined;
    await this.lazyConnectAll();
    const pool = this.opts.downstreams.allKnownTools();
    const result: ToolSearchResult = searchTools(pool, {
      query: rawQuery,
      limit: rawLimit,
    });
    for (const m of result.matches) {
      promoter.promote(m.name);
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  tokenReport(): TokenReport {
    const servers: ServerTokenLine[] = [];
    let totalExposed = 0;
    let totalAvailable = 0;
    for (const ds of this.opts.downstreams.downstreams.values()) {
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
      if (ds.spec.alwaysExpose === true) {
        totalExposed += serverTotal;
      } else if (Array.isArray(ds.spec.alwaysExpose)) {
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
}
