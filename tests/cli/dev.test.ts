import { describe, it, expect } from "vitest"

describe("dev server module", () => {
  it("dev.ts module exists and exports runDev", async () => {
    const mod = await import("../../src/cli/dev.js")
    expect(typeof mod.runDev).toBe("function")
  })

  it("cli entry module exists and is importable", async () => {
    // Verify the CLI entry point can be imported without errors.
    // Commander will parse process.argv but won't throw during import.
    const mod = await import("../../src/cli/index.js")
    expect(mod).toBeDefined()
  })
})
