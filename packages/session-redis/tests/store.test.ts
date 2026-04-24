import { describe, it, expect, vi, beforeEach } from "vitest"

const mockExec = vi.fn().mockResolvedValue([])
const mockMulti = vi.fn(() => ({
  set: vi.fn().mockReturnThis(),
  del: vi.fn().mockReturnThis(),
  rpush: vi.fn().mockReturnThis(),
  expire: vi.fn().mockReturnThis(),
  exec: mockExec,
}))
const mockGet = vi.fn()
const mockSet = vi.fn()
const mockDel = vi.fn()
const mockRpush = vi.fn()
const mockLrange = vi.fn()
const mockExpire = vi.fn()

vi.mock("ioredis", () => ({
  default: class MockRedis {
    get = mockGet
    set = mockSet
    del = mockDel
    rpush = mockRpush
    lrange = mockLrange
    expire = mockExpire
    multi = mockMulti
  },
}))

import { redisStore } from "../src/index.js"

describe("redisStore", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockResolvedValue(null)
    mockLrange.mockResolvedValue([])
    mockRpush.mockResolvedValue(1)
    mockDel.mockResolvedValue(1)
  })

  it("load() returns null for unknown session", async () => {
    mockGet.mockResolvedValue(null)
    const store = redisStore({ url: "redis://localhost:6379" })
    const result = await store.load("unknown-id")
    expect(result).toBeNull()
  })

  it("save() + load() roundtrip preserves state and history", async () => {
    const store = redisStore({ url: "redis://localhost:6379" })

    const data = {
      state: { foo: "bar" },
      history: [
        { role: "user" as const, content: "hello" },
        { role: "assistant" as const, content: "hi" },
      ],
      createdAt: 1000,
      updatedAt: 2000,
    }

    await store.save("sess-1", data)

    // Verify multi was called for save
    expect(mockMulti).toHaveBeenCalled()
    expect(mockExec).toHaveBeenCalled()

    // Now simulate load
    mockGet.mockResolvedValue(JSON.stringify({ state: { foo: "bar" }, createdAt: 1000, updatedAt: 2000 }))
    mockLrange.mockResolvedValue([
      JSON.stringify({ role: "user", content: "hello" }),
      JSON.stringify({ role: "assistant", content: "hi" }),
    ])

    const loaded = await store.load("sess-1")
    expect(loaded).not.toBeNull()
    expect(loaded!.state).toEqual({ foo: "bar" })
    expect(loaded!.history).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ])
  })

  it("save() uses MULTI/EXEC for atomicity", async () => {
    const store = redisStore({ url: "redis://localhost:6379" })
    await store.save("sess-1", { state: {}, history: [], createdAt: 0, updatedAt: 0 })

    expect(mockMulti).toHaveBeenCalled()
    expect(mockExec).toHaveBeenCalled()
  })

  it("delete() removes session key and messages key", async () => {
    const store = redisStore({ url: "redis://localhost:6379" })
    await store.delete("sess-1")

    expect(mockDel).toHaveBeenCalledWith(
      "agent-express:session:sess-1",
      "agent-express:session:sess-1:messages",
    )
  })

  it("add() appends message via rpush", async () => {
    const store = redisStore({ url: "redis://localhost:6379" })
    await store.add!("sess-1", { role: "user", content: "test message" })

    expect(mockRpush).toHaveBeenCalledWith(
      "agent-express:session:sess-1:messages",
      JSON.stringify({ role: "user", content: "test message" }),
    )
  })

  it("list() with pagination: limit, offset, order", async () => {
    mockLrange.mockResolvedValue([
      JSON.stringify({ role: "user", content: "msg1" }),
      JSON.stringify({ role: "assistant", content: "msg2" }),
      JSON.stringify({ role: "user", content: "msg3" }),
      JSON.stringify({ role: "assistant", content: "msg4" }),
    ])

    const store = redisStore({ url: "redis://localhost:6379" })

    // Default order is desc
    const descResult = await store.list!("sess-1", { order: "desc", limit: 2, offset: 0 })
    expect(descResult).toHaveLength(2)
    // desc reverses the array, so first two items are msg4, msg3
    expect(descResult[0]!.content).toBe("msg4")
    expect(descResult[1]!.content).toBe("msg3")

    // Asc order
    const ascResult = await store.list!("sess-1", { order: "asc", limit: 2, offset: 1 })
    expect(ascResult).toHaveLength(2)
    expect(ascResult[0]!.content).toBe("msg2")
    expect(ascResult[1]!.content).toBe("msg3")
  })

  it("TTL set when configured", async () => {
    const store = redisStore({ url: "redis://localhost:6379", ttl: 3600 })

    await store.save("sess-ttl", {
      state: {},
      history: [{ role: "user", content: "hi" }],
      createdAt: 0,
      updatedAt: 0,
    })

    // The multi pipeline should include expire calls
    const pipeline = mockMulti.mock.results[0]!.value
    expect(pipeline.expire).toHaveBeenCalledWith("agent-express:session:sess-ttl", 3600)
    expect(pipeline.expire).toHaveBeenCalledWith("agent-express:session:sess-ttl:messages", 3600)
  })

  it("key prefix applied correctly", async () => {
    const store = redisStore({ url: "redis://localhost:6379", prefix: "myapp:" })
    await store.delete("sess-1")

    expect(mockDel).toHaveBeenCalledWith("myapp:sess-1", "myapp:sess-1:messages")
  })
})
