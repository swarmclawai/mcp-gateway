import { describe, it, expect } from "vitest";
import { estimateTokens, estimateToolTokens } from "../src/tokens.js";

describe("tokens", () => {
  it("estimateTokens returns 0 for an empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimateTokens scales with length", () => {
    const a = estimateTokens("a".repeat(100));
    const b = estimateTokens("a".repeat(1000));
    expect(b).toBeGreaterThan(a);
    expect(b / a).toBeCloseTo(10, 0);
  });

  it("estimateToolTokens accounts for schema shape", () => {
    const tiny = estimateToolTokens({ name: "tiny", description: "a" });
    const big = estimateToolTokens({
      name: "big",
      description: "a".repeat(2000),
      inputSchema: {
        type: "object",
        properties: Object.fromEntries(
          Array.from({ length: 20 }, (_, i) => [`prop${i}`, { type: "string" }])
        ),
      },
    });
    expect(big).toBeGreaterThan(tiny * 40);
  });
});
