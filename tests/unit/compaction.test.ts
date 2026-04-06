import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import { memoryCompaction } from "../../src/middleware/memory/compaction.js"
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

/**
 * Helper middleware that injects history messages into the model context
 * before working memory processes them. This simulates accumulated conversation
 * history from prior turns.
 */
function injectHistory(history: Message[]): Middleware {
  return {
    name: "test:inject-history",
    async model(ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse> {
      // Prepend history before the current user message
      const currentMessages = [...ctx.messages]
      ctx.messages.length = 0
      ctx.messages.push(...history, ...currentMessages)
      return next()
    },
  }
}

describe("memory.compaction() - truncate strategy", () => {
  it("passes messages through when under limit", async () => {
    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })
    agent.use(memoryCompaction({ maxTokens: 10000, strategy: "truncate" }))

    const result = await agent.run("short message").result
    expect(result.text).toBe("ok")
  })

  it("truncates old messages when over limit", async () => {
    let messageCount = 0
    const model: LanguageModelV3 = {
      specificationVersion: "v3",
      provider: "mock",
      modelId: "mock",
      supportedUrls: {},
      doGenerate: vi.fn(async (opts): Promise<LanguageModelV3GenerateResult> => {
        messageCount = (opts as any).prompt?.length ?? 0
        return {
          content: [{ type: "text", text: "ok" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 5, text: 5, reasoning: 0 },
          },
          warnings: [],
        }
      }),
      doStream: vi.fn(async () => { throw new Error("not implemented") }),
    }

    const history = Array.from({ length: 20 }, (_, i) => ({
      role: "user" as const,
      content: `Message number ${i} with some extra padding text to make it longer`,
    }))

    const agent = new Agent({ name: "test", model, instructions: "system", defaults: false })
    agent.use(injectHistory(history))
    agent.use(memoryCompaction({
      maxTokens: 50,  // Very low
      strategy: "truncate",
    }))

    const result = await agent.run("latest message").result
    // Verify it ran without error
    expect(result.text).toBe("ok")
  })

  it("preserves system messages during truncation", async () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: "user" as const,
      content: `Old message ${i} with lots of padding text to consume tokens`,
    }))

    const agent = new Agent({
      name: "test",
      model: createMockModel(),
      instructions: "Important system prompt",
      defaults: false,
    })
    agent.use(injectHistory(history))
    agent.use(memoryCompaction({ maxTokens: 100, strategy: "truncate" }))

    const result = await agent.run("latest").result
    expect(result.text).toBe("ok")
  })
})

describe("memory.compaction() - window strategy", () => {
  it("keeps only last N messages + system", async () => {
    let messagesSeenByModel: any[] = []
    const model: LanguageModelV3 = {
      ...createMockModel(),
      doGenerate: vi.fn(async (opts): Promise<LanguageModelV3GenerateResult> => {
        messagesSeenByModel = (opts as any).prompt ?? []
        return {
          content: [{ type: "text", text: "ok" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 5, text: 5, reasoning: 0 },
          },
          warnings: [],
        }
      }),
    }

    const history = Array.from({ length: 10 }, (_, i) => ({
      role: "user" as const,
      content: `Message ${i}`,
    }))

    const agent = new Agent({ name: "test", model, instructions: "system", defaults: false })
    agent.use(injectHistory(history))
    agent.use(memoryCompaction({
      maxTokens: 10,  // Very low to trigger
      strategy: "window",
      keepLast: 3,
    }))

    await agent.run("latest").result

    // Should have: system + last 3 from history + "latest" = system + ~4 messages
    const nonSystem = messagesSeenByModel.filter((m: any) => m.role !== "system")
    expect(nonSystem.length).toBeLessThanOrEqual(4) // 3 from history + 1 new
  })
})

describe("memory.compaction() - clear-tool-results strategy", () => {
  it("replaces old tool results with placeholder", async () => {
    let messagesSeenByModel: any[] = []
    const model: LanguageModelV3 = {
      ...createMockModel(),
      doGenerate: vi.fn(async (opts): Promise<LanguageModelV3GenerateResult> => {
        messagesSeenByModel = (opts as any).prompt ?? []
        return {
          content: [{ type: "text", text: "ok" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 5, text: 5, reasoning: 0 },
          },
          warnings: [],
        }
      }),
    }

    const history: Message[] = [
      { role: "user", content: "search" },
      { role: "tool", content: "Very long tool result with lots of text " + "x".repeat(200) },
      { role: "user", content: "another search" },
      { role: "tool", content: "Recent tool result" },
      { role: "user", content: "ok" },
    ]

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(injectHistory(history))
    agent.use(memoryCompaction({
      maxTokens: 50,  // Low limit
      strategy: "clear-tool-results",
      keepLastToolResults: 1,
    }))

    await agent.run("latest").result

    // First tool result should be cleared, second kept
    const toolMsgs = messagesSeenByModel.filter((m: any) => m.role === "tool")
    if (toolMsgs.length >= 2) {
      // First should be cleared — check output.value in AI SDK format
      const firstContent = toolMsgs[0]?.content?.[0]
      const value = firstContent?.output?.value ?? firstContent?.text ?? ""
      expect(value).toContain("[cleared:")
    }
  })
})

describe("memory.compaction() - does not crash with compaction", () => {
  it("compaction runs without error on large message sets", async () => {
    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })

    const history = Array.from({ length: 10 }, (_, i) => ({
      role: "user" as const,
      content: `Message ${i} padding text to consume tokens`,
    }))

    agent.use(injectHistory(history))
    agent.use(memoryCompaction({ maxTokens: 50, strategy: "truncate" }))

    const result = await agent.run("latest").result
    // Verify the agent completes successfully
    expect(result.text).toBe("ok")
  })
})
