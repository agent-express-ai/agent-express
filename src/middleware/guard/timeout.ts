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
  /** Maximum time in milliseconds for a single turn. */
  turn?: number
  /** Maximum time in milliseconds for a single model call. */
  model?: number
}

/**
 * Creates a `guard.timeout()` middleware that enforces time limits on turns
 * and individual model calls.
 *
 * Throws `TurnTimeoutError` when a limit is exceeded. Timeouts are cleaned up
 * via `try/finally` to prevent resource leaks.
 *
 * @param config - Timeout configuration with optional turn and model limits in ms
 * @returns Middleware that enforces time limits
 *
 * @example
 * ```typescript
 * agent.use(guard.timeout({ turn: 30_000, model: 10_000 }))
 * ```
 */
export function guardTimeout(config: TimeoutConfig): Middleware {
  const mw: Middleware = {
    name: "guard:timeout",
  }

  if (config.turn) {
    const turnTimeout = config.turn
    mw.turn = async (_ctx: TurnContext, next: () => Promise<void>): Promise<void> => {
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
    }
  }

  if (config.model) {
    const modelTimeout = config.model
    mw.model = async (_ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse> => {
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
    }
  }

  return mw
}
