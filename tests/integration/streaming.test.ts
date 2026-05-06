import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import type { LanguageModelV3, LanguageModelV3GenerateResult } from "@ai-sdk/provider"
import type { Event } from "../../src/types.js"

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

    expect(types).toEqual([
      "turn:start",
      "user:input",
      "model:start",
      "model:end",
      "model:response",
      "turn:end",
    ])
  })

  it("turn:end carries text, status, and the rolled-up assistant output", async () => {
    const agent = new Agent({ name: "test", model: createMockModel("world"), instructions: "test", defaults: false })

    const events: Event[] = []
    for await (const event of agent.run("hello")) {
      events.push(event)
    }

    const turnEnd = events.find((e) => e.type === "turn:end")
    expect(turnEnd).toBeDefined()
    const payload = turnEnd!.payload as { text: string; status: string }
    expect(payload.text).toBe("world")
    expect(payload.status).toBe("completed")

    const modelResponse = events.find((e) => e.type === "model:response")
    expect((modelResponse!.payload as { text: string }).text).toBe("world")
  })

  it("model:end carries finishReason and full text", async () => {
    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })

    const events: Event[] = []
    for await (const event of agent.run("hello")) {
      events.push(event)
    }

    const modelEnd = events.find((e) => e.type === "model:end")
    expect(modelEnd).toBeDefined()
    const payload = modelEnd!.payload as { finishReason: string; text: string }
    expect(payload.finishReason).toBe("stop")
    expect(payload.text).toBe("Hello!")
  })

  it("result promise resolves with text and state", async () => {
    const agent = new Agent({ name: "test", model: createMockModel("world"), instructions: "test", defaults: false })

    const result = await agent.run("hello").result
    expect(result.text).toBe("world")
    expect(result.state).toBeDefined()
  })
})
