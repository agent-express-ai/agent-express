import type { Middleware, TurnContext } from "../../middleware.js"

/**
 * Creates an `observe.duration()` middleware that measures the wall-clock
 * duration of each turn in milliseconds.
 *
 * Uses last-write-wins semantics (no reducer), so `ctx.state['observe:duration']`
 * always reflects the duration of the most recently completed turn.
 *
 * @returns Middleware that tracks turn duration
 *
 * @example
 * ```typescript
 * agent.use(observe.duration())
 *
 * const result = await agent.run("Hello").result
 * const ms = result.state['observe:duration'] as number
 * console.log(`Turn took ${ms}ms`)
 * ```
 */
export function observeDuration(): Middleware {
  return {
    name: "observe:duration",

    state: {
      "observe:duration": {
        default: 0,
      },
    },

    async turn(ctx: TurnContext, next: () => Promise<void>): Promise<void> {
      const start = Date.now()
      await next()
      ctx.state["observe:duration"] = Date.now() - start
    },
  }
}
