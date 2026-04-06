import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import { AbortError } from "../../src/errors.js"
import { toolsFunction } from "../../src/tools/function.js"
import { z } from "zod"
import type { LanguageModelV3, LanguageModelV3GenerateResult } from "@ai-sdk/provider"

function createToolCallingModel(): LanguageModelV3 {
  let callCount = 0
  return {
    specificationVersion: "v3",
    provider: "mock",
    modelId: "mock",
    supportedUrls: {},
    doGenerate: vi.fn(async (): Promise<LanguageModelV3GenerateResult> => {
      callCount++
      if (callCount === 1) {
        return {
          content: [{ type: "tool-call", toolCallId: "tc1", toolName: "danger", input: {} }],
          finishReason: { unified: "tool-calls", raw: "tool_use" },
          usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } },
          warnings: [],
        }
      }
      return {
        content: [{ type: "text", text: "Denied." }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 15, noCache: 15, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } },
        warnings: [],
      }
    }),
    doStream: vi.fn(async () => { throw new Error("not implemented") }),
  }
}

function createMockModel(text = "ok"): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "mock",
    modelId: "mock",
    supportedUrls: {},
    doGenerate: vi.fn(async (): Promise<LanguageModelV3GenerateResult> => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } },
      warnings: [],
    })),
    doStream: vi.fn(async () => { throw new Error("not implemented") }),
  }
}

describe("Short-circuit mechanisms", () => {
  it("ctx.abort() throws AbortError and stops execution", async () => {
    const model = createMockModel()
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })

    agent.use({
      name: "blocker",
      turn: async (ctx, next) => {
        ctx.abort("blocked by policy")
        await next() // never reached
      },
    })

    await expect(agent.run("test").result).rejects.toThrow(AbortError)
    // Model should NOT have been called
    expect(model.doGenerate).not.toHaveBeenCalled()
  })

  it("ctx.abort() is catchable by outer middleware", async () => {
    const model = createMockModel("fallback")
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    let caught = false

    agent.use({
      name: "catcher",
      turn: async (_ctx, next) => {
        try {
          await next()
        } catch (err) {
          if (err instanceof AbortError) {
            caught = true
          }
          throw err
        }
      },
    })

    agent.use({
      name: "aborter",
      turn: async (ctx, _next) => {
        ctx.abort("inner abort")
      },
    })

    await expect(agent.run("test").result).rejects.toThrow(AbortError)
    expect(caught).toBe(true)
  })

  it("ctx.deny() returns error to model without executing tool", async () => {
    const model = createToolCallingModel()
    const executed = vi.fn()

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })

    agent.use({
      name: "denier",
      tool: async (ctx, next) => {
        if (ctx.tool.name === "danger") {
          ctx.deny("tool not allowed")
        }
        return next()
      },
    })

    agent.use(toolsFunction({
      name: "danger",
      description: "Dangerous tool",
      schema: z.object({}),
      execute: async () => {
        executed()
        return "executed!"
      },
    }))

    const result = await agent.run("test").result

    // Tool was NOT executed
    expect(executed).not.toHaveBeenCalled()
    // Model got a second call (after deny) and returned text
    expect(result.text).toBe("Denied.")
  })

  it("ctx.skipCall() in model hook bypasses LLM and returns cached response", async () => {
    const model = createMockModel("should not be called")
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })

    agent.use({
      name: "cache",
      model: async (ctx, next) => {
        // Skip the real LLM call, return synthetic response
        ctx.skipCall({
          text: "cached response",
          usage: { inputTokens: 0, outputTokens: 0 },
          finishReason: "stop",
        })
        return next()
      },
    })

    const result = await agent.run("test").result

    expect(result.text).toBe("cached response")
    // The real model was NOT called
    expect(model.doGenerate).not.toHaveBeenCalled()
  })

  it("errors in inner middleware propagate to outer middleware", async () => {
    const model = createMockModel()
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    const errors: string[] = []

    agent.use({
      name: "error-handler",
      turn: async (_ctx, next) => {
        try {
          await next()
        } catch (err) {
          errors.push((err as Error).message)
          throw err
        }
      },
    })

    agent.use({
      name: "thrower",
      model: async (_ctx, _next) => {
        throw new Error("model middleware failed")
      },
    })

    await expect(agent.run("test").result).rejects.toThrow("model middleware failed")
    expect(errors).toEqual(["model middleware failed"])
  })
})
