import type { Middleware, ModelContext } from "../../middleware.js"
import type { ModelResponse, Usage } from "../../types.js"

/**
 * Creates an `observe.usage()` middleware that accumulates token usage
 * across all model calls in a session.
 *
 * Tracks `inputTokens` and `outputTokens` via a reducer that sums deltas
 * from each model response. The accumulated totals are available in
 * `ctx.state['observe:usage']` at any point during the session.
 *
 * @returns Middleware that tracks cumulative token usage
 *
 * @example
 * ```typescript
 * agent.use(observe.usage())
 *
 * const result = await agent.run("Hello").result
 * const usage = result.state['observe:usage'] as Usage
 * console.log(`Tokens: ${usage.inputTokens} in, ${usage.outputTokens} out`)
 * ```
 */
export function observeUsage(): Middleware {
  return {
    name: "observe:usage",

    state: {
      "observe:usage": {
        default: { inputTokens: 0, outputTokens: 0 } as Usage,
        reducer: (prev: unknown, delta: unknown) => {
          const p = prev as Usage
          const d = delta as Usage
          return {
            inputTokens: p.inputTokens + d.inputTokens,
            outputTokens: p.outputTokens + d.outputTokens,
          }
        },
      },
    },

    async model(ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse> {
      const response = await next()
      ctx.state["observe:usage"] = response.usage
      return response
    },
  }
}
