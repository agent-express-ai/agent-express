import type { Middleware, SessionContext, TurnContext, ModelContext, ToolContext } from "../../middleware.js"
import type { LogEvent, ModelResponse, ToolResult } from "../../types.js"
import { tryImportOtel } from "./otel-api.js"

/**
 * Configuration for the `observe.log()` middleware.
 */
export interface ObserveLogOptions {
  /** Custom output function. Default: JSON line to stderr. */
  output?: (event: LogEvent) => void
  /** Record prompt/response content in log events. Default: false. */
  recordContent?: boolean
}

/**
 * Creates an `observe.log()` middleware that emits structured JSON log events
 * for every lifecycle phase.
 *
 * Logs session, turn, model, and tool start/end events as `LogEvent` objects.
 * By default, writes JSON lines to stderr — suitable for structured logging
 * pipelines (Datadog, Grafana, ELK, etc.).
 *
 * Enhanced with: `level`, `agentName`, `turnId`, `durationMs`, `error`,
 * `traceId`/`spanId` correlation, and opt-in `recordContent`.
 *
 * @param opts - Optional configuration
 * @returns Middleware that logs all lifecycle events
 *
 * @example
 * ```typescript
 * // Default: JSON lines to stderr
 * agent.use(observe.log())
 *
 * // Custom output with level-based routing:
 * agent.use(observe.log({
 *   output: (event) => {
 *     if (event.level === "error") pino.error(event)
 *     else pino.info(event)
 *   }
 * }))
 *
 * // With content recording (prompts/responses at debug level):
 * agent.use(observe.log({ recordContent: true }))
 * ```
 */
