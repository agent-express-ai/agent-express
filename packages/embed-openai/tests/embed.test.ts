import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { openaiEmbed } from "../src/index.js"

const mockFetch = vi.fn()
beforeEach(() => { vi.stubGlobal("fetch", mockFetch) })
afterEach(() => { vi.restoreAllMocks() })

describe("openaiEmbed", () => {
  const apiKey = "sk-test-key"

  function mockSuccess(embedding: number[]) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ embedding }] }),
    })
  }

  it("calls the correct OpenAI embeddings URL", async () => {
    mockSuccess([0.1, 0.2, 0.3])
    const embed = openaiEmbed({ apiKey })
    await embed("hello")

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.any(Object),
    )
  })

  it("sends Authorization header with Bearer token", async () => {
    mockSuccess([0.1])
    const embed = openaiEmbed({ apiKey })
    await embed("test")

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect((opts.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${apiKey}`)
  })

  it("uses default model text-embedding-3-small", async () => {
    mockSuccess([0.1])
    const embed = openaiEmbed({ apiKey })
    await embed("test")

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string) as { model: string }
    expect(body.model).toBe("text-embedding-3-small")
  })

  it("accepts custom model", async () => {
    mockSuccess([0.1])
    const embed = openaiEmbed({ apiKey, model: "text-embedding-3-large" })
    await embed("test")

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string) as { model: string }
    expect(body.model).toBe("text-embedding-3-large")
  })

  it("sends input text in request body", async () => {
    mockSuccess([0.5])
    const embed = openaiEmbed({ apiKey })
    await embed("hello world")

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string) as { input: string }
    expect(body.input).toBe("hello world")
  })

  it("parses response into number[] embedding vector", async () => {
    const vector = [0.1, 0.2, 0.3, 0.4, 0.5]
    mockSuccess(vector)
    const embed = openaiEmbed({ apiKey })
    const result = await embed("test")

    expect(result).toEqual(vector)
    expect(Array.isArray(result)).toBe(true)
    result.forEach(v => expect(typeof v).toBe("number"))
  })

  it("throws on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    })
    const embed = openaiEmbed({ apiKey })

    await expect(embed("test")).rejects.toThrow("OpenAI embedding failed: 401 Unauthorized")
  })

  it("includes AbortSignal timeout in fetch options", async () => {
    mockSuccess([0.1])
    const embed = openaiEmbed({ apiKey })
    await embed("test")

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(opts.signal).toBeInstanceOf(AbortSignal)
  })

  it("throws if no API key is provided", () => {
    const original = process.env["OPENAI_API_KEY"]
    delete process.env["OPENAI_API_KEY"]
    try {
      expect(() => openaiEmbed()).toThrow("OpenAI API key required")
    } finally {
      if (original) process.env["OPENAI_API_KEY"] = original
    }
  })
})
