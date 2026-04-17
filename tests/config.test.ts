import { describe, it, expect } from "vitest";
import { parseConfig, resolvedServerAlwaysExposed } from "../src/config.js";

describe("config", () => {
  it("accepts a minimal valid config", () => {
    const cfg = parseConfig({
      version: 1,
      servers: [{ name: "fs", command: "npx", args: ["-y", "thing"] }],
    });
    expect(cfg.servers[0].name).toBe("fs");
    expect(cfg.servers[0].alwaysExpose).toBe(false);
    expect(cfg.namespaceSeparator).toBe("__");
  });

  it("accepts alwaysExpose=true, false, and a list of tool names", () => {
    const cfg = parseConfig({
      version: 1,
      servers: [
        { name: "a", command: "c", alwaysExpose: true },
        { name: "b", command: "c", alwaysExpose: false },
        { name: "c", command: "c", alwaysExpose: ["one", "two"] },
      ],
    });
    expect(cfg.servers[0].alwaysExpose).toBe(true);
    expect(cfg.servers[1].alwaysExpose).toBe(false);
    expect(cfg.servers[2].alwaysExpose).toEqual(["one", "two"]);
  });

  it("rejects duplicate server names", () => {
    expect(() =>
      parseConfig({
        version: 1,
        servers: [
          { name: "dup", command: "x" },
          { name: "dup", command: "y" },
        ],
      })
    ).toThrow(/duplicate/);
  });

  it("rejects non-kebab-safe names", () => {
    expect(() =>
      parseConfig({
        version: 1,
        servers: [{ name: "UPPERCASE", command: "x" }],
      })
    ).toThrow();
    expect(() =>
      parseConfig({
        version: 1,
        servers: [{ name: "with-hyphen", command: "x" }],
      })
    ).toThrow();
  });

  it("resolvedServerAlwaysExposed handles all three modes", () => {
    const spec = {
      name: "a",
      command: "c",
      args: [],
      alwaysExpose: true as true | false | string[],
      enabled: true,
    };
    expect(resolvedServerAlwaysExposed({ ...spec, alwaysExpose: true }, "foo")).toBe(true);
    expect(resolvedServerAlwaysExposed({ ...spec, alwaysExpose: false }, "foo")).toBe(
      false
    );
    expect(
      resolvedServerAlwaysExposed({ ...spec, alwaysExpose: ["foo"] }, "foo")
    ).toBe(true);
    expect(
      resolvedServerAlwaysExposed({ ...spec, alwaysExpose: ["foo"] }, "bar")
    ).toBe(false);
  });
});
