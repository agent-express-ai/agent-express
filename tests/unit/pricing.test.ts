import { describe, it, expect } from "vitest"
import { calculateCost, DEFAULT_PRICING, DEFAULT_FALLBACK_PRICING } from "../../src/middleware/guard/pricing.js"

describe("calculateCost", () => {
  it("calculates cost for known Anthropic model", () => {
    const cost = calculateCost("anthropic/claude-sonnet-4-6", {
      inputTokens: 1000,
      outputTokens: 500,
    })
    // (1000/1M) * 3.0 + (500/1M) * 15.0 = 0.003 + 0.0075 = 0.0105
    expect(cost).toBeCloseTo(0.0105, 6)
  })

  it("calculates cost for known OpenAI model", () => {
    const cost = calculateCost("openai/gpt-4o", {
      inputTokens: 10000,
      outputTokens: 5000,
    })
    // (10000/1M) * 2.5 + (5000/1M) * 10.0 = 0.025 + 0.05 = 0.075
    expect(cost).toBeCloseTo(0.075, 6)
  })

  it("uses fallback pricing for unknown model", () => {
    const cost = calculateCost("unknown/model", {
      inputTokens: 1000000,
      outputTokens: 500000,
    })
    // (1M/1M) * 3.0 + (500K/1M) * 15.0 = 3.0 + 7.5 = 10.5
    expect(cost).toBeCloseTo(10.5, 2)
  })

  it("uses custom pricing override", () => {
    const cost = calculateCost(
      "anthropic/claude-sonnet-4-6",
      { inputTokens: 1000, outputTokens: 500 },
      { "anthropic/claude-sonnet-4-6": { input: 5.0, output: 20.0 } },
    )
    // (1000/1M) * 5.0 + (500/1M) * 20.0 = 0.005 + 0.01 = 0.015
    expect(cost).toBeCloseTo(0.015, 6)
  })

  it("uses custom fallback pricing", () => {
    const cost = calculateCost(
      "custom/model",
      { inputTokens: 1000, outputTokens: 1000 },
      undefined,
      { input: 1.0, output: 2.0 },
    )
    // (1000/1M) * 1.0 + (1000/1M) * 2.0 = 0.001 + 0.002 = 0.003
    expect(cost).toBeCloseTo(0.003, 6)
  })

  it("returns 0 for zero tokens", () => {
    expect(calculateCost("anthropic/claude-sonnet-4-6", { inputTokens: 0, outputTokens: 0 })).toBe(0)
  })

  it("default pricing table has expected models", () => {
    expect(DEFAULT_PRICING["anthropic/claude-sonnet-4-6"]).toBeDefined()
    expect(DEFAULT_PRICING["openai/gpt-4o"]).toBeDefined()
    expect(DEFAULT_PRICING["anthropic/claude-haiku-4-5"]).toBeDefined()
  })

  it("default fallback is Sonnet-level", () => {
    expect(DEFAULT_FALLBACK_PRICING.input).toBe(3.0)
    expect(DEFAULT_FALLBACK_PRICING.output).toBe(15.0)
  })
})
