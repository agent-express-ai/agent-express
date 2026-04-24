import { describe, it, expect, vi, beforeEach } from "vitest"
import { mcpTools } from "../../src/middleware/tools/mcp.js"

// ─── Mock MCP SDK ─────────────────────────────────────
// The mcpTools middleware uses dynamic import() so we mock the SDK modules.

const mockConnect = vi.fn()
const mockClose = vi.fn()
const mockListTools = vi.fn()
const mockCallTool = vi.fn()

function MockClient() {
  return { connect: mockConnect, close: mockClose, listTools: mockListTools, callTool: mockCallTool }
}

const MockStdioTransport = vi.fn()
const MockSSETransport = vi.fn()
const MockHTTPTransport = vi.fn()

vi.mock("@modelcontextprotocol/sdk/client", () => ({ Client: MockClient }))
vi.mock("@modelcontextprotocol/sdk/client/stdio", () => ({ StdioClientTransport: MockStdioTransport }))
vi.mock("@modelcontextprotocol/sdk/client/sse", () => ({ SSEClientTransport: MockSSETransport }))
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp", () => ({ StreamableHTTPClientTransport: MockHTTPTransport }))

function createMockCtx() {
  return {
    agent: { name: "test", model: "mock", instructions: "test" },
    registerTool: vi.fn(),
    config: {},
  }
}

// ─── Original tests ───────────────────────────────────

