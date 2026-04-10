import type { Middleware, TurnContext, ModelContext } from "../../middleware.js"
import type { ModelResponse } from "../../types.js"

/**
 * Creates a `guard.maxIterations()` middleware that limits the number of
 * model calls per turn.
 *
 * Prevents runaway agent loops where the model repeatedly calls tools without
 * converging. Uses a closure-based counter (not session state) that resets at
 * the start of each turn.
 *
 * When the limit is reached, the middleware strips tool calls from the last
 * response so no unnecessary tool executions happen. If the model produced no
 * text, the turn completes with an empty string.
 *
 * @param max - Maximum model calls allowed per turn. Default: 25.
 * @returns Middleware that enforces per-turn iteration limits
 *
 * @example
 * ```typescript
 * agent.use(guard.maxIterations())    // default: 25
 * agent.use(guard.maxIterations(10))  // custom limit
 * ```
 */
export function guardMaxIterations(max: number = 25): Middleware {
  // Per-turn counter scoped via Map keyed by turnId to avoid cross-session interference.
  const counters = new Map<string, number>()

  return {
    name: "guard:maxIterations",

    async turn(ctx: TurnContext, next: () => Promise<void>): Promise<void> {
      counters.set(ctx.turnId, 0)
      try {
        await next()
      } finally {
        counters.delete(ctx.turnId)
      }
    },

    async model(ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse> {
      const count = (counters.get(ctx.turnId) ?? 0) + 1
      counters.set(ctx.turnId, count)

      if (count > max) {
        // Already over limit — skip the LLM call entirely.
        return {
          text: "",
          finishReason: "length",
          usage: { inputTokens: 0, outputTokens: 0 },
        }
      }

      const response = await next()

      // If this is the last allowed call — strip tool calls to prevent
      // unnecessary tool executions. The loop will see a text-only response
      // and exit gracefully.
      if (count >= max && response.toolCalls && response.toolCalls.length > 0) {
        return {
          text: response.text ?? "",
          finishReason: "length",
          usage: response.usage,
        }
      }

      return response
    },
  }
}
