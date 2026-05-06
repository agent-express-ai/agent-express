import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import type { LanguageModelV3, LanguageModelV3GenerateResult } from "@ai-sdk/provider"
import { SessionClosedError, SessionBusyError } from "../../src/errors.js"

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

describe("Session API", () => {
  // US1: Multi-turn conversation
  describe("US1: Multi-turn", () => {
    it("accumulates history across two turns", async () => {
      const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })
      await agent.init()

      const session = agent.session()
      await session.run("Hello").result
      await session.run("Follow up").result

      expect(session.history).toHaveLength(4) // user, assistant, user, assistant
      expect(session.history[0]!.role).toBe("user")
      expect(session.history[0]!.content).toBe("Hello")
      expect(session.history[1]!.role).toBe("assistant")
      expect(session.history[2]!.role).toBe("user")
      expect(session.history[2]!.content).toBe("Follow up")
      expect(session.history[3]!.role).toBe("assistant")

      await session.close()
      await agent.dispose()
    })

    it("preserves state across turns", async () => {
      const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })
      agent.use({
        name: "counter",
        state: { count: { default: 0, reducer: (prev: unknown, delta: unknown) => (prev as number) + (delta as number) } },
        turn: async (ctx, next) => {
          await next()
          ctx.state.count = 1
        },
      })

      await agent.init()
      const session = agent.session()

      await session.run("turn 1").result
      expect(session.state.count).toBe(1)

      await session.run("turn 2").result
      expect(session.state.count).toBe(2) // accumulated!

      await session.close()
      await agent.dispose()
    })

    it("returns per-turn state snapshot in RunResult", async () => {
      const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })
      agent.use({
        name: "counter",
        state: { count: { default: 0, reducer: (prev: unknown, delta: unknown) => (prev as number) + (delta as number) } },
        turn: async (ctx, next) => {
          await next()
          ctx.state.count = 1
        },
      })

      await agent.init()
      const session = agent.session()

      const r1 = await session.run("turn 1").result
      expect(r1.state.count).toBe(1)

      const r2 = await session.run("turn 2").result
      expect(r2.state.count).toBe(2)

      await session.close()
      await agent.dispose()
    })

    it("session has unique id", async () => {
      const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })
      await agent.init()

      const s1 = agent.session()
      const s2 = agent.session()

      expect(s1.id).toBeTruthy()
      expect(s2.id).toBeTruthy()
      expect(s1.id).not.toBe(s2.id)

      await s1.close()
      await s2.close()
      await agent.dispose()
    })

    it("session accepts custom id", async () => {
      const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })
      await agent.init()

      const session = agent.session({ id: "custom-123" })
      expect(session.id).toBe("custom-123")

      await session.close()
      await agent.dispose()
    })
  })

  // US4: Session cleanup & resource management
  describe("US4: Cleanup", () => {
    it("session.close() triggers session middleware after-next", async () => {
      const order: string[] = []
      const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })
      agent.use({
        name: "tracker",
        session: async (_ctx, next) => {
          order.push("session-before")
          await next()
          order.push("session-after")
        },
      })

      await agent.init()
      const session = agent.session()

      // Wait a tick for session onion to start
      await new Promise(r => setTimeout(r, 10))
      expect(order).toContain("session-before")

      await session.close()
      expect(order).toContain("session-after")

      await agent.dispose()
    })

    it("session.close() is idempotent", async () => {
      const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })
      await agent.init()
      const session = agent.session()

      await session.close()
      await session.close() // should not throw

      await agent.dispose()
    })

    it("session.run() after close() throws SessionClosedError", async () => {
      const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })
      await agent.init()
      const session = agent.session()
      await session.close()

      expect(() => session.run("test")).toThrow(SessionClosedError)

      await agent.dispose()
    })

    it("Symbol.asyncDispose calls close()", async () => {
      const order: string[] = []
      const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })
      agent.use({
        name: "tracker",
        session: async (_ctx, next) => {
          order.push("start")
          await next()
          order.push("end")
        },
      })
      await agent.init()

      const session = agent.session()
      await new Promise(r => setTimeout(r, 10))
      await session[Symbol.asyncDispose]()

      expect(order).toContain("end")
      await agent.dispose()
    })

    it("concurrent session.run() throws SessionBusyError", async () => {
      // Create a slow model that takes time
      const slowModel: LanguageModelV3 = {
        specificationVersion: "v3",
        provider: "mock",
        modelId: "slow-mock",
        supportedUrls: {},
        doGenerate: vi.fn(async (): Promise<LanguageModelV3GenerateResult> => {
          await new Promise(r => setTimeout(r, 100))
          return {
            content: [{ type: "text", text: "slow" }],
            finishReason: { unified: "stop", raw: "stop" },
            usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
            warnings: [],
          }
        }),
        doStream: vi.fn(async () => { throw new Error("not implemented") }),
      }

      const agent = new Agent({ name: "test", model: slowModel, instructions: "test", defaults: false })
      await agent.init()
      const session = agent.session()

      // Start first run (don't await)
      session.run("first")

      // Immediately try second — should throw
      expect(() => session.run("second")).toThrow(SessionBusyError)

      // Wait for first to complete
      await new Promise(r => setTimeout(r, 200))
      await session.close()
      await agent.dispose()
    })
  })

  // US5: Streaming within sessions
  describe("US5: Streaming", () => {
    it("session.run() emits stream events", async () => {
      const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })
      await agent.init()
      const session = agent.session()

      const events: import("../../src/types.js").Event[] = []
      for await (const event of session.run("Hello")) {
        events.push(event)
      }

      const types = events.map(e => e.type)
      expect(types).toContain("turn:start")
      expect(types).toContain("model:start")
      expect(types).toContain("model:end")
      expect(types).toContain("turn:end")

      await session.close()
      await agent.dispose()
    })
  })
})
