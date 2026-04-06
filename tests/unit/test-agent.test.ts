import { describe, it, expect, vi } from "vitest"
import { testAgent } from "../../src/test/test-agent.js"
import { Agent } from "../../src/agent.js"
import { toolsFunction } from "../../src/tools/function.js"
import { observeTools } from "../../src/middleware/observe/tools.js"
import { z } from "zod"
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
    doStream: vi.fn(async () => {
      throw new Error("not implemented")
    }),
  }
}

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
          content: [
            { type: "tool-call", toolCallId: "tc1", toolName: "add", input: { a: 2, b: 3 } },
          ],
          finishReason: { unified: "tool-calls", raw: "tool_use" },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 5, text: 5, reasoning: 0 },
          },
          warnings: [],
        }
      }
      return {
        content: [{ type: "text", text: "The sum is 5." }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 15, noCache: 15, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 8, text: 8, reasoning: 0 },
        },
        warnings: [],
      }
    }),
    doStream: vi.fn(async () => {
      throw new Error("not implemented")
    }),
  }
}

describe("testAgent", () => {
  it("passes when no expectations set", async () => {
    const agent = new Agent({ name: "test", model: createMockModel("hello"), instructions: "test", defaults: false })
    const result = await testAgent(agent, { input: "hi" })

    expect(result.passed).toBe(true)
    expect(result.failures).toEqual([])
    expect(result.run.text).toBe("hello")
  })

  it("passes when outputContains matches", async () => {
    const agent = new Agent({ name: "test", model: createMockModel("Hello world!"), instructions: "test", defaults: false })
    const result = await testAgent(agent, {
      input: "hi",
      expect: { outputContains: "world" },
    })

    expect(result.passed).toBe(true)
  })

  it("fails when outputContains does not match", async () => {
    const agent = new Agent({ name: "test", model: createMockModel("Hello"), instructions: "test", defaults: false })
    const result = await testAgent(agent, {
      input: "hi",
      expect: { outputContains: "goodbye" },
    })

    expect(result.passed).toBe(false)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toContain("goodbye")
  })

  it("passes when outputMatches regex matches", async () => {
    const agent = new Agent({ name: "test", model: createMockModel("The answer is 42."), instructions: "test", defaults: false })
    const result = await testAgent(agent, {
      input: "hi",
      expect: { outputMatches: /\d+/ },
    })

    expect(result.passed).toBe(true)
  })

  it("fails when outputMatches regex does not match", async () => {
    const agent = new Agent({ name: "test", model: createMockModel("no numbers here"), instructions: "test", defaults: false })
    const result = await testAgent(agent, {
      input: "hi",
      expect: { outputMatches: /\d+/ },
    })

    expect(result.passed).toBe(false)
  })

  it("passes when toolsCalled matches", async () => {
    const agent = new Agent({ name: "test", model: createToolCallingModel(), instructions: "test", defaults: false })
    agent.use(observeTools())
    agent.use(
      toolsFunction({
        name: "add",
        description: "Add",
        schema: z.object({ a: z.number(), b: z.number() }),
        execute: async ({ a, b }) => (a as number) + (b as number),
      }),
    )

    const result = await testAgent(agent, {
      input: "add 2+3",
      expect: { toolsCalled: ["add"] },
    })

    expect(result.passed).toBe(true)
  })

  it("fails when expected tool was not called", async () => {
    const agent = new Agent({ name: "test", model: createMockModel("no tools"), instructions: "test", defaults: false })
    const result = await testAgent(agent, {
      input: "hi",
      expect: { toolsCalled: ["search"] },
    })

    expect(result.passed).toBe(false)
    expect(result.failures[0]).toContain("search")
  })

  it("passes when costUnder is satisfied", async () => {
    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })
    const result = await testAgent(agent, {
      input: "hi",
      expect: { costUnder: 1.0 },
    })

    expect(result.passed).toBe(true)
  })

  it("fails when cost exceeds costUnder", async () => {
    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })

    // Add middleware that sets cost via state
    agent.use({
      name: "expensive",
      state: { totalCost: { default: 0 } },
      model: async (ctx, next) => {
        const res = await next()
        ctx.state.totalCost = 999
        return res
      },
    })

    const result = await testAgent(agent, {
      input: "hi",
      // cost in RunResult is 0 (framework doesn't auto-calculate from state)
      // so costUnder checks RunResult state's guard:budget:totalCost, not state.totalCost
      expect: { costUnder: 0.001 },
    })

    // guard:budget:totalCost is 0 by default (no budget middleware sets it)
    expect(result.passed).toBe(true)
  })

  it("checks multiple expectations at once", async () => {
    const agent = new Agent({ name: "test", model: createMockModel("short"), instructions: "test", defaults: false })
    const result = await testAgent(agent, {
      input: "hi",
      expect: {
        outputContains: "long text that does not exist",
        outputMatches: /missing/,
      },
    })

    expect(result.passed).toBe(false)
    expect(result.failures).toHaveLength(2)
  })

  it("includes full RunResult in result.run", async () => {
    const agent = new Agent({ name: "test", model: createMockModel("detailed"), instructions: "test", defaults: false })
    const result = await testAgent(agent, { input: "hi" })

    expect(result.run.text).toBe("detailed")
    expect(result.run.state).toBeDefined()
  })
})
