import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  external: ["web-tree-sitter", "prettier"],
  outDir: "dist",
});
