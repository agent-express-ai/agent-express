import type { Middleware } from "./middleware.js"
import type { DefaultsOptions } from "./types.js"
import { modelRetry } from "./middleware/model/retry.js"
import { observeUsage } from "./middleware/observe/usage.js"
import { observeTools } from "./middleware/observe/tools.js"
import { observeDuration } from "./middleware/observe/duration.js"
import { guardMaxIterations } from "./middleware/guard/max-iterations.js"

/**
 * Returns the standard set of default middleware for common use cases.
 *
 * Included in every Agent automatically unless `defaults: false` is set.
 * Can also be called directly for advanced composition.
 *
 * Includes:
 * - `model.retry()` — exponential backoff for transient LLM failures
 * - `observe.usage()` — token tracking → `state['observe:usage']`
 * - `observe.tools()` — tool call recording → `state['observe:tools']`
 * - `observe.duration()` — turn timing → `state['observe:duration']`
 * - `guard.maxIterations()` — loop iteration limit (default 25)
 *
 * @param opts - Optional customization of default middleware behavior
 * @returns Array of middleware to pass to `agent.use()`
 */
export function defaults(opts?: DefaultsOptions): Middleware[] {
  const result: Middleware[] = []

  // Retry
  if (opts?.retry !== false) {
    const retryConfig = typeof opts?.retry === "object" ? opts.retry : undefined
    result.push(modelRetry(retryConfig))
  }

  // Observability
  result.push(observeUsage())
  result.push(observeTools())
  result.push(observeDuration())

  // Guard
  result.push(guardMaxIterations(opts?.maxIterations))

  return result
}
