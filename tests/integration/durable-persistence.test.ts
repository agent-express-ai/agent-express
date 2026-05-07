import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import { memoryStore } from "../../src/middleware/memory/store.js"
import type { LanguageModelV3, LanguageModelV3GenerateResult } from "@ai-sdk/provider"
import { sqliteStore } from "../../packages/session-sqlite/src/index.js"

function mockModel(text = "hello"): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "mock",
    modelId: "mock",
    supportedUrls: {},
    doGenerate: vi.fn(async (): Promise<LanguageModelV3GenerateResult> => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
      warnings: [],
    })),
    doStream: vi.fn(async () => { throw new Error("not implemented") }),
  }
}

describe("durable event persistence end-to-end", () => {
  it("emit → SessionStore.appendEvent → load returns the same events", async () => {
    const store = sqliteStore({ path: ":memory:" })
    const agent = new Agent({ name: "test", model: mockModel(), instructions: "test", defaults: false })
    agent.use(memoryStore({ backend: store }))
    await agent.init()

    const session = agent.session({ id: "durable-test" })
    await session.run("hello").result

    // Read the events directly from the adapter — exercising the full pipeline:
    // ctx.emit → EventLog.append → Writer.enqueue → SessionStore.appendEvent.
    const persisted = await store.listEvents("durable-test", { order: "asc" })
    const types = persisted.map((e) => e.type)
    expect(types).toContain("user:input")
    expect(types).toContain("model:response")
    expect(types).toContain("turn:end")

    // Same Event IDs surface in the in-memory log and the persisted store.
    const inMemoryIds = new Set(session.events.map((e) => e.id))
    const persistedIds = new Set(persisted.map((e) => e.eventId))
    expect(persistedIds).toEqual(inMemoryIds)

    await session.close()
    await agent.dispose()
  })

  it("session resume: events from a prior run replay into Session.events", async () => {
    const store = sqliteStore({ path: ":memory:" })
    const agent = new Agent({ name: "test", model: mockModel("first"), instructions: "test", defaults: false })
    agent.use(memoryStore({ backend: store }))
    await agent.init()

    // Run 1
    {
      const s = agent.session({ id: "resume-1" })
      await s.run("turn 1").result
      await s.close()
    }

    // Run 2 with the same session id — must see prior events on Session.events
    const s2 = agent.session({ id: "resume-1" })
    await new Promise((r) => setTimeout(r, 5)) // let session init complete
    const eventsBeforeNewTurn = s2.events.map((e) => e.type)
    expect(eventsBeforeNewTurn).toContain("user:input")
    expect(eventsBeforeNewTurn).toContain("model:response")

    // First user input should be from turn 1
    const firstUser = s2.events.find((e) => e.type === "user:input")!
    expect((firstUser.payload as { text: string }).text).toBe("turn 1")

    await s2.close()
    await agent.dispose()
  })

  it("re-emit of the same event is a no-op (idempotent on (sessionId, eventId))", async () => {
    const store = sqliteStore({ path: ":memory:" })

    const envelope = {
      sessionId: "idem-test",
      eventId: "fixed-id-1",
      ord: 0,
      ts: 1,
      type: "user:input",
      schemaVersion: 1,
      payload: { text: "x" },
    }
    await store.appendEvent("idem-test", envelope)
    await store.appendEvent("idem-test", envelope)

    const events = await store.listEvents("idem-test")
    expect(events).toHaveLength(1)
  })
})
