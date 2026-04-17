import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ClientTransportFactory } from "../downstream.js";

export const stdioClientTransportFactory: ClientTransportFactory = (spec) => {
  if (!spec.command) {
    throw new Error(
      `server '${spec.name}' needs a command to use the stdio transport`
    );
  }
  return new StdioClientTransport({
    command: spec.command,
    args: spec.args,
    env: spec.env,
    cwd: spec.cwd,
  });
};
