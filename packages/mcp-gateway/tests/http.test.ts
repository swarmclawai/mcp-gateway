import { describe, it, expect, afterAll } from "vitest";
import { Gateway } from "../src/server.js";
import { parseConfig } from "@swarmclawai/mcp-core";

describe("Gateway HTTP mode", () => {
  let gateway: Gateway | undefined;

  afterAll(async () => {
    await gateway?.shutdown();
  });

  it("starts an HTTP server on an ephemeral port and responds to /healthz", async () => {
    const cfg = parseConfig({
      version: 1,
      servers: [{ name: "fs", command: "noop", alwaysExpose: true }],
    });
    gateway = new Gateway({ config: cfg });
    const httpServer = await gateway.startHttp(0, "127.0.0.1");
    const address = httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("expected AddressInfo");
    }
    const port = address.port;
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("returns 405 on GET /mcp", async () => {
    const cfg = parseConfig({
      version: 1,
      servers: [{ name: "fs", command: "noop", alwaysExpose: true }],
    });
    const g = new Gateway({ config: cfg });
    const httpServer = await g.startHttp(0, "127.0.0.1");
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("no address");
    const res = await fetch(`http://127.0.0.1:${address.port}/mcp`);
    expect(res.status).toBe(405);
    await g.shutdown();
  });

  it("returns 404 on unknown paths", async () => {
    const cfg = parseConfig({
      version: 1,
      servers: [{ name: "fs", command: "noop", alwaysExpose: true }],
    });
    const g = new Gateway({ config: cfg });
    const httpServer = await g.startHttp(0, "127.0.0.1");
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("no address");
    const res = await fetch(`http://127.0.0.1:${address.port}/nope`);
    expect(res.status).toBe(404);
    await g.shutdown();
  });
});
