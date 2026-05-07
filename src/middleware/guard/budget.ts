import type { Middleware, ModelContext } from "../../middleware.js"
import type { ModelResponse } from "../../types.js"
import { AgentExpressError } from "../../errors.js"
import { calculateCost, type ModelPricing } from "./pricing.js"

/** Thrown when the session cost limit is exceeded (if `onLimit: "error"`). */
export class BudgetExceededError extends AgentExpressError {
  /** Accumulated cost in USD at the time of the error. */
  readonly cost: number
  /** Configured limit in USD. */
  readonly limit: number

  constructor(cost: number, limit: number) {
    super(`Budget exceeded: $${cost.toFixed(4)} >= $${limit.toFixed(2)}`, "BUDGET_EXCEEDED", false)
    this.name = "BudgetExceededError"
    this.cost = cost
    this.limit = limit
  }
}

/**
 * Configuration for the `guard.budget()` middleware.
 */
export interface BudgetConfig {
  /** Maximum USD cost per session. */
  limit: number
  /** Per-model pricing override (USD per 1M tokens). Merged with built-in defaults. */
  pricing?: Record<string, ModelPricing>
  /** Fallback pricing for models not in the default or custom table. */
  fallbackPricing?: ModelPricing
  /**
   * What to do when the budget is exceeded.
   * - `"error"` (default): throw `BudgetExceededError`
   * - `"stop"`: graceful stop — skip LLM call, turn ends with empty text
   * - callback: developer decides — return string for final text, void for empty, or throw
   */
  onLimit?: "error" | "stop" | ((ctx: ModelContext, cost: number) => string | void)
}

/** Cost record for a single model call. */
export interface CostRecord {
  model: string
  inputTokens: number
  outputTokens: number
  cost: number
}

/**
 * Creates a `guard.budget()` middleware that enforces a per-session USD cost limit.
 *
 * Tracks accumulated cost across all model calls using token counts from LLM
 * responses multiplied by per-model pricing (USD per 1M tokens).
 *
 * @param config - Budget configuration with USD limit and optional pricing overrides
 * @returns Middleware that enforces cost limits
 *
 * @example
 * ```typescript
 * // Default: throws BudgetExceededError
 * agent.use(guard.budget({ limit: 0.50 }))
 *
 * // Graceful stop: turn ends with empty text
 * agent.use(guard.budget({ limit: 0.50, onLimit: "stop" }))
 *
 * // Custom handler:
 * agent.use(guard.budget({
 *   limit: 1.00,
 *   onLimit: (ctx, cost) => "Sorry, I've reached my budget limit.",
 * }))
 * ```
 */
export function budgetGuard(config: BudgetConfig): Middleware {
  const onLimit = config.onLimit ?? "error"

  return {
    name: "guard:budget",

    state: {
      "guard:budget:totalCost": {
        default: 0,
        reducer: (prev: unknown, delta: unknown) => {
          // typeof guard before arithmetic
          const p = typeof prev === "number" ? prev : 0
          const d = typeof delta === "number" ? delta : 0
          return p + d
        },
      },
      "guard:budget:calls": {
        default: [] as CostRecord[],
        reducer: (prev: unknown, delta: unknown) => [
          ...(Array.isArray(prev) ? prev : []),
          ...(Array.isArray(delta) ? delta : []),
        ],
      },
    },

    async model(ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse> {
      const currentCost = (ctx.state["guard:budget:totalCost"] as number) ?? 0
      if (currentCost >= config.limit) {
        const message = `cost=$${currentCost.toFixed(4)} >= limit=$${config.limit.toFixed(2)}`
        ctx.emit({
          type: "turn:aborted",
          payload: { reason: "budget", message, callIndex: ctx.callIndex },
        })
        if (onLimit === "error") {
          throw new BudgetExceededError(currentCost, config.limit)
        }
        if (onLimit === "stop") {
          return { text: "", finishReason: "budget", usage: { inputTokens: 0, outputTokens: 0 } }
        }
        // Callback
        const result = onLimit(ctx, currentCost)
        return {
          text: result ?? "",
          finishReason: "budget",
          usage: { inputTokens: 0, outputTokens: 0 },
        }
      }

      const response = await next()

      const callCost = calculateCost(ctx.model, response.usage, config.pricing, config.fallbackPricing)
      const record: CostRecord = {
        model: ctx.model,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        cost: callCost,
      }

      ctx.state["guard:budget:totalCost"] = callCost
      ctx.state["guard:budget:calls"] = [record]

      return response
    },
  }
}
