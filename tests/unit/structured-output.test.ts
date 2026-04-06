import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import { z } from "zod"
import type { LanguageModelV3, LanguageModelV3GenerateResult, LanguageModelV3CallOptions } from "@ai-sdk/provider"

function createJsonModel(jsonText: string): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "mock",
    modelId: "mock",
    supportedUrls: {},
    doGenerate: vi.fn(async (opts: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> => ({
      content: [{ type: "text", text: jsonText }],
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

describe("Structured Output", () => {
  it("returns validated typed data in RunResult.data", async () => {
    const model = createJsonModel('{"name": "Alice", "age": 30}')
    const agent = new Agent({ name: "test", model, instructions: "Extract data.", defaults: false })

    const schema = z.object({ name: z.string(), age: z.number() })
    const result = await agent.run("Alice is 30", { output: schema }).result

    expect(result.data).toEqual({ name: "Alice", age: 30 })
  })

  it("calls model and parses structured output from text", async () => {
    const model = createJsonModel('{"value": 42}')
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })

    const schema = z.object({ value: z.number() })
    const result = await agent.run("test", { output: schema }).result

    // Verify doGenerate was called
    expect(model.doGenerate).toHaveBeenCalledTimes(1)
    // Verify structured data is parsed and validated from text response
    expect(result.data).toEqual({ value: 42 })
  })

  it("returns undefined data when no output schema", async () => {
    const model = createJsonModel("Just text")
    // Override to return normal text
    ;(model.doGenerate as any).mockImplementation(async () => ({
      content: [{ type: "text", text: "Just text" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 5, text: 5, reasoning: 0 },
      },
      warnings: [],
    }))

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    const result = await agent.run("hi").result

    expect(result.data).toBeUndefined()
    expect(result.text).toBe("Just text")
  })

  it("throws on invalid JSON when schema is set", async () => {
    const model = createJsonModel("not json at all")
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })

    const schema = z.object({ name: z.string() })
    await expect(agent.run("test", { output: schema }).result).rejects.toThrow()
  })

  it("throws on schema validation failure", async () => {
    const model = createJsonModel('{"name": 123}') // name should be string
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })

    const schema = z.object({ name: z.string() })
    await expect(agent.run("test", { output: schema }).result).rejects.toThrow()
  })
})
