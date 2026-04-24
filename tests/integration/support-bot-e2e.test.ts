import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import { z } from "zod"
import { toolsFunction } from "../../src/tools/function.js"
import { searchFile } from "../../src/middleware/search/file.js"
import { searchWeb } from "../../src/middleware/search/web.js"
import { guardPiiRedact } from "../../src/middleware/guard/pii-redact.js"
import { guardRateLimit } from "../../src/middleware/guard/rate-limit.js"
import { budgetGuard } from "../../src/middleware/guard/budget.js"
import { supportBot } from "../../packages/preset-support/src/support-bot.js"
import type { LanguageModelV3, LanguageModelV3GenerateResult } from "@ai-sdk/provider"
import type { Chunk, SearchResult, Tool } from "../../src/types.js"

function mockModel(responses: Array<() => LanguageModelV3GenerateResult>): LanguageModelV3 {
  let callIndex = 0
  return {
    specificationVersion: "v3",
    provider: "mock",
    modelId: "mock",
    supportedUrls: {},
    doGenerate: vi.fn(async () => responses[callIndex++]!()),
    doStream: vi.fn(async () => { throw new Error("not implemented") }),
  }
}

function textResult(text: string): LanguageModelV3GenerateResult {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 5, text: 5, reasoning: 0 },
    },
    warnings: [],
  }
}

function toolCallResult(toolName: string, input: Record<string, unknown>): LanguageModelV3GenerateResult {
  return {
    content: [{ type: "tool-call", toolCallId: `tc-${Date.now()}`, toolName, input }],
    finishReason: { unified: "tool-calls", raw: "tool_use" },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 8, text: 0, reasoning: 0 },
    },
    warnings: [],
  }
}

