import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import type { LanguageModelV3, LanguageModelV3GenerateResult } from "@ai-sdk/provider"
import type { StreamEvent } from "../../src/types.js"

/** Creates a mock LanguageModelV3 that returns a fixed text response. */
function createMockModel(text: string): LanguageModelV3 {
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
    doStream: vi.fn(async () => {
      throw new Error("streaming not implemented in mock")
    }),
  }
}

describe("Agent", () => {
  it("creates with name and model object", () => {
    const model = createMockModel("hello")
    const agent = new Agent({ name: "test", model, instructions: "You are helpful.", defaults: false })
    expect(agent.name).toBe("test")
  })

  it("supports chainable .use()", () => {
    const model = createMockModel("hello")
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    const returned = agent
      .use({ name: "a", turn: async (_ctx, next) => next() })
      .use({ name: "b", turn: async (_ctx, next) => next() })
    expect(returned).toBe(agent) // chainable — returns same instance
  })

  it("runs and returns RunResult via .result", async () => {
    const model = createMockModel("Hello, world!")
    const agent = new Agent({ name: "test", model, instructions: "You are a test agent.", defaults: false })

    const result = await agent.run("Hi").result

    expect(result.text).toBe("Hello, world!")
    expect(result.state).toBeDefined()
  })

  it("streams events via async iteration", async () => {
    const model = createMockModel("Streamed!")
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })

    const events: StreamEvent[] = []
    for await (const event of agent.run("stream")) {
      events.push(event)
    }

    const types = events.map((e) => e.type)
    // Core model-level events are always emitted via turnCtx.emit
    expect(types).toContain("model:start")
    expect(types).toContain("model:end")
    // session:end is emitted by AgentRun.complete()
    expect(types).toContain("session:end")
    // Verify correct event ordering
    const modelStart = types.indexOf("model:start")
    const modelEnd = types.indexOf("model:end")
    expect(modelStart).toBeLessThan(modelEnd)
  })

  it("agent hook runs once (init before next, dispose after next on dispose())", async () => {
    const model = createMockModel("test")
    const order: string[] = []

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use({
      name: "lifecycle",
      agent: async (_ctx, next) => {
        order.push("init")
        await next()
        order.push("dispose")
      },
    })

    await agent.run("first").result
    expect(order).toEqual(["init"])

    await agent.run("second").result
    expect(order).toEqual(["init"]) // NOT called again

    await agent.dispose()
    expect(order).toEqual(["init", "dispose"])
  })

  it("supports function shorthand as turn hook", async () => {
    const model = createMockModel("test")
    const order: string[] = []

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(async (_ctx, next) => {
      order.push("before")
      await next()
      order.push("after")
    })

    await agent.run("test").result
    expect(order).toEqual(["before", "after"])
  })

  it("accumulates state across middleware", async () => {
    const model = createMockModel("test")
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })

    agent.use({
      name: "counter",
      state: { count: { default: 0 } },
      turn: async (ctx, next) => {
        ctx.state.count = 1
        await next()
      },
    })

    const result = await agent.run("test").result
    expect(result.state.count).toBe(1)
  })

  it("state with reducer accumulates", async () => {
    const model = createMockModel("test")
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })

    agent.use({
      name: "cost-tracker",
      state: {
        totalCost: {
          default: 0,
          reducer: (prev: unknown, delta: unknown) => (prev as number) + (delta as number),
        },
      },
      model: async (ctx, next) => {
        const res = await next()
        ctx.state.totalCost = 0.003
        return res
      },
    })

    const result = await agent.run("test").result
    expect(result.state.totalCost).toBe(0.003)
  })

  it("throws clear error for invalid model string without provider", async () => {
    const agent = new Agent({ name: "test", model: "bad-model", instructions: "test", defaults: false })
    await expect(agent.run("test").result).rejects.toThrow("provider/model-name")
  })

  it(".use('model', fn) scope-specific shorthand", async () => {
    const model = createMockModel("test")
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    let modelCalled = false

    agent.use("model", async (_ctx, next) => {
      modelCalled = true
      return await next()
    })

    await agent.run("test").result
    expect(modelCalled).toBe(true)
  })

  it(".use('session', fn) scope-specific shorthand", async () => {
    const model = createMockModel("test")
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    const order: string[] = []

    agent.use("session", async (_ctx, next) => {
      order.push("session-before")
      await next()
      order.push("session-after")
    })

    await agent.run("test").result
    expect(order).toEqual(["session-before", "session-after"])
  })

  it(".use('agent', fn) scope-specific shorthand", async () => {
    const model = createMockModel("test")
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    const order: string[] = []

    agent.use("agent", async (_ctx, next) => {
      order.push("agent-init")
      await next()
      order.push("agent-cleanup")
    })

    await agent.run("test").result
    expect(order).toEqual(["agent-init"])

    await agent.dispose()
    expect(order).toEqual(["agent-init", "agent-cleanup"])
  })

  it("agent hook cleanup runs in LIFO order", async () => {
    const model = createMockModel("test")
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    const order: string[] = []

    agent.use({
      name: "A",
      agent: async (_ctx, next) => {
        order.push("A-init")
        await next()
        order.push("A-cleanup")
      },
    })
    agent.use({
      name: "B",
      agent: async (_ctx, next) => {
        order.push("B-init")
        await next()
        order.push("B-cleanup")
      },
    })

    await agent.run("test").result
    await agent.dispose()

    expect(order).toEqual(["A-init", "B-init", "B-cleanup", "A-cleanup"])
  })

  it("agent hook cleanup runs even when inner middleware throws (try/finally)", async () => {
    const model = createMockModel("test")
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    const cleanupCalled: string[] = []

    agent.use({
      name: "outer",
      agent: async (_ctx, next) => {
        try {
          await next()
        } finally {
          cleanupCalled.push("outer")
        }
      },
    })
    agent.use({
      name: "thrower",
      agent: async (_ctx, _next) => {
        throw new Error("init failed")
      },
    })

    await expect(agent.run("test").result).rejects.toThrow("init failed")
    expect(cleanupCalled).toEqual(["outer"])
  })
})
