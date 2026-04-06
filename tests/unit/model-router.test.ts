import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import { modelRouter } from "../../src/middleware/model/router.js"
import type { LanguageModelV3, LanguageModelV3GenerateResult } from "@ai-sdk/provider"

function createMockModel(text = "ok"): LanguageModelV3 {
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
    doStream: vi.fn(async () => { throw new Error("not implemented") }),
  }
}

describe("model.router()", () => {
  it("routes simple input to cheap model", async () => {
    let routedModel = ""
    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })

    agent.use(modelRouter({
      routes: { simple: "haiku", medium: "sonnet", complex: "opus" },
    }))
    agent.use({
      name: "model-spy",
      model: async (ctx, next) => {
        routedModel = ctx.model
        return next()
      },
    })

    await agent.run("hi").result // short, no tools → simple
    expect(routedModel).toBe("haiku")
  })

  it("routes complex input to expensive model", async () => {
    let routedModel = ""
    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })

    agent.use(modelRouter({
      routes: { simple: "haiku", medium: "sonnet", complex: "opus" },
    }))
    agent.use({
      name: "model-spy",
      model: async (ctx, next) => {
        routedModel = ctx.model
        return next()
      },
    })

    // Long input → complex
    await agent.run("a".repeat(10000)).result
    expect(routedModel).toBe("opus")
  })

  it("uses custom classifier", async () => {
    let routedModel = ""
    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })

    agent.use(modelRouter({
      routes: { simple: "haiku", medium: "sonnet", complex: "opus" },
      classify: () => "complex", // always complex
    }))
    agent.use({
      name: "model-spy",
      model: async (ctx, next) => {
        routedModel = ctx.model
        return next()
      },
    })

    await agent.run("hi").result
    expect(routedModel).toBe("opus")
  })

  it("uses custom token counter", async () => {
    let routedModel = ""
    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })

    agent.use(modelRouter({
      routes: { simple: "haiku", medium: "sonnet", complex: "opus" },
      tokenCounter: () => 9999, // always lots of tokens → complex
    }))
    agent.use({
      name: "model-spy",
      model: async (ctx, next) => {
        routedModel = ctx.model
        return next()
      },
    })

    await agent.run("hi").result
    expect(routedModel).toBe("opus")
  })
})
