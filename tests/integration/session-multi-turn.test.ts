import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import { observeUsage } from "../../src/middleware/observe/usage.js"
import { observeTools } from "../../src/middleware/observe/tools.js"
import { budgetGuard } from "../../src/middleware/guard/budget.js"
import { toolsFunction } from "../../src/tools/function.js"
import { z } from "zod"
import type { LanguageModelV3, LanguageModelV3GenerateResult } from "@ai-sdk/provider"

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
    doStream: vi.fn(async () => { throw new Error("not implemented") }),
  }
}

describe("Session multi-turn with middleware", () => {
  it("observe.usage() accumulates across turns", async () => {
    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })
    agent.use(observeUsage())

    await agent.init()
    const session = agent.session()

    await session.run("turn 1").result
    await session.run("turn 2").result

    const usage = session.state["observe:usage"] as { inputTokens: number; outputTokens: number }
    expect(usage.inputTokens).toBe(20) // 10 + 10
    expect(usage.outputTokens).toBe(10) // 5 + 5

    await session.close()
    await agent.dispose()
  })

  it("guard.budget() tracks cost across turns", async () => {
    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })
    agent.use(budgetGuard({ limit: 10.0 }))

    await agent.init()
    const session = agent.session()

    await session.run("turn 1").result
    const cost1 = session.state["guard:budget:totalCost"] as number
    expect(cost1).toBeGreaterThan(0)

    await session.run("turn 2").result
    const cost2 = session.state["guard:budget:totalCost"] as number
    expect(cost2).toBeGreaterThan(cost1) // accumulated

    await session.close()
    await agent.dispose()
  })

  it("two sequential turns emit independent event sequences", async () => {
    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })
    await agent.init()
    const session = agent.session()

    const events1: import("../../src/types.js").Event[] = []
    for await (const event of session.run("turn 1")) {
      events1.push(event)
    }

    const events2: import("../../src/types.js").Event[] = []
    for await (const event of session.run("turn 2")) {
      events2.push(event)
    }

    expect(events1.map((e) => e.type)).toContain("turn:start")
    expect(events2.map((e) => e.type)).toContain("turn:start")

    const turn1Start = events1.find((e) => e.type === "turn:start")!
    const turn2Start = events2.find((e) => e.type === "turn:start")!
    expect((turn1Start.payload as { turnIndex: number }).turnIndex).toBe(0)
    expect((turn2Start.payload as { turnIndex: number }).turnIndex).toBe(1)

    await session.close()
    await agent.dispose()
  })
})
