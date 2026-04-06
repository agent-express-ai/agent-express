import type { Middleware, SessionContext, TurnContext, ModelContext, ToolContext } from "../../middleware.js"
import type { ModelResponse, ToolResult } from "../../types.js"

/**
 * A single entry in the console output, representing one lifecycle event.
 */
export interface ConsoleEntry {
  /** Event type: "session:start", "turn:start", "model:call", "tool:call", etc. */
  type: string
  /** Indentation depth (0=session, 1=turn, 2=model/tool). */
  depth: number
  /** Human-readable summary line. */
  summary: string
  /** Event-specific data. */
  data?: Record<string, unknown>
}

/**
 * Configuration for `dev.console()`.
 */
export interface DevConsoleConfig {
  /** Custom format function. Overrides default formatting. */
  format?: (entry: ConsoleEntry) => string
}

/**
 * Default formatter for console entries.
 * Produces indented, colored output for terminal readability.
 */
function defaultFormat(entry: ConsoleEntry): string {
  const indent = "│  ".repeat(entry.depth)
  const prefix = entry.depth === 0 ? (entry.type.includes("start") ? "┌" : "└") : "→"
  return `${indent}${prefix} ${entry.summary}`
}

/**
 * Creates a `dev.console()` middleware that prints the full agent lifecycle
 * to stderr in a human-readable format.
 *
 * Shows: session start/end, turns, model calls (model, tokens, cost, duration),
 * tool executions (name, args, duration), guard results, and errors.
 *
 * @param config - Optional configuration with custom formatter
 * @returns Middleware that prints lifecycle to terminal
 *
 * @example
 * ```typescript
 * agent.use(dev.console())
 * // Output:
 * // ┌ session s-abc123
 * // │  → turn #0
 * // │  │  → model.call  sonnet  tokens: 150→85  $0.003  847ms
 * // │  │  → tool.exec   search  234ms
 * // │  │  → model.call  sonnet  tokens: 320→120 $0.005  612ms
 * // │  → turn #0 done  $0.008  1693ms
 * // └ session done  $0.008  1 turn
 * ```
 */
export function devConsole(config?: DevConsoleConfig): Middleware {
  const fmt = config?.format ?? defaultFormat

  function write(entry: ConsoleEntry): void {
    process.stderr.write(fmt(entry) + "\n")
  }

  return {
    name: "dev:console",

    async session(ctx: SessionContext, next: () => Promise<void>): Promise<void> {
      write({
        type: "session:start",
        depth: 0,
        summary: `session ${ctx.sessionId}`,
      })

      const start = Date.now()
      try {
        await next()
      } finally {
        write({
          type: "session:end",
          depth: 0,
          summary: `session done  ${Date.now() - start}ms`,
        })
      }
    },

    async turn(ctx: TurnContext, next: () => Promise<void>): Promise<void> {
      write({
        type: "turn:start",
        depth: 1,
        summary: `turn #${ctx.turnIndex}`,
      })

      const start = Date.now()
      try {
        await next()
      } finally {
        const duration = Date.now() - start
        write({
          type: "turn:end",
          depth: 1,
          summary: `turn #${ctx.turnIndex} done  ${duration}ms`,
          data: { output: ctx.output?.slice(0, 100) },
        })
      }
    },

    async model(ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse> {
      const start = Date.now()
      const response = await next()
      const duration = Date.now() - start

      const tokens = `${response.usage.inputTokens}→${response.usage.outputTokens}`
      const toolCalls = response.toolCalls ? ` tools:${response.toolCalls.length}` : ""

      write({
        type: "model:call",
        depth: 2,
        summary: `model.call  ${ctx.model}  tokens:${tokens}  ${duration}ms${toolCalls}`,
        data: { model: ctx.model, ...response.usage, duration },
      })

      return response
    },

    async tool(ctx: ToolContext, next: () => Promise<ToolResult>): Promise<ToolResult> {
      const start = Date.now()
      const result = await next()
      const duration = Date.now() - start

      const error = result.isError ? " ERROR" : ""

      write({
        type: "tool:call",
        depth: 2,
        summary: `tool.exec   ${ctx.tool.name}  ${duration}ms${error}`,
        data: { tool: ctx.tool.name, duration, args: ctx.args },
      })

      return result
    },
  }
}
