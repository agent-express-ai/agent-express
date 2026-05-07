import { describe, it, expect, beforeEach } from "vitest"
import { sqliteStore } from "../src/index.js"
import type { EventEnvelope } from "agent-express"

function envelope(sessionId: string, eventId: string, ord: number, type = "user:input", payload: unknown = { text: "x" }): EventEnvelope {
  return { sessionId, eventId, ord, ts: Date.now(), type, schemaVersion: 1, payload }
}

describe("sqliteStore", () => {
  let store: ReturnType<typeof sqliteStore>

  beforeEach(() => {
    store = sqliteStore({ path: ":memory:" })
  })

  it("returns null for nonexistent session", async () => {
    expect(await store.load("missing")).toBeNull()
  })

  it("appendEvent stores an event recoverable via load", async () => {
    await store.appendEvent("s1", envelope("s1", "e1", 0, "user:input", { text: "hi" }))
    const loaded = await store.load("s1")
    expect(loaded).not.toBeNull()
    expect(loaded!.events).toHaveLength(1)
    expect(loaded!.events[0]!.eventId).toBe("e1")
    expect(loaded!.events[0]!.payload).toEqual({ text: "hi" })
  })

  it("appendEvent is idempotent on (sessionId, eventId)", async () => {
    await store.appendEvent("s2", envelope("s2", "e1", 0))
    await store.appendEvent("s2", envelope("s2", "e1", 0))
    const loaded = await store.load("s2")
    expect(loaded!.events).toHaveLength(1)
  })

  it("listEvents respects limit/offset/order", async () => {
    for (let i = 0; i < 5; i++) {
      await store.appendEvent("s3", envelope("s3", `e${i}`, i, "user:input", { text: `m${i}` }))
    }
    const asc = await store.listEvents("s3", { order: "asc", limit: 3 })
    expect(asc.map((e) => e.eventId)).toEqual(["e0", "e1", "e2"])
    const desc = await store.listEvents("s3", { order: "desc", limit: 2 })
    expect(desc.map((e) => e.eventId)).toEqual(["e4", "e3"])
    const offset = await store.listEvents("s3", { order: "asc", limit: 2, offset: 2 })
    expect(offset.map((e) => e.eventId)).toEqual(["e2", "e3"])
  })

  it("save inserts events idempotently and persists state", async () => {
    await store.save("s4", {
      state: { counter: 1 },
      events: [envelope("s4", "e1", 0), envelope("s4", "e2", 1)],
      createdAt: 100,
      updatedAt: 200,
    })
    let loaded = await store.load("s4")
    expect(loaded!.state).toEqual({ counter: 1 })
    expect(loaded!.events).toHaveLength(2)

    await store.save("s4", {
      state: { counter: 2 },
      events: [envelope("s4", "e2", 1), envelope("s4", "e3", 2)],
      createdAt: 100,
      updatedAt: 300,
    })
    loaded = await store.load("s4")
    expect(loaded!.state).toEqual({ counter: 2 })
    expect(loaded!.events.map((e) => e.eventId).sort()).toEqual(["e1", "e2", "e3"])
  })

  it("delete removes session and its events", async () => {
    await store.appendEvent("s5", envelope("s5", "e1", 0))
    await store.appendEvent("s5", envelope("s5", "e2", 1))
    await store.delete("s5")
    expect(await store.load("s5")).toBeNull()
    expect(await store.listEvents("s5")).toEqual([])
  })

  it("preserves unknown event types verbatim", async () => {
    await store.appendEvent("s6", envelope("s6", "e1", 0, "channel:slack:inbound", { channel: "C1", text: "hi" }))
    const loaded = await store.load("s6")
    expect(loaded!.events[0]!.type).toBe("channel:slack:inbound")
    expect(loaded!.events[0]!.payload).toEqual({ channel: "C1", text: "hi" })
  })
})
