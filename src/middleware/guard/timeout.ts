import type { Middleware, TurnContext, ModelContext } from "../../middleware.js"
import type { ModelResponse } from "../../types.js"
import { AgentExpressError } from "../../errors.js"

/** Thrown when a turn or model call exceeds its time limit. */
export class TurnTimeoutError extends AgentExpressError {
  /** Timeout that was exceeded, in milliseconds. */
  readonly timeoutMs: number
  /** Whether this was a turn timeout or model call timeout. */
  readonly scope: "turn" | "model"

  constructor(timeoutMs: number, scope: "turn" | "model") {
    super(`${scope === "turn" ? "Turn" : "Model call"} timed out after ${timeoutMs}ms`, "TIMEOUT", false)
    this.name = "TurnTimeoutError"
    this.timeoutMs = timeoutMs
    this.scope = scope
  }
}

/**
 * Configuration for the `guard.timeout()` middleware.
 */
export interface TimeoutConfig {
  /** Maximum time in milliseconds for a single turn. Default: 120000 (2 minutes). */
  turn?: number
  /** Maximum time in milliseconds for a single model call. Default: 60000 (1 minute). */
  model?: number
}

/**
 * Creates a `guard.timeout()` middleware that enforces time limits on turns
 * and individual model calls.
 *
 * Throws `TurnTimeoutError` when a limit is exceeded. Timeouts are cleaned up
 * via `try/finally` to prevent resource leaks.
 *
 * @param config - Timeout configuration. Defaults: turn 120s, model 60s.
 * @returns Middleware that enforces time limits
 *
 * @example
 * ```typescript
 * agent.use(guard.timeout())                              // defaults: turn 2min, model 1min
 * agent.use(guard.timeout({ turn: 30_000 }))              // custom turn, default model
 * agent.use(guard.timeout({ turn: 30_000, model: 10_000 })) // both custom
 * ```
 */
export function guardTimeout(config: TimeoutConfig = {}): Middleware {
  const turnTimeout = config.turn ?? 120_000
  const modelTimeout = config.model ?? 60_000

  return {
    name: "guard:timeout",

    async turn(_ctx: TurnContext, next: () => Promise<void>): Promise<void> {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), turnTimeout)

      try {
        const result = await Promise.race([
          next(),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener("abort", () => {
              reject(new TurnTimeoutError(turnTimeout, "turn"))
            })
          }),
        ])
        return result
      } finally {
        clearTimeout(timer)
      }
    },

    async model(_ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse> {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), modelTimeout)

      try {
        const result = await Promise.race([
          next(),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener("abort", () => {
              reject(new TurnTimeoutError(modelTimeout, "model"))
            })
          }),
        ])
        return result
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
