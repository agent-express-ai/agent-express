import type { Middleware } from "./middleware.js"

/** Hook names that support onion composition. */
type HookName = "agent" | "session" | "turn" | "model" | "tool"

/**
 * Composes middleware hooks into an onion-model execution chain.
 *
 * Given a list of middleware and a hook name, extracts the matching hooks
 * and builds a chain where each hook calls `next()` to invoke the next one.
 * The innermost function (`innerFn`) is the core operation being wrapped
 * (e.g., the actual LLM call for "model", or the agent loop for "turn").
 *
 * Execution order for middlewares [A, B, C]:
 * ```
 * A-before → B-before → C-before → innerFn → C-after → B-after → A-after
 * ```
 *
 * This is the same onion model used by Koa, Express, and Hono.
 *
 * @param middlewares - Registered middleware in order
 * @param hookName - Which hook to compose ("session", "turn", "model", or "tool")
 * @param innerFn - The core function to wrap (called when the innermost middleware calls `next()`)
 * @returns A composed function that runs the full onion chain
 *
 * @example
 * ```typescript
 * const chain = composeHooks(middlewares, "model", async (ctx) => {
 *   return await callLLM(ctx.messages)
 * })
 * const response = await chain(modelContext)
 * ```
 */
export function composeHooks<TCtx, TResult>(
  middlewares: Middleware[],
  hookName: HookName,
  innerFn: (ctx: TCtx) => Promise<TResult>,
): (ctx: TCtx) => Promise<TResult> {
  const hooks = middlewares
    .filter((m) => m[hookName] != null)
    .map((m) => m[hookName]! as (ctx: TCtx, next: () => Promise<TResult>) => Promise<TResult>)

  if (hooks.length === 0) {
    return innerFn
  }

  return (ctx: TCtx) => {
    let index = 0

    const dispatch = (): Promise<TResult> => {
      if (index >= hooks.length) {
        return innerFn(ctx)
      }
      const hook = hooks[index++]!
      return hook(ctx, dispatch)
    }

    return dispatch()
  }
}
