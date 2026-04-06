import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import { inputGuard } from "../../src/middleware/guard/input.js"
import { InputGuardrailError } from "../../src/middleware/guard/input.js"
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

describe("guard.input()", () => {
  it("allows valid input through", async () => {
    const model = createMockModel("hello")
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(inputGuard(() => ({ ok: true })))

    const result = await agent.run("hi").result
    expect(result.text).toBe("hello")
  })

  it("blocks invalid input with abort", async () => {
    const model = createMockModel()
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(inputGuard(() => ({ ok: false, reason: "blocked" })))

    await expect(agent.run("bad").result).rejects.toThrow(InputGuardrailError)
    expect(model.doGenerate).not.toHaveBeenCalled()
  })

  it("modifies messages when validator provides them", async () => {
    const model = createMockModel("modified response")
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(inputGuard((ctx) => ({
      ok: true,
      messages: [{ role: "user", content: "sanitized input" }],
    })))

    const result = await agent.run("original input").result
    expect(result.text).toBe("modified response")
  })

  it("supports async validators", async () => {
    const model = createMockModel("ok")
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(inputGuard(async () => {
      await new Promise((r) => setTimeout(r, 5))
      return { ok: true }
    }))

    const result = await agent.run("hi").result
    expect(result.text).toBe("ok")
  })

  it("multiple guards run in order, first failure stops", async () => {
    const model = createMockModel()
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })

    const guard1Called = vi.fn(() => ({ ok: true }))
    const guard2Called = vi.fn(() => ({ ok: false, reason: "guard2 blocked" }))
    const guard3Called = vi.fn(() => ({ ok: true }))

    agent.use(inputGuard(guard1Called))
    agent.use(inputGuard(guard2Called))
    agent.use(inputGuard(guard3Called))

    await expect(agent.run("test").result).rejects.toThrow("guard2 blocked")
    expect(guard1Called).toHaveBeenCalled()
    expect(guard2Called).toHaveBeenCalled()
    expect(guard3Called).not.toHaveBeenCalled()
  })
})
