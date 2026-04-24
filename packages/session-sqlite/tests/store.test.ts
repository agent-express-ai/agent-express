import { describe, it, expect } from "vitest"
import { sqliteStore } from "../src/index.js"

describe("sqliteStore", () => {
  it("returns SessionStore with all methods", () => {
    const store = sqliteStore({ path: ":memory:" })
    expect(store.load).toBeDefined()
    expect(store.save).toBeDefined()
    expect(store.delete).toBeDefined()
    expect(store.add).toBeDefined()
    expect(store.list).toBeDefined()
  })

  it("load returns null for unknown session", async () => {
    const store = sqliteStore({ path: ":memory:" })
    const result = await store.load("nonexistent")
    expect(result).toBeNull()
  })

  it("save + load roundtrip", async () => {
    const store = sqliteStore({ path: ":memory:" })
    const now = Date.now()
    await store.save("s1", {
      state: { count: 42, nested: { key: "value" } },
      history: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi!" },
      ],
      createdAt: now,
      updatedAt: now,
    })
    const loaded = await store.load("s1")
    expect(loaded).not.toBeNull()
    expect(loaded!.state["count"]).toBe(42)
    expect((loaded!.state["nested"] as any).key).toBe("value")
    expect(loaded!.history).toHaveLength(2)
    expect(loaded!.history[0]!.role).toBe("user")
    expect(loaded!.history[0]!.content).toBe("Hello")
    expect(loaded!.history[1]!.content).toBe("Hi!")
    expect(loaded!.createdAt).toBe(now)
    expect(loaded!.updatedAt).toBe(now)
  })

  it("save overwrites existing session", async () => {
    const store = sqliteStore({ path: ":memory:" })
    const now = Date.now()
    await store.save("s1", {
      state: { v: 1 },
      history: [{ role: "user", content: "First" }],
      createdAt: now,
      updatedAt: now,
    })
    await store.save("s1", {
      state: { v: 2 },
      history: [{ role: "user", content: "Second" }],
      createdAt: now,
      updatedAt: now + 1000,
    })
    const loaded = await store.load("s1")
    expect(loaded!.state["v"]).toBe(2)
    expect(loaded!.history).toHaveLength(1)
    expect(loaded!.history[0]!.content).toBe("Second")
  })

  it("delete removes session and messages", async () => {
    const store = sqliteStore({ path: ":memory:" })
    await store.save("s1", { state: {}, history: [], createdAt: 0, updatedAt: 0 })
    await store.add("s1", { role: "user", content: "msg" })
    await store.delete("s1")
    const loaded = await store.load("s1")
    expect(loaded).toBeNull()
    const msgs = await store.list("s1")
    expect(msgs).toHaveLength(0)
  })

  it("add appends messages", async () => {
    const store = sqliteStore({ path: ":memory:" })
    await store.add("s1", { role: "user", content: "First" })
    await store.add("s1", { role: "assistant", content: "Second" })
    await store.add("s1", { role: "user", content: "Third" })
    const msgs = await store.list("s1", { order: "asc" })
    expect(msgs).toHaveLength(3)
    expect(msgs[0]!.content).toBe("First")
    expect(msgs[1]!.content).toBe("Second")
    expect(msgs[2]!.content).toBe("Third")
  })

  it("add creates session if not exists", async () => {
    const store = sqliteStore({ path: ":memory:" })
    // add() to a nonexistent session should auto-create it
    await store.add("new-session", { role: "user", content: "Hello" })
    const msgs = await store.list("new-session", { order: "asc" })
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.content).toBe("Hello")
  })

  it("list with order desc returns newest first", async () => {
    const store = sqliteStore({ path: ":memory:" })
    await store.add("s1", { role: "user", content: "First" })
    await store.add("s1", { role: "user", content: "Second" })
    await store.add("s1", { role: "user", content: "Third" })
    const msgs = await store.list("s1", { order: "desc" })
    expect(msgs[0]!.content).toBe("Third")
    expect(msgs[2]!.content).toBe("First")
  })

  it("list with limit and offset", async () => {
    const store = sqliteStore({ path: ":memory:" })
    for (let i = 1; i <= 10; i++) {
      await store.add("s1", { role: "user", content: `msg-${i}` })
    }
    const page = await store.list("s1", { limit: 3, offset: 2, order: "asc" })
    expect(page).toHaveLength(3)
    expect(page[0]!.content).toBe("msg-3")
    expect(page[1]!.content).toBe("msg-4")
    expect(page[2]!.content).toBe("msg-5")
  })

  it("list defaults to desc order", async () => {
    const store = sqliteStore({ path: ":memory:" })
    await store.add("s1", { role: "user", content: "First" })
    await store.add("s1", { role: "user", content: "Last" })
    const msgs = await store.list("s1")
    expect(msgs[0]!.content).toBe("Last")
  })

  it("handles multi-part message content", async () => {
    const store = sqliteStore({ path: ":memory:" })
    const parts = [
      { type: "text" as const, text: "Hello" },
      { type: "tool-call" as const, toolCallId: "tc1", toolName: "greet", args: { name: "Alice" } },
    ]
    await store.add("s1", { role: "assistant", content: parts })
    const msgs = await store.list("s1", { order: "asc" })
    expect(msgs).toHaveLength(1)
    // Multi-part content is stored as JSON string
    const parsed = JSON.parse(msgs[0]!.content as string)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].text).toBe("Hello")
  })

  it("multiple independent sessions", async () => {
    const store = sqliteStore({ path: ":memory:" })
    await store.add("alice", { role: "user", content: "I'm Alice" })
    await store.add("bob", { role: "user", content: "I'm Bob" })

    const aliceMsgs = await store.list("alice", { order: "asc" })
    const bobMsgs = await store.list("bob", { order: "asc" })

    expect(aliceMsgs).toHaveLength(1)
    expect(aliceMsgs[0]!.content).toBe("I'm Alice")
    expect(bobMsgs).toHaveLength(1)
    expect(bobMsgs[0]!.content).toBe("I'm Bob")
  })

  it("delete cascades to messages", async () => {
    const store = sqliteStore({ path: ":memory:" })
    const now = Date.now()
    await store.save("s1", {
      state: { x: 1 },
      history: [{ role: "user", content: "saved" }],
      createdAt: now,
      updatedAt: now,
    })
    // Also add via add()
    await store.add("s1", { role: "assistant", content: "added" })

    // Delete and verify everything is gone
    await store.delete("s1")
    expect(await store.load("s1")).toBeNull()
    expect(await store.list("s1")).toHaveLength(0)
  })
})
