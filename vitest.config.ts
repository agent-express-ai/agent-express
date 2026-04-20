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
  },
})
