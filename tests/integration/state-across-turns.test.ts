import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
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
      usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } },
      warnings: [],
    })),
    doStream: vi.fn(async () => { throw new Error("not implemented") }),
  }
}

describe("Session state across turns", () => {
  it("state with reducer accumulates across model hook calls", async () => {
    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })

    agent.use({
      name: "cost-tracker",
      state: {
        totalCost: {
          default: 0,
          reducer: (prev: unknown, delta: unknown) => (prev as number) + (delta as number),
        },
        callCount: {
          default: 0,
          reducer: (prev: unknown, delta: unknown) => (prev as number) + (delta as number),
        },
      },
      model: async (ctx, next) => {
        const res = await next()
        ctx.state.totalCost = 0.001
        ctx.state.callCount = 1
        return res
      },
    })

    const result = await agent.run("test").result

    expect(result.state.totalCost).toBe(0.001)
    expect(result.state.callCount).toBe(1)
  })

  it("state without reducer uses last-write-wins", async () => {
    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })

    agent.use({
      name: "flag-setter",
      state: { status: { default: "idle" } },
      turn: async (ctx, next) => {
        ctx.state.status = "running"
        await next()
        // After-next writes happen after RunResult is captured,
        // so RunResult.state reflects the state at turn body completion
      },
    })

    const result = await agent.run("test").result
    expect(result.state.status).toBe("running")
  })

  it("multiple middleware can extend state independently", async () => {
    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })

    agent.use({
      name: "middleware-a",
      state: { counterA: { default: 0 } },
      turn: async (ctx, next) => {
        ctx.state.counterA = 42
        await next()
      },
    })

    agent.use({
      name: "middleware-b",
      state: { counterB: { default: 0 } },
      turn: async (ctx, next) => {
        ctx.state.counterB = 99
        await next()
      },
    })

    const result = await agent.run("test").result

    expect(result.state.counterA).toBe(42)
    expect(result.state.counterB).toBe(99)
  })

  it("RunResult.state contains snapshot at turn body completion", async () => {
    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })

    agent.use({
      name: "tracker",
      state: {
        items: { default: [] as string[] },
      },
      session: async (ctx, next) => {
        ;(ctx.state.items as string[]).push("session-start")
        await next()
        // "session-end" written after RunResult is captured
        ;(ctx.state.items as string[]).push("session-end")
      },
      turn: async (ctx, next) => {
        ;(ctx.state.items as string[]).push("turn")
        await next()
      },
    })

    const result = await agent.run("test").result

    // State snapshot is taken inside the turn body (innermost),
    // before turn and session after-next code runs
    expect(result.state.items).toEqual(["session-start", "turn"])
  })
})
