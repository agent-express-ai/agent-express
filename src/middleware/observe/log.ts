import type { Middleware, SessionContext, TurnContext, ModelContext, ToolContext } from "../../middleware.js"
import type { LogEvent, ModelResponse, ToolResult } from "../../types.js"

/**
 * Configuration for the `observe.log()` middleware.
 */
export interface ObserveLogOptions {
  /** Custom output function. Default: JSON line to stderr. */
  output?: (event: LogEvent) => void
}

/**
 * Creates an `observe.log()` middleware that emits structured JSON log events
 * for every lifecycle phase.
 *
 * Logs session, turn, model, and tool start/end events as `LogEvent` objects.
 * By default, writes JSON lines to stderr — suitable for structured logging
 * pipelines (Datadog, Grafana, ELK, etc.).
 *
 * @param opts - Optional configuration with custom output function
 * @returns Middleware that logs all lifecycle events
 *
 * @example
 * ```typescript
 * // Default: JSON lines to stderr
 * agent.use(observe.log())
 *
 * // Custom output (e.g., pino):
 * agent.use(observe.log({ output: (event) => pino.info(event) }))
 * ```
 */
export function observeLog(opts?: ObserveLogOptions): Middleware {
  const output = opts?.output ?? ((event: LogEvent) => {
    process.stderr.write(JSON.stringify(event) + "\n")
  })

  function emit(type: string, sessionId: string, turnIndex: number, data: Record<string, unknown> = {}): void {
    const event: LogEvent = {
      timestamp: new Date().toISOString(),
      type,
      sessionId,
      turnIndex,
      data,
    }
    output(event)
  }

  return {
    name: "observe:log",

    async session(ctx: SessionContext, next: () => Promise<void>): Promise<void> {
      emit("session:start", ctx.sessionId, 0)
      try {
        await next()
      } finally {
        emit("session:end", ctx.sessionId, 0)
      }
    },

    async turn(ctx: TurnContext, next: () => Promise<void>): Promise<void> {
      emit("turn:start", ctx.sessionId, ctx.turnIndex, { turnId: ctx.turnId })
      try {
        await next()
      } finally {
        emit("turn:end", ctx.sessionId, ctx.turnIndex, { turnId: ctx.turnId })
      }
    },

    async model(ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse> {
      emit("model:call", ctx.sessionId, ctx.turnIndex, {
        model: ctx.model,
        callIndex: ctx.callIndex,
      })
      const response = await next()
      emit("model:response", ctx.sessionId, ctx.turnIndex, {
        model: ctx.model,
        callIndex: ctx.callIndex,
        finishReason: response.finishReason,
        usage: response.usage,
      })
      return response
    },

    async tool(ctx: ToolContext, next: () => Promise<ToolResult>): Promise<ToolResult> {
      emit("tool:start", ctx.sessionId, ctx.turnIndex, {
        tool: ctx.tool.name,
        callId: ctx.callId,
        callIndex: ctx.callIndex,
      })
      const result = await next()
      emit("tool:end", ctx.sessionId, ctx.turnIndex, {
        tool: ctx.tool.name,
        callId: ctx.callId,
        callIndex: ctx.callIndex,
      })
      return result
    },
  }
}
