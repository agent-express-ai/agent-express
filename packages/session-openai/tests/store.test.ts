import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { openaiStore } from "../src/index.js"

const mockFetch = vi.fn()
beforeEach(() => { vi.stubGlobal("fetch", mockFetch) })
afterEach(() => { vi.restoreAllMocks() })

describe("openaiStore", () => {
  const apiKey = "sk-test-key"

  it("load() fetches conversation items and returns history", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { type: "message", role: "user", content: [{ text: "hello" }] },
          { type: "message", role: "assistant", content: [{ text: "hi there" }] },
          { type: "function_call", role: undefined, content: [] },
        ],
      }),
    })

    const store = openaiStore({ apiKey })
    const result = await store.load("conv-123")

    expect(result).not.toBeNull()
    expect(result!.history).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ])
    // State is empty (not persisted by OpenAI)
    expect(result!.state).toEqual({})

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/conversations/conv-123/items",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${apiKey}` }),
      }),
    )
  })

  it("load() returns null on 404", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
    const store = openaiStore({ apiKey })
    const result = await store.load("nonexistent")
    expect(result).toBeNull()
  })

  it("load() returns null on fetch error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"))
    const store = openaiStore({ apiKey })
    const result = await store.load("error-id")
    expect(result).toBeNull()
  })

  it("save() is a no-op (does not call fetch)", async () => {
    const store = openaiStore({ apiKey })
    await store.save("conv-123", {
      state: { foo: "bar" },
      history: [{ role: "user", content: "test" }],
      createdAt: 0,
      updatedAt: 0,
    })

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("delete() calls DELETE endpoint", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true })
    const store = openaiStore({ apiKey })
    await store.delete("conv-123")

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/conversations/conv-123",
      expect.objectContaining({ method: "DELETE" }),
    )
  })

  it("add() posts message to conversation", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true })
    const store = openaiStore({ apiKey })
    await store.add!("conv-123", { role: "user", content: "new message" })

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/conversations/conv-123/items",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "message",
          role: "user",
          content: [{ type: "text", text: "new message" }],
        }),
      }),
    )
  })

  it("add() serializes non-string content", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true })
    const store = openaiStore({ apiKey })
    const content = [{ type: "text", text: "hello" }]
    await store.add!("conv-123", { role: "user", content: content as unknown as string })

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string) as { content: Array<{ text: string }> }
    expect(body.content[0]!.text).toBe(JSON.stringify(content))
  })

  it("list() fetches and returns messages with pagination", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { type: "message", role: "user", content: [{ text: "msg1" }] },
          { type: "message", role: "assistant", content: [{ text: "msg2" }] },
          { type: "message", role: "user", content: [{ text: "msg3" }] },
        ],
      }),
    })

    const store = openaiStore({ apiKey })
    const result = await store.list!("conv-123", { order: "desc", limit: 2, offset: 0 })

    // desc reverses the array, limit 2 gives first two
    expect(result).toHaveLength(2)
    expect(result[0]!.content).toBe("msg3")
    expect(result[1]!.content).toBe("msg2")
  })

  it("list() returns empty array on fetch error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
    const store = openaiStore({ apiKey })
    const result = await store.list!("conv-123", {})
    expect(result).toEqual([])
  })

  it("throws if no API key is provided", () => {
    const original = process.env["OPENAI_API_KEY"]
    delete process.env["OPENAI_API_KEY"]
    try {
      expect(() => openaiStore()).toThrow("OpenAI API key required")
    } finally {
      if (original) process.env["OPENAI_API_KEY"] = original
    }
  })
})
