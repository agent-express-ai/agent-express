import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  resolve: {
    alias: {
      "agent-express": path.resolve(__dirname, "src/index.ts"),
    },
  },
  test: {
    globals: true,
    include: ["tests/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "packages/*/src/**/*.ts"],
      exclude: ["src/cli/**", "src/http/**", "**/*.test.ts", "src/index.ts", "src/test/index.ts"],
      reporter: ["text", "text-summary", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
})
