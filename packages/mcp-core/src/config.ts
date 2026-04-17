import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const serverSpecSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(
        /^[a-z][a-z0-9_]*$/,
        "server name must be lowercase alphanumeric with underscores and start with a letter"
      )
      .max(64),
    // Stdio-transport fields — set when spawning a local process.
    command: z.string().min(1).optional(),
    args: z.array(z.string()).default([]),
    env: z.record(z.string()).optional(),
    cwd: z.string().optional(),
    // HTTP-transport fields — set when pointing at a streamable-http endpoint.
    url: z.string().url().optional(),
    headers: z.record(z.string()).optional(),
    // Common fields.
    alwaysExpose: z
      .union([z.boolean(), z.array(z.string())])
      .default(false)
      .describe(
        "true = always expose all tools; array = only pre-load listed tool names; false = lazy"
      ),
    enabled: z.boolean().default(true),
    description: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const hasCommand = !!data.command;
    const hasUrl = !!data.url;
    if (hasCommand === hasUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "server must set exactly one of 'command' (stdio) or 'url' (http)",
        path: [],
      });
    }
  });

export type ServerSpec = z.infer<typeof serverSpecSchema>;

export const configSchema = z.object({
  version: z.literal(1).default(1),
  namespaceSeparator: z.string().default("__"),
  servers: z.array(serverSpecSchema).min(1, "at least one downstream server is required"),
});

export type GatewayConfig = z.infer<typeof configSchema>;

export function parseConfig(raw: unknown): GatewayConfig {
  const parsed = configSchema.parse(raw);
  const seen = new Set<string>();
  for (const s of parsed.servers) {
    if (seen.has(s.name)) {
      throw new Error(`duplicate server name '${s.name}' in config`);
    }
    seen.add(s.name);
  }
  return parsed;
}

export async function loadConfigFile(filePath: string): Promise<GatewayConfig> {
  const raw = await fs.readFile(filePath, "utf8");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `failed to parse config at ${filePath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return parseConfig(json);
}

export function defaultConfigPath(): string {
  return path.resolve(process.cwd(), "mcp-gateway.config.json");
}

export function resolvedServerAlwaysExposed(
  s: ServerSpec,
  toolName: string
): boolean {
  if (s.alwaysExpose === true) return true;
  if (s.alwaysExpose === false) return false;
  return s.alwaysExpose.includes(toolName);
}
