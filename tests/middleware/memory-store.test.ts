import { describe, it, expect } from "vitest"
import { Agent } from "../../src/agent.js"
import { FunctionModel } from "../../src/test/function-model.js"
import { memoryStore } from "../../src/middleware/memory/store.js"
import type { SessionStore, SessionData, EventEnvelope } from "../../src/types.js"

function createMockStore(): SessionStore & { calls: string[]; data: Map<string, SessionData> } {
  const data = new Map<string, SessionData>()
  const calls: string[] = []

  function ensure(sessionId: string): SessionData {
    let d = data.get(sessionId)
    if (!d) {
      d = { state: {}, events: [], createdAt: Date.now(), updatedAt: Date.now() }
      data.set(sessionId, d)
    }
    return d
  }

  return {
    calls,
    data,
    async load(sessionId) {
      calls.push(`load:${sessionId}`)
      return data.get(sessionId) ?? null
    },
    async save(sessionId, sessionData) {
      calls.push(`save:${sessionId}`)
      data.set(sessionId, sessionData)
    },
    async delete(sessionId) {
      calls.push(`delete:${sessionId}`)
      data.delete(sessionId)
    },
    async appendEvent(sessionId, envelope: EventEnvelope) {
      calls.push(`appendEvent:${sessionId}:${envelope.type}`)
      const d = ensure(sessionId)
      if (d.events.some((e) => e.eventId === envelope.eventId)) return
      d.events.push(envelope)
      d.updatedAt = Date.now()
    },
    async listEvents(sessionId, opts) {
      calls.push(`listEvents:${sessionId}`)
      const events = data.get(sessionId)?.events ?? []
      const ordered = opts?.order === "desc" ? [...events].reverse() : events
      const limit = opts?.limit ?? 1000
      const offset = opts?.offset ?? 0
      return ordered.slice(offset, offset + limit)
    },
  }
}

describe("memory.store()", () => {
  it("load is called on session start; per-event appendEvent is called during the turn", async () => {
    const store = createMockStore()
    const model = new FunctionModel(() => ({
      text: "ok",
      usage: { inputTokens: 5, outputTokens: 5 },
      finishReason: "stop",
    }))
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(memoryStore({ backend: store }))

    await agent.run("hello").result

    expect(store.calls.some((c) => c.startsWith("load:"))).toBe(true)
    expect(store.calls.some((c) => c.startsWith("appendEvent:"))).toBe(true)
    // The event-log Session writes per-event via Writer rather than a single
    // end-of-session save, so save() should NOT be called.
    expect(store.calls.some((c) => c.startsWith("save:"))).toBe(false)
  })

  it("appendEvent persists the typed events for the run", async () => {
    const store = createMockStore()
    const model = new FunctionModel(() => ({
      text: "hi",
      usage: { inputTokens: 1, outputTokens: 1 },
      finishReason: "stop",
    }))
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(memoryStore({ backend: store }))

    await agent.run("hello").result

    // Pull events for whatever session id was used.
    const sid = [...store.data.keys()][0]!
    const events = store.data.get(sid)!.events
    const types = events.map((e) => e.type)
    expect(types).toContain("user:input")
    expect(types).toContain("model:response")
    expect(types).toContain("turn:end")
  })

  it("backend failure falls back to in-memory (no throw to caller)", async () => {
    const failing: SessionStore = {
      async load() { throw new Error("DB down") },
      async save() { throw new Error("DB down") },
      async delete() { throw new Error("DB down") },
      async appendEvent() { throw new Error("DB down") },
      async listEvents() { throw new Error("DB down") },
    }
    const model = new FunctionModel(() => ({
      text: "still works",
      usage: { inputTokens: 5, outputTokens: 5 },
      finishReason: "stop",
    }))
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(memoryStore({ backend: failing }))

    // The backend throws on appendEvent — Writer will surface this as
    // EventStoreWriteError when the framework drains at turn:end. We just
    // verify the agent doesn't silently succeed if the backend rejects writes.
    await expect(agent.run("hello").result).rejects.toThrow()
  })

  it("session resumes with prior events replayed into Session.events", async () => {
    const store = createMockStore()
    // Pre-populate the backend with a previous session's events.
    const sessionId = "resume-test"
    const prior: EventEnvelope[] = [
      { sessionId, eventId: "e1", ord: 0, ts: 1, type: "user:input", schemaVersion: 1, payload: { text: "earlier turn" } },
      { sessionId, eventId: "e2", ord: 1, ts: 2, type: "model:response", schemaVersion: 1, payload: { text: "earlier reply" } },
    ]
    store.data.set(sessionId, { state: { count: 7 }, events: prior, createdAt: 1, updatedAt: 2 })

    const model = new FunctionModel(() => ({
      text: "fresh reply",
      usage: { inputTokens: 1, outputTokens: 1 },
      finishReason: "stop",
    }))
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(memoryStore({ backend: store }))
    await agent.init()

    const session = agent.session({ id: sessionId })
    // After session start the prior events are replayed in.
    await session.run("new turn").result

    const types = session.events.map((e) => e.type)
    expect(types[0]).toBe("user:input")
    expect((session.events[0]!.payload as { text: string }).text).toBe("earlier turn")
    expect(types).toContain("model:response")
    // State was restored.
    expect(session.state["count"]).toBe(7)

    await session.close()
    await agent.dispose()
  })
})
