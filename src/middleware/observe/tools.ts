import type { Middleware, ToolContext } from "../../middleware.js"
import type { ToolResult, ToolCallRecord } from "../../types.js"

/**
 * Creates an `observe.tools()` middleware that records every tool execution
 * in the session, including arguments, results, duration, and errors.
 *
 * Each tool call is appended to the `observe:tools` state array via a
 * reducer. The full history of tool calls is available in
 * `ctx.state['observe:tools']` at any point during the session.
 *
 * @returns Middleware that records tool call history
 *
 * @example
 * ```typescript
 * agent.use(observe.tools())
 *
 * const result = await agent.run("Search for cats").result
 * const calls = result.state['observe:tools'] as ToolCallRecord[]
 * for (const call of calls) {
 *   console.log(`${call.name}: ${call.duration}ms`)
 * }
 * ```
 */
export function observeTools(): Middleware {
  return {
    name: "observe:tools",

    state: {
      "observe:tools": {
        default: [] as ToolCallRecord[],
        reducer: (prev: unknown, delta: unknown) => [
          ...(prev as ToolCallRecord[]),
          ...(delta as ToolCallRecord[]),
        ],
      },
    },

    async tool(ctx: ToolContext, next: () => Promise<ToolResult>): Promise<ToolResult> {
      const start = Date.now()
      const result = await next()
      const duration = Date.now() - start

      ctx.state["observe:tools"] = [
        {
          callId: ctx.callId,
          name: ctx.tool.name,
          args: ctx.args,
          result: result.result,
          duration,
          error: result.isError ? String(result.result) : undefined,
        },
      ] as ToolCallRecord[]

      return result
    },
  }
}
