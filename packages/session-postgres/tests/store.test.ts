import { describe, it, expect, vi, beforeEach } from "vitest"

const mockQuery = vi.fn()
const mockClientQuery = vi.fn()
const mockRelease = vi.fn()
const mockConnect = vi.fn().mockResolvedValue({
  query: mockClientQuery,
  release: mockRelease,
})

vi.mock("pg", () => ({
  default: {
    Pool: class MockPool {
      query = mockQuery
      connect = mockConnect
    },
  },
}))

import { postgresStore } from "../src/index.js"

describe("postgresStore", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rows: [] })
    mockClientQuery.mockResolvedValue({ rows: [] })
  })

  it("load() returns null for unknown session", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const store = postgresStore({ connectionString: "postgres://localhost/test" })
    const result = await store.load("unknown-id")
    expect(result).toBeNull()
  })

  it("load() returns session data with history", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ state: '{"foo":"bar"}', created_at: 1000, updated_at: 2000 }],
      })
      .mockResolvedValueOnce({
        rows: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "hi" },
        ],
      })

    const store = postgresStore({ connectionString: "postgres://localhost/test" })
    const result = await store.load("sess-1")

    expect(result).not.toBeNull()
    expect(result!.state).toEqual({ foo: "bar" })
    expect(result!.history).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ])
    expect(result!.createdAt).toBe(1000)
    expect(result!.updatedAt).toBe(2000)
  })

  it("save() uses BEGIN/COMMIT transaction", async () => {
    const store = postgresStore({ connectionString: "postgres://localhost/test" })
    await store.save("sess-1", {
      state: { key: "value" },
      history: [{ role: "user", content: "hello" }],
      createdAt: 1000,
      updatedAt: 2000,
    })

    const calls = mockClientQuery.mock.calls.map(c => c[0] as string)
    expect(calls[0]).toBe("BEGIN")
    expect(calls[calls.length - 1]).toBe("COMMIT")
  })

  it("save() does ROLLBACK on error", async () => {
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce(new Error("insert failed")) // INSERT/UPSERT

    const store = postgresStore({ connectionString: "postgres://localhost/test" })
    await expect(
      store.save("sess-1", { state: {}, history: [], createdAt: 0, updatedAt: 0 }),
    ).rejects.toThrow("insert failed")

    const calls = mockClientQuery.mock.calls.map(c => c[0] as string)
    expect(calls).toContain("ROLLBACK")
    expect(mockRelease).toHaveBeenCalled()
  })

  it("delete() removes session and messages", async () => {
    const store = postgresStore({ connectionString: "postgres://localhost/test" })
    await store.delete("sess-1")

    const calls = mockQuery.mock.calls
    expect(calls.some(c => (c[0] as string).includes("DELETE FROM agent_messages") && (c[1] as string[])[0] === "sess-1")).toBe(true)
    expect(calls.some(c => (c[0] as string).includes("DELETE FROM agent_sessions") && (c[1] as string[])[0] === "sess-1")).toBe(true)
  })

  it("add() inserts message", async () => {
    const store = postgresStore({ connectionString: "postgres://localhost/test" })
    await store.add!("sess-1", { role: "user", content: "hello" })

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_messages"),
      ["sess-1", "user", "hello"],
    )
  })

  it("add() serializes non-string content to JSON", async () => {
    const store = postgresStore({ connectionString: "postgres://localhost/test" })
    const content = [{ type: "text", text: "hello" }]
    await store.add!("sess-1", { role: "user", content: content as unknown as string })

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_messages"),
      ["sess-1", "user", JSON.stringify(content)],
    )
  })

  it("list() with order, limit, offset", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { role: "assistant", content: "reply2" },
        { role: "assistant", content: "reply1" },
      ],
    })

    const store = postgresStore({ connectionString: "postgres://localhost/test" })
    const result = await store.list!("sess-1", { order: "desc", limit: 2, offset: 1 })

    expect(result).toHaveLength(2)
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain("DESC")
    expect(params).toContain(2) // limit
    expect(params).toContain(1) // offset
  })

  it("throws if no connection string provided", () => {
    const original = process.env["DATABASE_URL"]
    delete process.env["DATABASE_URL"]
    try {
      expect(() => postgresStore()).toThrow("PostgreSQL connection string required")
    } finally {
      if (original) process.env["DATABASE_URL"] = original
    }
  })
})
