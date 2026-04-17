// Rough tiktoken-free token estimator.
//
// We're not trying to match OpenAI's tokenizer exactly — we just want a stable,
// tokenizer-free heuristic that gives users a meaningful "how much am I spending
// on MCP boilerplate" number. The commonly-cited ratio for English prose is
// ~4 chars/token; JSON tool schemas tokenize a little denser (more punctuation,
// key repetition, bracketed structure) so 3.5 chars/token is closer.
//
// The CLI's token-report is directional, not authoritative. Users who want exact
// numbers can pipe through tiktoken themselves.

const CHARS_PER_TOKEN = 3.5;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateToolTokens(tool: {
  name: string;
  description?: string;
  inputSchema?: unknown;
}): number {
  const json = JSON.stringify({
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: tool.inputSchema ?? {},
  });
  return estimateTokens(json);
}

export interface ToolTokenLine {
  name: string;
  tokens: number;
}

export interface ServerTokenLine {
  name: string;
  exposed: boolean;
  alwaysExposed: boolean;
  tokens: number;
  tools: ToolTokenLine[];
}

export interface TokenReport {
  totalExposedTokens: number;
  totalAvailableTokens: number;
  servers: ServerTokenLine[];
}