export function observeLog(opts?: ObserveLogOptions): Middleware {
  const output = opts?.output ?? ((event: LogEvent) => {
    process.stderr.write(JSON.stringify(event) + "\n")
  })
  const recordContent = opts?.recordContent ?? false

  /** Try to get active OTel trace context for log-trace correlation. */
  async function getTraceContext(): Promise<{ traceId?: string; spanId?: string }> {
    try {
      const otel = await tryImportOtel()
      if (!otel) return {}
      const span = otel.trace.getActiveSpan()
      if (!span) return {}
      const ctx = span.spanContext()
      return { traceId: ctx.traceId, spanId: ctx.spanId }
    } catch {
      return {}
    }
  }

  function emit(
    level: "debug" | "info" | "warn" | "error",
    type: string,
    sessionId: string,
    turnIndex: number,
    agentName: string,
    extra: {
      data?: Record<string, unknown>
      turnId?: string
      durationMs?: number
      error?: { type: string; message: string }
      traceId?: string
      spanId?: string
    } = {},
  ): void {
    const event: LogEvent = {
      timestamp: new Date().toISOString(),
      level,
      type,
      sessionId,
      turnIndex,
      agentName,
      data: extra.data ?? {},
    }
    if (extra.turnId) event.turnId = extra.turnId
    if (extra.durationMs !== undefined) event.durationMs = extra.durationMs
    if (extra.error) event.error = extra.error
    if (extra.traceId) event.traceId = extra.traceId
    if (extra.spanId) event.spanId = extra.spanId
    output(event)
  }

  return {
    name: "observe:log",

    async session(ctx: SessionContext, next: () => Promise<void>): Promise<void> {
      const trace = await getTraceContext()
      const agentName = ctx.agent.name
      const start = Date.now()

      emit("info", "session:start", ctx.sessionId, 0, agentName, trace)
      try {
        await next()
        emit("info", "session:end", ctx.sessionId, 0, agentName, {
          ...trace,
          durationMs: Date.now() - start,
        })
      } catch (err) {
        emit("error", "session:end", ctx.sessionId, 0, agentName, {
          ...trace,
          durationMs: Date.now() - start,
          error: {
            type: (err as Error).constructor?.name ?? "Error",
            message: (err as Error).message ?? String(err),
          },
        })
        throw err
      }
    },

    async turn(ctx: TurnContext, next: () => Promise<void>): Promise<void> {
      const trace = await getTraceContext()
      const agentName = ctx.agent.name
      const start = Date.now()

      emit("info", "turn:start", ctx.sessionId, ctx.turnIndex, agentName, {
        ...trace,
        turnId: ctx.turnId,
      })
      try {
        await next()
        emit("info", "turn:end", ctx.sessionId, ctx.turnIndex, agentName, {
          ...trace,
          turnId: ctx.turnId,
          durationMs: Date.now() - start,
        })
      } catch (err) {
        emit("error", "turn:end", ctx.sessionId, ctx.turnIndex, agentName, {
          ...trace,
          turnId: ctx.turnId,
          durationMs: Date.now() - start,
          error: {
            type: (err as Error).constructor?.name ?? "Error",
            message: (err as Error).message ?? String(err),
          },
        })
        throw err
      }
    },

    async model(ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse> {
      const trace = await getTraceContext()
      const agentName = ctx.agent.name
      const start = Date.now()

      emit("info", "model:call", ctx.sessionId, ctx.turnIndex, agentName, {
        ...trace,
        turnId: ctx.turnId,
        data: {
          model: ctx.model,
          callIndex: ctx.callIndex,
        },
      })

      try {
        const response = await next()
        const data: Record<string, unknown> = {
          model: ctx.model,
          callIndex: ctx.callIndex,
          finishReason: response.finishReason,
          usage: response.usage,
        }

        if (recordContent) {
          data["messages"] = ctx.messages
          data["response"] = response.text
          emit("debug", "model:response", ctx.sessionId, ctx.turnIndex, agentName, {
            ...trace,
            turnId: ctx.turnId,
            durationMs: Date.now() - start,
            data,
          })
        } else {
          emit("info", "model:response", ctx.sessionId, ctx.turnIndex, agentName, {
            ...trace,
            turnId: ctx.turnId,
            durationMs: Date.now() - start,
            data,
          })
        }

        return response
      } catch (err) {
        emit("error", "model:response", ctx.sessionId, ctx.turnIndex, agentName, {
          ...trace,
          turnId: ctx.turnId,
          durationMs: Date.now() - start,
          data: { model: ctx.model, callIndex: ctx.callIndex },
          error: {
            type: (err as Error).constructor?.name ?? "Error",
            message: (err as Error).message ?? String(err),
          },
        })
        throw err
      }
    },

    async tool(ctx: ToolContext, next: () => Promise<ToolResult>): Promise<ToolResult> {
      const trace = await getTraceContext()
      const agentName = ctx.agent.name
      const start = Date.now()

      emit("info", "tool:start", ctx.sessionId, ctx.turnIndex, agentName, {
        ...trace,
        turnId: ctx.turnId,
        data: {
          tool: ctx.tool.name,
          callId: ctx.callId,
          callIndex: ctx.callIndex,
        },
      })

      try {
        const result = await next()

        const data: Record<string, unknown> = {
          tool: ctx.tool.name,
          callId: ctx.callId,
          callIndex: ctx.callIndex,
        }
        if (recordContent) {
          data["args"] = ctx.args
          data["result"] = result.result
        }

        if (result.isError) {
          emit("warn", "tool:end", ctx.sessionId, ctx.turnIndex, agentName, {
            ...trace,
            turnId: ctx.turnId,
            durationMs: Date.now() - start,
            data,
            error: { type: "ToolExecutionError", message: String(result.result) },
          })
        } else {
          emit(recordContent ? "debug" : "info", "tool:end", ctx.sessionId, ctx.turnIndex, agentName, {
            ...trace,
            turnId: ctx.turnId,
            durationMs: Date.now() - start,
            data,
          })
        }

        return result
      } catch (err) {
        emit("error", "tool:end", ctx.sessionId, ctx.turnIndex, agentName, {
          ...trace,
          turnId: ctx.turnId,
          durationMs: Date.now() - start,
          data: { tool: ctx.tool.name, callId: ctx.callId, callIndex: ctx.callIndex },
          error: {
            type: (err as Error).constructor?.name ?? "Error",
            message: (err as Error).message ?? String(err),
          },
        })
        throw err
      }
    },
  }
}
