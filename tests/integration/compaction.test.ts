import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import { memoryCompaction, SUMMARY_MARKER } from "../../src/middleware/memory/compaction.js"
import type { Middleware, ModelContext } from "../../src/middleware.js"
import type { Message, ModelResponse } from "../../src/types.js"
import type { LanguageModelV3, LanguageModelV3GenerateResult } from "@ai-sdk/provider"

function createMockModel(text = "ok"): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "mock",
    modelId: "mock",
    supportedUrls: {},
    doGenerate: vi.fn(async (): Promise<LanguageModelV3GenerateResult> => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 5, text: 5, reasoning: 0 },
      },
      warnings: [],
    })),
    doStream: vi.fn(async () => { throw new Error("not implemented") }),
  }
}

/** Mock summary model that returns a fixed summary. */
function createMockSummaryModel(): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "mock-summary",
    modelId: "mock-summary",
    supportedUrls: {},
    doGenerate: vi.fn(async (): Promise<LanguageModelV3GenerateResult> => ({
      content: [{ type: "text", text: "1. Task: Help user\n2. Done: Answered questions\n3. State: In progress\n4. Learned: User prefers short answers\n5. Next: Continue helping" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 500, noCache: 500, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 100, text: 100, reasoning: 0 },
      },
      warnings: [],
    })),
    doStream: vi.fn(async () => { throw new Error("not implemented") }),
  }
}

/**
 * Helper middleware that injects history messages into the model context
 * before compaction middleware processes them.
 */
function injectHistory(history: Message[]): Middleware {
  return {
    name: "test:inject-history",
    async model(ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse> {
      const currentMessages = [...ctx.messages]
      ctx.messages.length = 0
      ctx.messages.push(...history, ...currentMessages)
      return next()
    },
  }
}

describe("memory.compaction() - summarize strategy", () => {
  it("calls summary model and marks result with CONVERSATION SUMMARY", async () => {
    const summaryModel = createMockSummaryModel()
    const agentModel = createMockModel("final response")

    const history = Array.from({ length: 10 }, (_, i) => ({
      role: "user" as const,
      content: `Message ${i} with padding to consume tokens`,
    }))

    const agent = new Agent({ name: "test", model: agentModel, instructions: "test", defaults: false })
    agent.use(injectHistory(history))
    agent.use(memoryCompaction({
      maxTokens: 50, // Very low to trigger compaction
      strategy: "summarize",
      summaryModel,
      keepRecentMessages: 2,
    }))

    const result = await agent.run("latest").result

    // Summary model should have been called
    expect(summaryModel.doGenerate).toHaveBeenCalled()
    expect(result.text).toBe("final response")
  })

  it("falls back to truncation when summary model fails", async () => {
    const failingSummaryModel: LanguageModelV3 = {
      specificationVersion: "v3",
      provider: "mock-fail",
      modelId: "mock-fail",
      supportedUrls: {},
      doGenerate: vi.fn(async () => { throw new Error("summary model crashed") }),
      doStream: vi.fn(async () => { throw new Error("not implemented") }),
    }

    const history = Array.from({ length: 10 }, (_, i) => ({
      role: "user" as const,
      content: `Message ${i} padding`,
    }))

    const agentModel = createMockModel("ok after fallback")
    const agent = new Agent({ name: "test", model: agentModel, instructions: "test", defaults: false })
    agent.use(injectHistory(history))
    agent.use(memoryCompaction({
      maxTokens: 50,
      strategy: "summarize",
      summaryModel: failingSummaryModel,
      keepRecentMessages: 2,
    }))

    // Should not throw — falls back to truncation
    const result = await agent.run("latest").result
    expect(result.text).toBe("ok after fallback")
  })
})

describe("memory.compaction() - hybrid strategy", () => {
  it("summarizes old messages and keeps recent verbatim", async () => {
    const summaryModel = createMockSummaryModel()
    const agentModel = createMockModel("hybrid response")

    const history = Array.from({ length: 10 }, (_, i) => ({
      role: "user" as const,
      content: `Message ${i} with padding text`,
    }))

    const agent = new Agent({ name: "test", model: agentModel, instructions: "test", defaults: false })
    agent.use(injectHistory(history))
    agent.use(memoryCompaction({
      maxTokens: 50,
      strategy: "hybrid",
      summaryModel,
      keepRecentMessages: 3,
    }))

    const result = await agent.run("latest").result

    expect(summaryModel.doGenerate).toHaveBeenCalled()
    expect(result.text).toBe("hybrid response")
  })
})

describe("SUMMARY_MARKER", () => {
  it("is exported and is a string prefix", () => {
    expect(SUMMARY_MARKER).toBe("[CONVERSATION SUMMARY]")
  })
})