describe("tools.mcp()", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConnect.mockResolvedValue(undefined)
    mockClose.mockResolvedValue(undefined)
    mockListTools.mockResolvedValue({ tools: [] })
    mockCallTool.mockResolvedValue({ content: [] })
  })

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

  it("creates middleware with correct name for different servers", () => {
    expect(mcpTools({ name: "docs", transport: "http", url: "http://localhost" }).name).toBe("tools:mcp:docs")
    expect(mcpTools({ name: "crm", transport: "sse", url: "http://localhost" }).name).toBe("tools:mcp:crm")
    expect(mcpTools({ name: "db", transport: "stdio", command: "cmd" }).name).toBe("tools:mcp:db")
  })

  // ─── Connection tests ────────────────────────────────

  describe("connection", () => {
    it("connects via stdio transport", async () => {
      const middleware = mcpTools({
        name: "crm",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@acme/crm-mcp"],
        env: { FOO: "bar" },
      })

      const ctx = createMockCtx()
      await middleware.agent!(ctx as any, async () => {})

      expect(MockStdioTransport).toHaveBeenCalledWith({
        command: "npx",
        args: ["-y", "@acme/crm-mcp"],
        env: { FOO: "bar" },
      })
      expect(mockConnect).toHaveBeenCalledTimes(1)
    })

    it("connects via SSE transport", async () => {
      const middleware = mcpTools({
        name: "docs",
        transport: "sse",
        url: "https://mcp.example.com/sse",
        headers: { Authorization: "Bearer tok" },
      })

      const ctx = createMockCtx()
      await middleware.agent!(ctx as any, async () => {})

      expect(MockSSETransport).toHaveBeenCalledTimes(1)
      const [url, opts] = MockSSETransport.mock.calls[0]
      expect(url).toBeInstanceOf(URL)
      expect(url.toString()).toBe("https://mcp.example.com/sse")
      expect(opts.requestInit.headers).toEqual({ Authorization: "Bearer tok" })
      expect(mockConnect).toHaveBeenCalledTimes(1)
    })

    it("connects via HTTP (streamable) transport", async () => {
      const middleware = mcpTools({
        name: "api",
        transport: "http",
        url: "https://mcp.example.com/http",
      })

      const ctx = createMockCtx()
      await middleware.agent!(ctx as any, async () => {})

      expect(MockHTTPTransport).toHaveBeenCalledTimes(1)
      const [url, opts] = MockHTTPTransport.mock.calls[0]
      expect(url).toBeInstanceOf(URL)
      expect(url.toString()).toBe("https://mcp.example.com/http")
      // No headers → requestInit should be undefined
      expect(opts.requestInit).toBeUndefined()
    })

    it("throws descriptive error when connection fails", async () => {
      mockConnect.mockRejectedValue(new Error("ECONNREFUSED"))

      const middleware = mcpTools({
        name: "broken",
        transport: "stdio",
        command: "bad-cmd",
      })

      const ctx = createMockCtx()
      await expect(middleware.agent!(ctx as any, async () => {})).rejects.toThrow(
        /Failed to connect to MCP server "broken" \(stdio\): ECONNREFUSED/,
      )
    })
  })

  // ─── Tool discovery and registration ──────────────────

  describe("tool discovery", () => {
    it("registers discovered tools on the agent context", async () => {
      mockListTools.mockResolvedValue({
        tools: [
          { name: "search_crm", description: "Search the CRM", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
          { name: "create_ticket", description: "Create a ticket", inputSchema: { type: "object" } },
        ],
      })

      const ctx = createMockCtx()
      const middleware = mcpTools({ name: "crm", transport: "stdio", command: "npx" })
      await middleware.agent!(ctx as any, async () => {})

      expect(ctx.registerTool).toHaveBeenCalledTimes(2)

      const tool1 = ctx.registerTool.mock.calls[0][0]
      expect(tool1.name).toBe("search_crm")
      expect(tool1.description).toBe("Search the CRM")
      expect(tool1.jsonSchema).toEqual({ type: "object", properties: { query: { type: "string" } } })
      expect(tool1.execute).toBeTypeOf("function")
      expect(tool1.timeout).toBe(30_000)

      const tool2 = ctx.registerTool.mock.calls[1][0]
      expect(tool2.name).toBe("create_ticket")
      expect(tool2.description).toBe("Create a ticket")
    })

    it("handles server with no tools gracefully", async () => {
      mockListTools.mockResolvedValue({ tools: [] })
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

      const ctx = createMockCtx()
      const middleware = mcpTools({ name: "empty", transport: "stdio", command: "cmd" })
      await middleware.agent!(ctx as any, async () => {})

      expect(ctx.registerTool).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Server "empty" has no tools'),
      )
      warnSpy.mockRestore()
    })

    it("handles null tools list gracefully", async () => {
      mockListTools.mockResolvedValue({ tools: null })
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

      const ctx = createMockCtx()
      const middleware = mcpTools({ name: "nil", transport: "stdio", command: "cmd" })
      await middleware.agent!(ctx as any, async () => {})

      expect(ctx.registerTool).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it("defaults description to empty string when missing", async () => {
      mockListTools.mockResolvedValue({
        tools: [{ name: "no_desc", inputSchema: { type: "object" } }],
      })

      const ctx = createMockCtx()
      const middleware = mcpTools({ name: "t", transport: "stdio", command: "cmd" })
      await middleware.agent!(ctx as any, async () => {})

      const tool = ctx.registerTool.mock.calls[0][0]
      expect(tool.description).toBe("")
    })

    it("defaults inputSchema to empty object when missing", async () => {
      mockListTools.mockResolvedValue({
        tools: [{ name: "no_schema", description: "test" }],
      })

      const ctx = createMockCtx()
      const middleware = mcpTools({ name: "t", transport: "stdio", command: "cmd" })
      await middleware.agent!(ctx as any, async () => {})

      const tool = ctx.registerTool.mock.calls[0][0]
      expect(tool.jsonSchema).toEqual({})
    })

    it("throws descriptive error when listTools fails", async () => {
      mockListTools.mockRejectedValue(new Error("protocol error"))

      const ctx = createMockCtx()
      const middleware = mcpTools({ name: "bad", transport: "stdio", command: "cmd" })

      await expect(middleware.agent!(ctx as any, async () => {})).rejects.toThrow(
        /Failed to list tools from MCP server "bad": protocol error/,
      )
    })
  })

  // ─── Tool execution ──────────────────────────────────

  describe("tool execution", () => {
    it("executes tool and returns joined text content", async () => {
      mockListTools.mockResolvedValue({
        tools: [{ name: "search", description: "Search", inputSchema: {} }],
      })
      mockCallTool.mockResolvedValue({
        content: [
          { type: "text", text: "Result line 1" },
          { type: "text", text: "Result line 2" },
        ],
      })

      const ctx = createMockCtx()
      const middleware = mcpTools({ name: "s", transport: "stdio", command: "cmd" })
      await middleware.agent!(ctx as any, async () => {})

      const tool = ctx.registerTool.mock.calls[0][0]
      const result = await tool.execute({ query: "test" })

      expect(mockCallTool).toHaveBeenCalledWith({ name: "search", arguments: { query: "test" } })
      expect(result).toBe("Result line 1\nResult line 2")
    })

    it("filters out non-text content parts", async () => {
      mockListTools.mockResolvedValue({
        tools: [{ name: "img_tool", description: "test", inputSchema: {} }],
      })
      mockCallTool.mockResolvedValue({
        content: [
          { type: "image", data: "base64..." },
          { type: "text", text: "Caption" },
          { type: "resource", uri: "file://x" },
        ],
      })

      const ctx = createMockCtx()
      const middleware = mcpTools({ name: "s", transport: "stdio", command: "cmd" })
      await middleware.agent!(ctx as any, async () => {})

      const tool = ctx.registerTool.mock.calls[0][0]
      const result = await tool.execute({})
      expect(result).toBe("Caption")
    })

    it("returns JSON stringified result when content is not an array", async () => {
      mockListTools.mockResolvedValue({
        tools: [{ name: "raw", description: "test", inputSchema: {} }],
      })
      const rawResult = { content: null, meta: { status: "ok" } }
      mockCallTool.mockResolvedValue(rawResult)

      const ctx = createMockCtx()
      const middleware = mcpTools({ name: "s", transport: "stdio", command: "cmd" })
      await middleware.agent!(ctx as any, async () => {})

      const tool = ctx.registerTool.mock.calls[0][0]
      const result = await tool.execute({})
      expect(result).toBe(JSON.stringify(rawResult))
    })

    it("returns JSON stringified result when content array is missing", async () => {
      mockListTools.mockResolvedValue({
        tools: [{ name: "raw", description: "test", inputSchema: {} }],
      })
      const rawResult = { status: "ok" }
      mockCallTool.mockResolvedValue(rawResult)

      const ctx = createMockCtx()
      const middleware = mcpTools({ name: "s", transport: "stdio", command: "cmd" })
      await middleware.agent!(ctx as any, async () => {})

      const tool = ctx.registerTool.mock.calls[0][0]
      const result = await tool.execute({})
      expect(result).toBe(JSON.stringify(rawResult))
    })

    it("uses custom timeout from config", async () => {
      mockListTools.mockResolvedValue({
        tools: [{ name: "slow", description: "Slow tool", inputSchema: {} }],
      })

      const ctx = createMockCtx()
      const middleware = mcpTools({ name: "s", transport: "http", url: "http://localhost", timeout: 60_000 })
      await middleware.agent!(ctx as any, async () => {})

      const tool = ctx.registerTool.mock.calls[0][0]
      expect(tool.timeout).toBe(60_000)
    })
  })

  // ─── Cleanup / dispose ────────────────────────────────

  describe("cleanup", () => {
    it("calls client.close() after next() resolves", async () => {
      mockListTools.mockResolvedValue({ tools: [] })
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

      const ctx = createMockCtx()
      const middleware = mcpTools({ name: "c", transport: "stdio", command: "cmd" })

      let nextCalled = false
      await middleware.agent!(ctx as any, async () => { nextCalled = true })

      expect(nextCalled).toBe(true)
      expect(mockClose).toHaveBeenCalledTimes(1)
      warnSpy.mockRestore()
    })

    it("calls client.close() even when next() throws", async () => {
      mockListTools.mockResolvedValue({ tools: [] })
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

      const ctx = createMockCtx()
      const middleware = mcpTools({ name: "c", transport: "stdio", command: "cmd" })

      await expect(
        middleware.agent!(ctx as any, async () => { throw new Error("session crash") }),
      ).rejects.toThrow("session crash")

      expect(mockClose).toHaveBeenCalledTimes(1)
      warnSpy.mockRestore()
    })

    it("swallows errors from client.close() during cleanup", async () => {
      mockListTools.mockResolvedValue({ tools: [] })
      mockClose.mockRejectedValue(new Error("close failed"))
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

      const ctx = createMockCtx()
      const middleware = mcpTools({ name: "c", transport: "stdio", command: "cmd" })

      // Should NOT throw despite close() failing
      await middleware.agent!(ctx as any, async () => {})
      expect(mockClose).toHaveBeenCalledTimes(1)
      warnSpy.mockRestore()
    })
  })

  // ─── requireApproval ──────────────────────────────────

  describe("requireApproval", () => {
    it("sets requireApproval=true on all tools when config is true", async () => {
      mockListTools.mockResolvedValue({
        tools: [
          { name: "delete_user", description: "Delete", inputSchema: {} },
          { name: "read_user", description: "Read", inputSchema: {} },
        ],
      })

      const ctx = createMockCtx()
      const middleware = mcpTools({
        name: "crm",
        transport: "stdio",
        command: "cmd",
        requireApproval: true,
      })
      await middleware.agent!(ctx as any, async () => {})

      expect(ctx.registerTool.mock.calls[0][0].requireApproval).toBe(true)
      expect(ctx.registerTool.mock.calls[1][0].requireApproval).toBe(true)
    })

    it("does not set requireApproval when undefined", async () => {
      mockListTools.mockResolvedValue({
        tools: [{ name: "safe_tool", description: "Safe", inputSchema: {} }],
      })

      const ctx = createMockCtx()
      const middleware = mcpTools({ name: "t", transport: "stdio", command: "cmd" })
      await middleware.agent!(ctx as any, async () => {})

      const tool = ctx.registerTool.mock.calls[0][0]
      expect(tool.requireApproval).toBeUndefined()
    })

    it("uses glob patterns to match tool names", async () => {
      mockListTools.mockResolvedValue({
        tools: [
          { name: "delete_user", description: "Delete", inputSchema: {} },
          { name: "delete_order", description: "Delete order", inputSchema: {} },
          { name: "read_user", description: "Read", inputSchema: {} },
        ],
      })

      const ctx = createMockCtx()
      const middleware = mcpTools({
        name: "crm",
        transport: "stdio",
        command: "cmd",
        requireApproval: ["delete_*"],
      })
      await middleware.agent!(ctx as any, async () => {})

      // delete_user matches "delete_*" → true
      expect(ctx.registerTool.mock.calls[0][0].requireApproval).toBe(true)
      // delete_order matches "delete_*" → true
      expect(ctx.registerTool.mock.calls[1][0].requireApproval).toBe(true)
      // read_user does not match → false (array.some returns false)
      expect(ctx.registerTool.mock.calls[2][0].requireApproval).toBe(false)
    })

    it("glob pattern '*' matches all tools", async () => {
      mockListTools.mockResolvedValue({
        tools: [{ name: "any_tool", description: "test", inputSchema: {} }],
      })

      const ctx = createMockCtx()
      const middleware = mcpTools({
        name: "t",
        transport: "stdio",
        command: "cmd",
        requireApproval: ["*"],
      })
      await middleware.agent!(ctx as any, async () => {})

      expect(ctx.registerTool.mock.calls[0][0].requireApproval).toBe(true)
    })

    it("glob pattern exact match works", async () => {
      mockListTools.mockResolvedValue({
        tools: [
          { name: "exact_match", description: "test", inputSchema: {} },
          { name: "no_match", description: "test", inputSchema: {} },
        ],
      })

      const ctx = createMockCtx()
      const middleware = mcpTools({
        name: "t",
        transport: "stdio",
        command: "cmd",
        requireApproval: ["exact_match"],
      })
      await middleware.agent!(ctx as any, async () => {})

      expect(ctx.registerTool.mock.calls[0][0].requireApproval).toBe(true)
      // no_match: array.some returns false for non-matching names
      expect(ctx.registerTool.mock.calls[1][0].requireApproval).toBe(false)
    })

    it("wraps function requireApproval to pass toolName and args", async () => {
      mockListTools.mockResolvedValue({
        tools: [{ name: "dangerous_tool", description: "test", inputSchema: {} }],
      })

      const approvalFn = vi.fn((toolName: string, args: Record<string, unknown>) => {
        return toolName === "dangerous_tool" && args.force === true
      })

      const ctx = createMockCtx()
      const middleware = mcpTools({
        name: "t",
        transport: "stdio",
        command: "cmd",
        requireApproval: approvalFn,
      })
      await middleware.agent!(ctx as any, async () => {})

      const tool = ctx.registerTool.mock.calls[0][0]
      expect(tool.requireApproval).toBeTypeOf("function")

      // The wrapper should call the original function with toolName + args
      const needsApproval = await (tool.requireApproval as Function)({ force: true })
      expect(needsApproval).toBe(true)
      expect(approvalFn).toHaveBeenCalledWith("dangerous_tool", { force: true })

      const noApproval = await (tool.requireApproval as Function)({ force: false })
      expect(noApproval).toBe(false)
    })
  })

  // ─── Multiple tools from one server ───────────────────

  describe("multiple tools", () => {
    it("registers all tools from a single server", async () => {
      mockListTools.mockResolvedValue({
        tools: [
          { name: "tool_a", description: "A", inputSchema: { type: "object" } },
          { name: "tool_b", description: "B", inputSchema: { type: "object" } },
          { name: "tool_c", description: "C", inputSchema: { type: "object" } },
        ],
      })

      const ctx = createMockCtx()
      const middleware = mcpTools({ name: "multi", transport: "stdio", command: "cmd" })
      await middleware.agent!(ctx as any, async () => {})

      expect(ctx.registerTool).toHaveBeenCalledTimes(3)
      expect(ctx.registerTool.mock.calls[0][0].name).toBe("tool_a")
      expect(ctx.registerTool.mock.calls[1][0].name).toBe("tool_b")
      expect(ctx.registerTool.mock.calls[2][0].name).toBe("tool_c")
    })

    it("each registered tool calls the correct MCP tool by name", async () => {
      mockListTools.mockResolvedValue({
        tools: [
          { name: "tool_x", description: "X", inputSchema: {} },
          { name: "tool_y", description: "Y", inputSchema: {} },
        ],
      })
      mockCallTool.mockResolvedValue({ content: [{ type: "text", text: "ok" }] })

      const ctx = createMockCtx()
      const middleware = mcpTools({ name: "m", transport: "stdio", command: "cmd" })
      await middleware.agent!(ctx as any, async () => {})

      const toolX = ctx.registerTool.mock.calls[0][0]
      const toolY = ctx.registerTool.mock.calls[1][0]

      await toolX.execute({ q: "a" })
      expect(mockCallTool).toHaveBeenLastCalledWith({ name: "tool_x", arguments: { q: "a" } })

      await toolY.execute({ q: "b" })
      expect(mockCallTool).toHaveBeenLastCalledWith({ name: "tool_y", arguments: { q: "b" } })
    })
  })

  // ─── SSE/HTTP transport options ───────────────────────

  describe("transport options", () => {
    it("sse transport passes headers correctly", async () => {
      const ctx = createMockCtx()
      const middleware = mcpTools({
        name: "sse-test",
        transport: "sse",
        url: "https://mcp.dev/events",
        headers: { "X-Api-Key": "secret123" },
      })
      await middleware.agent!(ctx as any, async () => {})

      const [, opts] = MockSSETransport.mock.calls[0]
      expect(opts.requestInit.headers["X-Api-Key"]).toBe("secret123")
    })

    it("http transport without headers omits requestInit", async () => {
      const ctx = createMockCtx()
      const middleware = mcpTools({
        name: "http-test",
        transport: "http",
        url: "https://mcp.dev/stream",
      })
      await middleware.agent!(ctx as any, async () => {})

      const [, opts] = MockHTTPTransport.mock.calls[0]
      expect(opts.requestInit).toBeUndefined()
    })

    it("stdio transport without optional args and env", async () => {
      const ctx = createMockCtx()
      const middleware = mcpTools({
        name: "simple",
        transport: "stdio",
        command: "my-server",
      })
      await middleware.agent!(ctx as any, async () => {})

      expect(MockStdioTransport).toHaveBeenCalledWith({
        command: "my-server",
        args: undefined,
        env: undefined,
      })
    })
  })
})