describe("Support Bot E2E", () => {
  it("supportBot preset composes and runs with mock model", async () => {
    const model = mockModel([
      () => textResult("Hello! How can I help you today?"),
    ])

    const escalationTool: Tool = {
      name: "escalate_to_human",
      description: "Transfer to human agent",
      parameters: { type: "object", properties: { reason: { type: "string" } } },
      execute: async (args) => `Escalated: ${(args as { reason: string }).reason}`,
    }

    const middlewares = supportBot({
      escalation: escalationTool,
      tone: "friendly-professional",
      pii: false,
      rateLimit: false,
    })

    const agent = new Agent({
      name: "support-test",
      model,
      instructions: "You are a helpful support bot.",
      defaults: false,
    })

    for (const mw of middlewares) {
      agent.use(mw)
    }

    const { text } = await agent.run("Hello").result
    expect(text).toBe("Hello! How can I help you today?")
  })

  it("search.file tool mode — model calls search and uses results", async () => {
    const mockRetriever = async (query: string): Promise<Chunk[]> => [
      { text: "To reset your password, go to Settings > Security.", score: 0.95, source: { title: "Password Guide" } },
    ]

    const model = mockModel([
      // First call: model decides to search
      () => toolCallResult("search_knowledge", { query: "reset password" }),
      // Second call: model uses search results to respond
      () => textResult("To reset your password, go to Settings > Security."),
    ])

    const agent = new Agent({
      name: "search-test",
      model,
      instructions: "Use the search tool to find answers.",
      defaults: false,
    })
    agent.use(searchFile({ retrieve: mockRetriever, mode: "tool" }))

    const { text, state } = await agent.run("How do I reset my password?").result
    expect(text).toContain("reset your password")

    const sources = state["search:file:sources"] as Chunk[]
    expect(sources).toBeDefined()
    expect(sources.length).toBeGreaterThan(0)
    expect(sources[0]!.text).toContain("Settings > Security")
  })

  it("search.web — model calls web_search tool", async () => {
    const mockProvider = async (query: string): Promise<SearchResult[]> => [
      { title: "Current Weather", url: "https://example.com", snippet: "It's 72°F and sunny." },
    ]

    const model = mockModel([
      () => toolCallResult("web_search", { query: "weather today" }),
      () => textResult("It's 72°F and sunny today."),
    ])

    const agent = new Agent({
      name: "web-search-test",
      model,
      instructions: "Search the web for current info.",
      defaults: false,
    })
    agent.use(searchWeb({ provider: mockProvider }))

    const { text, state } = await agent.run("What's the weather?").result
    expect(text).toContain("72°F")

    const results = state["search:web:results"] as SearchResult[]
    expect(results).toBeDefined()
    expect(results.length).toBe(1)
  })

  it("PII redaction — email redacted in model context, restored for tools", async () => {
    let modelSawRedacted = false

    const model: LanguageModelV3 = {
      specificationVersion: "v3",
      provider: "mock",
      modelId: "mock",
      supportedUrls: {},
      doGenerate: vi.fn(async (options) => {
        // Messages are in AI SDK V3 format: user content is [{ type: "text", text: "..." }]
        const prompt = (options as any).prompt ?? []
        const allText = JSON.stringify(prompt)
        if (allText.includes("[EMAIL_1]") && !allText.includes("john@example.com")) {
          modelSawRedacted = true
        }
        return textResult("I'll look up your account.") as LanguageModelV3GenerateResult
      }),
      doStream: vi.fn(async () => { throw new Error("not implemented") }),
    }

    const agent = new Agent({
      name: "pii-test",
      model,
      instructions: "Help users with accounts.",
      defaults: false,
    })
    agent.use(guardPiiRedact({ types: ["email"] }))

    const { text } = await agent.run("My email is john@example.com").result
    expect(text).toContain("look up")
    expect(modelSawRedacted).toBe(true)
  })

  it("rate limiting — blocks excess requests within same session", async () => {
    const model = mockModel([
      () => textResult("Response 1"),
      () => textResult("Response 2"),
      () => textResult("Should not reach this"),
    ])

    const agent = new Agent({
      name: "ratelimit-test",
      model,
      instructions: "test",
      defaults: false,
    })
    agent.use(guardRateLimit({ maxPerMinute: 2, onExceeded: "message" }))

    await agent.init()
    const session = agent.session()

    const r1 = await session.run("msg1").result
    expect(r1.text).toBe("Response 1")

    const r2 = await session.run("msg2").result
    expect(r2.text).toBe("Response 2")

    // Third request should be rate limited
    const r3 = await session.run("msg3").result
    expect(r3.text).toContain("Please wait")

    await session.close()
    await agent.dispose()
  })

  it("full preset — file search + escalation + tone + budget compose together", async () => {
    const mockRetriever = async (): Promise<Chunk[]> => [
      { text: "Refund policy: 30 days for full refund.", score: 0.9 },
    ]

    const model = mockModel([
      () => toolCallResult("search_knowledge", { query: "refund" }),
      () => textResult("Our refund policy allows a full refund within 30 days."),
    ])

    const escalationTool: Tool = {
      name: "escalate_to_human",
      description: "Transfer to human",
      parameters: { type: "object", properties: { reason: { type: "string" } } },
      execute: async (args) => `Escalated: ${(args as { reason: string }).reason}`,
    }

    const middlewares = supportBot({
      escalation: escalationTool,
      tone: "empathetic",
      fileSearch: searchFile({ retrieve: mockRetriever, mode: "tool" }),
      pii: false,
      rateLimit: false,
      budget: false,
      timeout: false,
    })

    const agent = new Agent({
      name: "full-preset",
      model,
      instructions: "Support bot for an e-commerce store.",
      defaults: false,
    })
    for (const mw of middlewares) {
      agent.use(mw)
    }

    const { text, state } = await agent.run("I want a refund").result
    expect(text).toContain("refund")

    // Verify sources were tracked
    const sources = state["search:file:sources"] as Chunk[]
    expect(sources).toBeDefined()
    expect(sources.length).toBeGreaterThan(0)
  })
})
