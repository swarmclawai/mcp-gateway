import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  dts: true,
  sourcemap: false,
  clean: true,
});
