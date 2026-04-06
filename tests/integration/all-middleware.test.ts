import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import { toolsFunction } from "../../src/tools/function.js"
import { budgetGuard } from "../../src/middleware/guard/budget.js"
import { inputGuard } from "../../src/middleware/guard/input.js"
import { outputGuard } from "../../src/middleware/guard/output.js"
import { observeLog } from "../../src/middleware/observe/log.js"
import { z } from "zod"
import type { LanguageModelV3, LanguageModelV3GenerateResult } from "@ai-sdk/provider"
import type { LogEvent } from "../../src/types.js"

describe("All middleware compose together", () => {
  it("budget + tools compose correctly", async () => {
    let callCount = 0
    const model: LanguageModelV3 = {
      specificationVersion: "v3", provider: "mock", modelId: "mock", supportedUrls: {},
      doGenerate: vi.fn(async (): Promise<LanguageModelV3GenerateResult> => {
        callCount++
        if (callCount === 1) {
          return { content: [{ type: "tool-call", toolCallId: "tc1", toolName: "add", input: { a: 1, b: 2 } }], finishReason: { unified: "tool-calls", raw: "tool_use" }, usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 0, reasoning: 0 } }, warnings: [] }
        }
        return { content: [{ type: "text", text: "3" }], finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 15, noCache: 15, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 8, text: 8, reasoning: 0 } }, warnings: [] }
      }),
      doStream: vi.fn(async () => { throw new Error("not implemented") }),
    }

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent
      .use(budgetGuard({ limit: 10.00 }))
      .use(toolsFunction({ name: "add", description: "Add", schema: z.object({ a: z.number(), b: z.number() }), execute: async ({ a, b }) => (a as number) + (b as number) }))

    const result = await agent.run("1+2").result
    expect(result.text).toBe("3")
    expect(result.state["guard:budget:totalCost"]).toBeGreaterThan(0)
  })

  it("input guard + output guard + tools compose correctly", async () => {
    let callCount = 0
    const model: LanguageModelV3 = {
      specificationVersion: "v3", provider: "mock", modelId: "mock", supportedUrls: {},
      doGenerate: vi.fn(async (): Promise<LanguageModelV3GenerateResult> => {
        callCount++
        if (callCount === 1) {
          return { content: [{ type: "tool-call", toolCallId: "tc1", toolName: "echo", input: { text: "hi" } }], finishReason: { unified: "tool-calls", raw: "tool_use" }, usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 0, reasoning: 0 } }, warnings: [] }
        }
        return { content: [{ type: "text", text: "echoed" }], finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } }, warnings: [] }
      }),
      doStream: vi.fn(async () => { throw new Error("not implemented") }),
    }

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent
      .use(inputGuard(() => ({ ok: true })))
      .use(outputGuard(() => ({ ok: true })))
      .use(toolsFunction({ name: "echo", description: "Echo", schema: z.object({ text: z.string() }), execute: async ({ text }) => text }))

    const result = await agent.run("test").result
    expect(result.text).toBe("echoed")
  })

  it("logging + tools compose with events captured", async () => {
    const logEvents: LogEvent[] = []

    const model: LanguageModelV3 = {
      specificationVersion: "v3", provider: "mock", modelId: "mock", supportedUrls: {},
      doGenerate: vi.fn(async (): Promise<LanguageModelV3GenerateResult> => ({
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } },
        warnings: [],
      })),
      doStream: vi.fn(async () => { throw new Error("not implemented") }),
    }

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(observeLog({ output: (e) => logEvents.push(e) }))

    const result = await agent.run("hi").result

    expect(result.text).toBe("ok")
    expect(logEvents.some((e) => e.type === "session:start")).toBe(true)
    expect(logEvents.some((e) => e.type === "model:call")).toBe(true)
  })
})
