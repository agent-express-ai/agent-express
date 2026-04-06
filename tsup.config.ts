import { defineConfig } from "tsup"

export default defineConfig([
  // Library exports
  {
    entry: {
      index: "src/index.ts",
      "http/handler": "src/http/handler.ts",
      "test/index": "src/test/index.ts",
    },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "node20",
    external: ["vitest"],
  },
  // CLI binary
  {
    entry: {
      "cli/index": "src/cli/index.ts",
    },
    format: ["esm"],
    sourcemap: true,
    target: "node20",
    banner: { js: "#!/usr/bin/env node" },
    external: ["vitest", "vite", "@vitest/browser", "@vitest/ui", "lightningcss"],
  },
])
