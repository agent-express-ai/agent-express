import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import type { LanguageModelV3, LanguageModelV3GenerateResult } from "@ai-sdk/provider"
import type { Middleware } from "../../src/middleware.js"

/** Creates a mock LanguageModelV3 that returns a fixed text response. */
function createMockModel(text = "response"): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "mock",
    modelId: "mock-model",
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
    doStream: vi.fn(async () => {
      throw new Error("not implemented")
    }),
  }
}

describe("Onion ordering with 3 middleware", () => {
  it("turn hooks execute A-before → B-before → C-before → core → C-after → B-after → A-after", async () => {
    const order: string[] = []

    const A: Middleware = {
      name: "A",
      turn: async (_ctx, next) => {
        order.push("A-before")
        await next()
        order.push("A-after")
      },
    }
    const B: Middleware = {
      name: "B",
      turn: async (_ctx, next) => {
        order.push("B-before")
        await next()
        order.push("B-after")
      },
    }
    const C: Middleware = {
      name: "C",
      turn: async (_ctx, next) => {
        order.push("C-before")
        await next()
        order.push("C-after")
      },
    }

    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })
    agent.use(A).use(B).use(C)

    await agent.run("test").result

    expect(order).toEqual([
      "A-before", "B-before", "C-before",
      "C-after", "B-after", "A-after",
    ])
  })

  it("model hooks wrap each LLM call in onion order", async () => {
    const order: string[] = []

    const A: Middleware = {
      name: "A",
      model: async (_ctx, next) => {
        order.push("A-model-before")
        const res = await next()
        order.push("A-model-after")
        return res
      },
    }
    const B: Middleware = {
      name: "B",
      model: async (_ctx, next) => {
        order.push("B-model-before")
        const res = await next()
        order.push("B-model-after")
        return res
      },
    }

    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })
    agent.use(A).use(B)

    await agent.run("test").result

    expect(order).toEqual([
      "A-model-before", "B-model-before",
      "B-model-after", "A-model-after",
    ])
  })

  it("session hook wraps the entire conversation", async () => {
    const order: string[] = []

    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })
    agent.use({
      name: "session-tracker",
      session: async (_ctx, next) => {
        order.push("session-start")
        await next()
        order.push("session-end")
      },
      turn: async (_ctx, next) => {
        order.push("turn")
        await next()
      },
    })

    await agent.run("test").result

    expect(order).toEqual(["session-start", "turn", "session-end"])
  })

  it("agent hook wraps session: before-next = init, after-next = dispose", async () => {
    const order: string[] = []

    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })
    agent.use({
      name: "lifecycle",
      agent: async (_ctx, next) => {
        order.push("agent-before")
        await next()
        order.push("agent-after")
      },
      session: async (_ctx, next) => {
        order.push("session")
        await next()
      },
    })

    await agent.run("test").result
    expect(order).toEqual(["agent-before", "session"])

    await agent.dispose()
    expect(order).toEqual(["agent-before", "session", "agent-after"])
  })

  it("all 5 hooks fire in correct lifecycle order", async () => {
    const order: string[] = []

    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })
    agent.use({
      name: "all-hooks",
      agent: async (_ctx, next) => {
        order.push("agent-before")
        await next()
        order.push("agent-after")
      },
      session: async (_ctx, next) => {
        order.push("session-before")
        await next()
        order.push("session-after")
      },
      turn: async (_ctx, next) => {
        order.push("turn-before")
        await next()
        order.push("turn-after")
      },
      model: async (_ctx, next) => {
        order.push("model-before")
        const res = await next()
        order.push("model-after")
        return res
      },
    })

    await agent.run("test").result
    await agent.dispose()

    expect(order).toEqual([
      "agent-before",
      "session-before",
      "turn-before",
      "model-before",
      "model-after",
      "turn-after",
      "session-after",
      "agent-after",
    ])
  })
})
