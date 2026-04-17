import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { DownstreamTool } from "./downstream.js";

/**
 * Name of the built-in meta-tool. Always exposed by the router so an agent
 * can discover lazy tools on demand without the gateway pre-binding every
 * schema in the world.
 */
export const TOOL_SEARCH_NAME = "mcp_tool_search";

export interface ToolSearchMatch {
  /** Prefixed name as the agent should call it (e.g. "github__list_issues") */
  name: string;
  /** Source downstream server name */
  server: string;
  /** Tool's own description, as reported by the downstream */
  description?: string;
  /** Tool's JSON Schema input shape, as reported by the downstream */
  inputSchema?: unknown;
  /** Relevance score in [0, 1] — higher is better */
  score: number;
}

export interface ToolSearchInput {
  query: string;
  limit?: number;
}

export interface ToolSearchResult {
  query: string;
  matches: ToolSearchMatch[];
  /** Total pool size the search ran against, for UX ("matched 4 of 120 tools"). */
  poolSize: number;
}

const DEFAULT_LIMIT = 8;

/**
 * Small, dependency-free fuzzy matcher: token-overlap score on the lowercased
 * name + description. Matches on multi-word queries by OR-ing term matches and
 * giving small bonuses for consecutive-term hits and exact substring matches.
 * Tuned for "agent asks for a tool" UX, not for IR accuracy.
 */
export function searchTools(
  pool: readonly DownstreamTool[],
  input: ToolSearchInput
): ToolSearchResult {
  const query = input.query.trim().toLowerCase();
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, 50));
  if (!query) {
    return { query: input.query, matches: [], poolSize: pool.length };
  }
  const queryTerms = query.split(/\s+/).filter(Boolean);
  const scored = pool.map((t): ToolSearchMatch => {
    const haystack = `${t.prefixedName} ${t.description ?? ""}`.toLowerCase();
    const score = scoreAgainst(haystack, query, queryTerms);
    const [server] = t.prefixedName.split("__");
    return {
      name: t.prefixedName,
      server: server ?? "",
      description: t.description,
      inputSchema: t.inputSchema,
      score,
    };
  });
  scored.sort((a, b) => b.score - a.score);
  const matches = scored.filter((m) => m.score > 0).slice(0, limit);
  return { query: input.query, matches, poolSize: pool.length };
}

function scoreAgainst(
  haystack: string,
  fullQuery: string,
  queryTerms: readonly string[]
): number {
  let score = 0;
  // Full substring hit — strong signal.
  if (haystack.includes(fullQuery)) score += 0.6;
  // Per-term hits, capped so a 10-word query doesn't dominate.
  let termHits = 0;
  for (const term of queryTerms) {
    if (term.length < 2) continue;
    if (haystack.includes(term)) termHits += 1;
  }
  if (queryTerms.length > 0) {
    score += 0.4 * (termHits / queryTerms.length);
  }
  return Math.min(1, score);
}

/**
 * Session-scoped bookkeeping for which lazy tools have been promoted to
 * "eager" via a prior `mcp_tool_search` call. The router consults
 * `allow(name)` during `listExposedTools()` so promoted tools start showing
 * up in subsequent `list_tools` responses.
 */
export class SessionToolPromoter {
  private readonly exposed = new Set<string>();

  allow(prefixedName: string): boolean {
    return this.exposed.has(prefixedName);
  }

  promote(prefixedName: string): void {
    this.exposed.add(prefixedName);
  }

  promoteMany(names: readonly string[]): void {
    for (const n of names) this.exposed.add(n);
  }

  promoted(): string[] {
    return Array.from(this.exposed);
  }

  clear(): void {
    this.exposed.clear();
  }
}

/**
 * Descriptor used by the router to advertise the meta-tool. Kept here so the
 * schema has one source of truth across the CLI gateway and embedders.
 */
export const toolSearchToolDescriptor: Tool = {
  name: TOOL_SEARCH_NAME,
  description:
    "Search MCP tools available from the connected downstream servers. " +
    "Use when you suspect a tool exists but it isn't currently bound. " +
    "Returns matching tool names (prefixed with server namespace), their " +
    "descriptions, and input schemas. Calling this tool also promotes the " +
    "matched tools so they appear in subsequent list_tools responses.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search terms — tool name fragments, descriptions, keywords.",
      },
      limit: {
        type: "number",
        description: `Max results to return (1-50, default ${DEFAULT_LIMIT}).`,
        minimum: 1,
        maximum: 50,
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};
