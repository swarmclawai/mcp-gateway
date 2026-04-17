import { describe, it, expect } from "vitest";
import { Gateway } from "../src/server.js";
import { parseConfig } from "@swarmclawai/mcp-core";

describe("Gateway (stdio server composition)", () => {
  it("constructs a router + downstream manager from a GatewayConfig", () => {
    const cfg = parseConfig({
      version: 1,
      servers: [
        { name: "fs", command: "noop", alwaysExpose: true },
        { name: "gh", command: "noop", alwaysExpose: false },
      ],
    });
    const gateway = new Gateway({ config: cfg });
    expect(gateway.downstreams.downstreams.size).toBe(2);
    expect(gateway.downstreams.downstreams.get("fs")).toBeDefined();
    expect(gateway.downstreams.downstreams.get("gh")).toBeDefined();
    // tokenReport should work even before any downstream is connected
    const report = gateway.tokenReport();
    expect(report.totalExposedTokens).toBe(0);
    expect(report.totalAvailableTokens).toBe(0);
    expect(report.servers).toHaveLength(2);
  });

  it("skips disabled servers", () => {
    const cfg = parseConfig({
      version: 1,
      servers: [
        { name: "live", command: "noop", alwaysExpose: true, enabled: true },
        { name: "dead", command: "noop", alwaysExpose: true, enabled: false },
      ],
    });
    const gateway = new Gateway({ config: cfg });
    expect(gateway.downstreams.downstreams.size).toBe(1);
    expect(gateway.downstreams.downstreams.get("live")).toBeDefined();
    expect(gateway.downstreams.downstreams.get("dead")).toBeUndefined();
  });
});
