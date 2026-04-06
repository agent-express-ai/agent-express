import type { Usage } from "../../types.js"

/** Pricing per 1 million tokens in USD. */
export interface ModelPricing {
  /** USD per 1M input tokens. */
  input: number
  /** USD per 1M output tokens. */
  output: number
}

/**
 * Default pricing table for popular models (USD per 1M tokens).
 * Updated per package release. Users can override via `guard.budget({ pricing })`.
 */
export const DEFAULT_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  "anthropic/claude-opus-4-6": { input: 15.0, output: 75.0 },
  "anthropic/claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "anthropic/claude-haiku-4-5": { input: 0.8, output: 4.0 },
  // OpenAI
  "openai/gpt-4o": { input: 2.5, output: 10.0 },
  "openai/gpt-4o-mini": { input: 0.15, output: 0.6 },
  "openai/gpt-4.1": { input: 2.0, output: 8.0 },
  "openai/gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "openai/o3-mini": { input: 1.1, output: 4.4 },
}

/** Default fallback pricing for unknown models (Sonnet-level, conservative). */
export const DEFAULT_FALLBACK_PRICING: ModelPricing = { input: 3.0, output: 15.0 }

/**
 * Calculates the USD cost for a model call based on token usage and pricing.
 *
 * @param modelId - Model identifier (e.g., "anthropic/claude-sonnet-4-6")
 * @param usage - Token counts from the model response
 * @param customPricing - User-provided pricing overrides
 * @param fallback - Fallback pricing for unknown models
 * @returns Cost in USD
 *
 * @example
 * ```typescript
 * const cost = calculateCost("anthropic/claude-sonnet-4-6", { inputTokens: 1000, outputTokens: 500 })
 * // cost ≈ 0.0105 ($3/1M * 1000 + $15/1M * 500)
 * ```
 */
export function calculateCost(
  modelId: string,
  usage: Usage,
  customPricing?: Record<string, ModelPricing>,
  fallback: ModelPricing = DEFAULT_FALLBACK_PRICING,
): number {
  const pricing = customPricing?.[modelId] ?? DEFAULT_PRICING[modelId] ?? fallback
  return (
    (usage.inputTokens / 1_000_000) * pricing.input +
    (usage.outputTokens / 1_000_000) * pricing.output
  )
}
