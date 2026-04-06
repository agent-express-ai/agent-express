import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import type { LanguageModelV3, LanguageModelV3GenerateResult } from "@ai-sdk/provider"
import type { StreamEvent } from "../../src/types.js"

function createMockModel(text = "Hello!"): LanguageModelV3 {
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

describe("Streaming events", () => {
  it("emits events in correct lifecycle order", async () => {
    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })

    const types: string[] = []
    for await (const event of agent.run("hello")) {
      types.push(event.type)
    }

    // Convenience run emits model-level events from the bus + session:end from complete()
    expect(types).toEqual([
      "model:start",
      "model:end",
      "session:end",
    ])
  })

  it("session:end contains RunResult with text and state", async () => {
    const agent = new Agent({ name: "test", model: createMockModel("world"), instructions: "test", defaults: false })

    const events: StreamEvent[] = []
    for await (const event of agent.run("hello")) {
      events.push(event)
    }

    const end = events.find((e) => e.type === "session:end")
    expect(end).toBeDefined()
    if (end?.type === "session:end") {
      expect(end.result.text).toBe("world")
      expect(end.result.state).toBeDefined()
    }
  })

  it("model:end contains finishReason", async () => {
    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })

    const events: StreamEvent[] = []
    for await (const event of agent.run("hello")) {
      events.push(event)
    }

    const modelEnd = events.find((e) => e.type === "model:end")
    expect(modelEnd).toBeDefined()
    if (modelEnd?.type === "model:end") {
      expect(modelEnd.finishReason).toBe("stop")
    }
  })

  it("result promise resolves with text and state", async () => {
    const agent = new Agent({ name: "test", model: createMockModel("world"), instructions: "test", defaults: false })

    const result = await agent.run("hello").result
    expect(result.text).toBe("world")
    expect(result.state).toBeDefined()
  })
})
