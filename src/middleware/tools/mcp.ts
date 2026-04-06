import type { Middleware } from "../../middleware.js"
import type { Tool } from "../../types.js"

/**
 * MCP server transport configuration.
 */
export type McpServerConfig = {
  /** Server identifier for debugging and tool name disambiguation. */
  name: string
  /**
   * Which tools from this server require human approval.
   * - `true`: all tools
   * - `string[]`: tool names matching glob patterns (e.g., `["delete_*", "drop_*"]`)
   * - `function(toolName, args)`: conditional by name and runtime arguments
   */
  requireApproval?: boolean | string[] | ((toolName: string, args: Record<string, unknown>) => boolean | Promise<boolean>)
} & (
  | { transport: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { transport: "sse"; url: string; headers?: Record<string, string>; timeout?: number }
  | { transport: "http"; url: string; headers?: Record<string, string>; timeout?: number }
)

/** Resolves MCP requireApproval config to a per-tool value. */
function resolveRequireApproval(
  config: McpServerConfig["requireApproval"],
  toolName: string,
): Tool["requireApproval"] {
  if (config === undefined) return undefined
  if (config === true) return true
  if (typeof config === "function") {
    // Wrap as (args) => bool, capturing toolName in closure
    return (args: Record<string, unknown>) => (config as (n: string, a: Record<string, unknown>) => boolean | Promise<boolean>)(toolName, args)
  }
  if (Array.isArray(config)) {
    // Glob pattern matching
    return config.some((pattern) => matchGlob(pattern, toolName))
  }
  return undefined
}

/** Simple glob matching: supports * wildcard at end (e.g., "delete_*"). */
function matchGlob(pattern: string, name: string): boolean {
  if (pattern === "*") return true
  if (pattern.endsWith("*")) {
    return name.startsWith(pattern.slice(0, -1))
  }
  return pattern === name
}

/**
 * Creates a `tools.mcp()` middleware that connects to an MCP server,
 * discovers its tools, and registers them on the agent.
 *
 * One server per `.use()` call. For multiple servers, call `.use()` multiple times.
 * Requires `@modelcontextprotocol/sdk` as a peer dependency (optional install).
 *
 * @param config - MCP server connection configuration
 * @returns Middleware that connects to the MCP server and registers its tools
 *
 * @example
 * ```typescript
 * // Local process via stdio
 * agent.use(tools.mcp({
 *   name: "crm",
 *   transport: "stdio",
 *   command: "npx",
 *   args: ["-y", "@acme/crm-mcp"],
 * }))
 *
 * // Remote server via HTTP
 * agent.use(tools.mcp({
 *   name: "docs",
 *   transport: "http",
 *   url: "https://mcp.example.com",
 *   headers: { "Authorization": "Bearer token" },
 * }))
 * ```
 */
export function mcpTools(config: McpServerConfig): Middleware {
  return {
    name: `tools:mcp:${config.name}`,

    async agent(ctx, next) {
      // Dynamic import — @modelcontextprotocol/sdk is an optional peer dependency
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let Client: any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let TransportClass: any

      try {
        // @ts-expect-error — @modelcontextprotocol/sdk is an optional peer dependency
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const clientMod: any = await import("@modelcontextprotocol/sdk/client")
        Client = clientMod.Client

        if (config.transport === "stdio") {
          // @ts-expect-error — optional peer dependency
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const stdioMod: any = await import("@modelcontextprotocol/sdk/client/stdio")
          TransportClass = stdioMod.StdioClientTransport
        } else if (config.transport === "sse") {
          // @ts-expect-error — optional peer dependency
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sseMod: any = await import("@modelcontextprotocol/sdk/client/sse")
          TransportClass = sseMod.SSEClientTransport
        } else if (config.transport === "http") {
          // @ts-expect-error — optional peer dependency
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const httpMod: any = await import("@modelcontextprotocol/sdk/client/streamableHttp")
          TransportClass = httpMod.StreamableHTTPClientTransport
        }
      } catch (err) {
        if ((err as { code?: string }).code === "ERR_MODULE_NOT_FOUND") {
          throw new Error(
            `@modelcontextprotocol/sdk is not installed. Run: npm install @modelcontextprotocol/sdk\n` +
            `Required for tools.mcp() middleware.`,
          )
        }
        throw err
      }

      // Create transport
      let transport: any = null
      if (config.transport === "stdio") {
        const stdioConfig = config as { command: string; args?: string[]; env?: Record<string, string> }
        transport = new TransportClass({
          command: stdioConfig.command,
          args: stdioConfig.args,
          env: stdioConfig.env,
        })
      } else if (config.transport === "sse" || config.transport === "http") {
        const httpConfig = config as { url: string; headers?: Record<string, string> }
        transport = new TransportClass(
          new URL(httpConfig.url),
          { requestInit: httpConfig.headers ? { headers: httpConfig.headers } : undefined },
        )
      }

      // Connect
      const client = new Client({ name: `agent-express:${config.name}`, version: "1.0.0" })

      try {
        await client.connect(transport)
      } catch (err) {
        throw new Error(
          `Failed to connect to MCP server "${config.name}" (${config.transport}): ${(err as Error).message}`,
        )
      }

      // Discover and register tools
      try {
        const { tools: mcpToolList } = await client.listTools()

        if (!mcpToolList || mcpToolList.length === 0) {
          console.warn(`[tools.mcp] Server "${config.name}" has no tools. Continuing without MCP tools.`)
        } else {
          for (const mcpTool of mcpToolList) {
            const resolved = resolveRequireApproval(config.requireApproval, mcpTool.name)
            const tool: Tool = {
              name: mcpTool.name,
              description: mcpTool.description ?? "",
              schema: {} as any, // MCP tools use JSON Schema directly, no Zod
              jsonSchema: mcpTool.inputSchema ?? {},
              execute: async (args: Record<string, unknown>) => {
                const result = await client.callTool({
                  name: mcpTool.name,
                  arguments: args,
                })
                if (result.content && Array.isArray(result.content)) {
                  const textParts = result.content
                    .filter((c: any) => c.type === "text")
                    .map((c: any) => c.text)
                  return textParts.join("\n")
                }
                return JSON.stringify(result)
              },
              timeout: (config as any).timeout ?? 30_000,
              ...(resolved !== undefined && { requireApproval: resolved }),
            }
            ctx.registerTool(tool)
          }
        }
      } catch (err) {
        throw new Error(
          `Failed to list tools from MCP server "${config.name}": ${(err as Error).message}`,
        )
      }

      // Agent lifetime — cleanup on dispose
      try {
        await next()
      } finally {
        try {
          await client.close()
        } catch {
          // Ignore close errors during cleanup
        }
      }
    },
  }
}
