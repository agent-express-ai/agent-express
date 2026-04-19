import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import { FunctionModel } from "../../src/test/function-model.js"
import { memoryStore } from "../../src/middleware/memory/store.js"
import type { SessionStore, SessionData, Message } from "../../src/types.js"

function createMockStore(): SessionStore & { calls: string[] } {
  const data = new Map<string, SessionData>()
  const messages = new Map<string, Message[]>()
  const calls: string[] = []

  return {
    calls,
    async load(sessionId) {
      calls.push(`load:${sessionId}`)
      const d = data.get(sessionId)
      if (!d) return null
      return { ...d, history: [...(messages.get(sessionId) ?? []), ...d.history] }
    },
    async save(sessionId, sessionData) {
      calls.push(`save:${sessionId}`)
      data.set(sessionId, { ...sessionData, history: [] })
      messages.set(sessionId, [...sessionData.history])
    },
    async delete(sessionId) {
      calls.push(`delete:${sessionId}`)
      data.delete(sessionId)
      messages.delete(sessionId)
    },
    async add(sessionId, message) {
      calls.push(`add:${sessionId}`)
      const msgs = messages.get(sessionId) ?? []
      msgs.push(message)
      messages.set(sessionId, msgs)
    },
    async list(sessionId, opts) {
      calls.push(`list:${sessionId}`)
      let msgs = [...(messages.get(sessionId) ?? [])]
      if (opts?.order === "desc") msgs.reverse()
      const offset = opts?.offset ?? 0
      const limit = opts?.limit ?? 1000
      return msgs.slice(offset, offset + limit)
    },
  }
}

describe("memory.store()", () => {
  it("load/save/delete called correctly on mock SessionStore", async () => {
    const store = createMockStore()
    const middleware = memoryStore({ backend: store })

    const model = new FunctionModel(() => ({
      text: "ok",
      usage: { inputTokens: 5, outputTokens: 5 },
      finishReason: "stop",
    }))
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(middleware)

    await agent.run("hello").result

    expect(store.calls.some((c) => c.startsWith("load:"))).toBe(true)
    expect(store.calls.some((c) => c.startsWith("save:"))).toBe(true)
  })

  it("add() — appends single message", async () => {
    const store = createMockStore()
    await store.add("s1", { role: "user", content: "First" })
    await store.add("s1", { role: "assistant", content: "Second" })

    const msgs = await store.list("s1", { order: "asc" })
    expect(msgs).toHaveLength(2)
    expect(msgs[0]!.content).toBe("First")
    expect(msgs[1]!.content).toBe("Second")
  })

  it("list() — pagination with limit, offset, order", async () => {
    const store = createMockStore()
    for (let i = 1; i <= 10; i++) {
      await store.add("s2", { role: "user", content: `msg-${i}` })
    }

    const asc = await store.list("s2", { limit: 3, offset: 2, order: "asc" })
    expect(asc).toHaveLength(3)
    expect(asc[0]!.content).toBe("msg-3")

    const desc = await store.list("s2", { limit: 2, order: "desc" })
    expect(desc).toHaveLength(2)
    expect(desc[0]!.content).toBe("msg-10")
  })

  it("session resumes with full history on second load", async () => {
    const store = createMockStore()
    await store.save("s3", {
      state: { count: 1 },
      history: [{ role: "user", content: "Turn 1" }, { role: "assistant", content: "Response 1" }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const loaded = await store.load("s3")
    expect(loaded).not.toBeNull()
    expect(loaded!.history).toHaveLength(2)
    expect(loaded!.state["count"]).toBe(1)
  })

  it("backend failure falls back to in-memory", async () => {
    const failingStore: SessionStore = {
      async load() { throw new Error("DB down") },
      async save() { throw new Error("DB down") },
      async delete() { throw new Error("DB down") },
      async add() { throw new Error("DB down") },
      async list() { throw new Error("DB down") },
    }

    const middleware = memoryStore({ backend: failingStore })
    const model = new FunctionModel(() => ({
      text: "still works",
      usage: { inputTokens: 5, outputTokens: 5 },
      finishReason: "stop",
    }))
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(middleware)

    // Should not throw — falls back to in-memory
    const { text } = await agent.run("hello").result
    expect(text).toBe("still works")
  })

  it("delete removes session", async () => {
    const store = createMockStore()
    await store.save("s4", { state: {}, history: [], createdAt: "", updatedAt: "" })
    await store.delete("s4")
    const loaded = await store.load("s4")
    expect(loaded).toBeNull()
  })
})
