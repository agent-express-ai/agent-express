import { describe, it, expect, vi } from "vitest"
import { resolveModel } from "../../src/providers/resolve.js"

// Mock the test guard so ALLOW_REAL_REQUESTS doesn't block us
vi.mock("../../src/test/allow-real-requests.js", () => ({
  ALLOW_REAL_REQUESTS: true,
}))

describe("resolveModel — universal provider resolver", () => {
  it("resolves anthropic provider (backward compatibility)", async () => {
    const model = await resolveModel("anthropic/claude-sonnet-4-6")
    expect(model).toBeDefined()
    expect(model.modelId).toBe("claude-sonnet-4-6")
  })

  it("resolves openai provider (backward compatibility)", async () => {
    const model = await resolveModel("openai/gpt-4o")
    expect(model).toBeDefined()
    expect(model.modelId).toBe("gpt-4o")
  })

  it("throws actionable error when provider package is not installed", async () => {
    await expect(resolveModel("notinstalled/some-model")).rejects.toThrow(
      "Provider package @ai-sdk/notinstalled is not installed. Run: npm install @ai-sdk/notinstalled",
    )
  })

  it("throws clear error for invalid format (no /)", async () => {
    await expect(resolveModel("gpt-4o")).rejects.toThrow(
      'Invalid model identifier: "gpt-4o". Expected "provider/model-name" format',
    )
  })

  it("resolves provider by named export matching provider name", async () => {
    // Both anthropic and openai are resolved via named export (mod[provider])
    // This verifies the fallback chain: mod.default ?? mod[provider] ?? mod[providerKey]
    const anthropicModel = await resolveModel("anthropic/claude-haiku-4-5-20251001")
    expect(anthropicModel.modelId).toBe("claude-haiku-4-5-20251001")

    const openaiModel = await resolveModel("openai/gpt-4o-mini")
    expect(openaiModel.modelId).toBe("gpt-4o-mini")
  })

  it("throws error for invalid format (empty string)", async () => {
    await expect(resolveModel("")).rejects.toThrow(
      'Invalid model identifier: "". Expected "provider/model-name" format',
    )
  })
})
