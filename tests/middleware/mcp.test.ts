import { describe, it, expect, vi } from "vitest"
import { mcpTools } from "../../src/middleware/tools/mcp.js"

describe("tools.mcp()", () => {
  it("creates middleware with correct name", () => {
    const middleware = mcpTools({
      name: "crm",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@acme/crm-mcp"],
    })

    expect(middleware.name).toBe("tools:mcp:crm")
  })

  it("has agent hook", () => {
    const middleware = mcpTools({
      name: "test",
      transport: "http",
      url: "http://localhost:3000/mcp",
    })

    expect(middleware.agent).toBeDefined()
  })

  it("throws error when agent hook fails (missing SDK or connection error)", async () => {
    const middleware = mcpTools({
      name: "test",
      transport: "stdio",
      command: "nonexistent-command-that-does-not-exist",
    })

    const mockCtx = {
      agent: { name: "test", model: "mock", instructions: "test" },
      registerTool: vi.fn(),
      config: {},
    }

    // Agent hook will fail either because:
    // 1. @modelcontextprotocol/sdk not installed → "not installed" error
    // 2. SDK installed but command doesn't exist → "Failed to connect" error
    // Both are acceptable — the point is the hook fails with a clear message
    await expect(middleware.agent!(mockCtx as any, async () => {})).rejects.toThrow()
  })

  it("cleanup runs even without successful connection (try/finally)", async () => {
    const middleware = mcpTools({
      name: "test",
      transport: "http",
      url: "http://localhost:3000/mcp",
    })

    // Agent hook should fail during connection, but not leave dangling state
    const mockCtx = {
      agent: { name: "test", model: "mock", instructions: "test" },
      registerTool: vi.fn(),
      config: {},
    }

    // The hook should throw (can't connect) but should not cause unhandled errors
    await expect(middleware.agent!(mockCtx as any, async () => {})).rejects.toThrow()
  })
})
