import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import { outputGuard } from "../../src/middleware/guard/output.js"
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

describe("guard.output()", () => {
  it("passes valid output through unchanged", async () => {
    const agent = new Agent({ name: "test", model: createMockModel("hello"), instructions: "test", defaults: false })
    agent.use(outputGuard(() => ({ ok: true })))

    const result = await agent.run("hi").result
    expect(result.text).toBe("hello")
  })

  it("modifies output text (redaction)", async () => {
    const agent = new Agent({
      name: "test",
      model: createMockModel("My SSN is 123-45-6789"),
      instructions: "test",
      defaults: false,
    })
    agent.use(outputGuard((response) => {
      if (response.text && /\d{3}-\d{2}-\d{4}/.test(response.text)) {
        return { ok: false, output: response.text.replace(/\d{3}-\d{2}-\d{4}/g, "[REDACTED]") }
      }
      return { ok: true }
    }))

    const result = await agent.run("tell me your SSN").result
    expect(result.text).toBe("My SSN is [REDACTED]")
  })

  it("blocks response entirely", async () => {
    const agent = new Agent({
      name: "test",
      model: createMockModel("toxic content here"),
      instructions: "test",
      defaults: false,
    })
    agent.use(outputGuard(() => ({
      ok: false,
      blocked: true,
      reason: "Content policy violation",
    })))

    const result = await agent.run("test").result
    expect(result.text).toBe("Content policy violation")
  })

  it("blocks tool calls from executing when response blocked", async () => {
    let callCount = 0
    const model: LanguageModelV3 = {
      specificationVersion: "v3",
      provider: "mock",
      modelId: "mock",
      supportedUrls: {},
      doGenerate: vi.fn(async (): Promise<LanguageModelV3GenerateResult> => {
        callCount++
        if (callCount === 1) {
          return {
            content: [{ type: "tool-call", toolCallId: "tc1", toolName: "danger", input: { target: "all_users" } }],
            finishReason: { unified: "tool-calls", raw: "tool_use" },
            usage: {
              inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 5, text: 5, reasoning: 0 },
            },
            warnings: [],
          }
        }
        return {
          content: [{ type: "text", text: "I blocked the dangerous action" }],
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

    const toolExecuted = vi.fn()
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })

    // Output guard blocks dangerous tool calls
    agent.use(outputGuard((response) => {
      if (response.toolCalls?.some((tc) => tc.toolName === "danger")) {
        return { blocked: true, reason: "Dangerous tool blocked" }
      }
      return { ok: true }
    }))

    agent.use({
      name: "danger-tool",
      tools: [{
        name: "danger",
        description: "dangerous",
        schema: {} as any,
        jsonSchema: {},
        execute: async () => { toolExecuted(); return "executed" },
      }],
    })

    const result = await agent.run("test").result

    // Tool was NOT executed because output guard blocked the tool-call response
    expect(toolExecuted).not.toHaveBeenCalled()
    // Output replaced with guard's block reason
    expect(result.text).toBe("Dangerous tool blocked")
  })

  it("supports async validators", async () => {
    const agent = new Agent({ name: "test", model: createMockModel("ok"), instructions: "test", defaults: false })
    agent.use(outputGuard(async () => {
      await new Promise((r) => setTimeout(r, 5))
      return { ok: true }
    }))

    const result = await agent.run("hi").result
    expect(result.text).toBe("ok")
  })
})
