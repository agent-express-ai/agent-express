import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cohereEmbed } from "../src/index.js"

const mockFetch = vi.fn()
beforeEach(() => { vi.stubGlobal("fetch", mockFetch) })
afterEach(() => { vi.restoreAllMocks() })

describe("cohereEmbed", () => {
  const apiKey = "cohere-test-key"

  function mockSuccess(embeddings: number[][]) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embeddings }),
    })
  }

  it("calls the correct Cohere embed URL", async () => {
    mockSuccess([[0.1, 0.2, 0.3]])
    const embed = cohereEmbed({ apiKey })
    await embed("hello")

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.cohere.ai/v1/embed",
      expect.any(Object),
    )
  })

  it("sends Authorization header with Bearer token", async () => {
    mockSuccess([[0.1]])
    const embed = cohereEmbed({ apiKey })
    await embed("test")

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect((opts.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${apiKey}`)
  })

  it("sends input text in request body as texts array", async () => {
    mockSuccess([[0.5]])
    const embed = cohereEmbed({ apiKey })
    await embed("hello world")

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string) as { texts: string[]; model: string; input_type: string }
    expect(body.texts).toEqual(["hello world"])
    expect(body.input_type).toBe("search_query")
  })

  it("uses default model embed-english-v3.0", async () => {
    mockSuccess([[0.1]])
    const embed = cohereEmbed({ apiKey })
    await embed("test")

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string) as { model: string }
    expect(body.model).toBe("embed-english-v3.0")
  })

  it("accepts custom model", async () => {
    mockSuccess([[0.1]])
    const embed = cohereEmbed({ apiKey, model: "embed-multilingual-v3.0" })
    await embed("test")

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string) as { model: string }
    expect(body.model).toBe("embed-multilingual-v3.0")
  })

  it("parses response into number[] embedding vector", async () => {
    const vector = [0.1, 0.2, 0.3, 0.4, 0.5]
    mockSuccess([vector])
    const embed = cohereEmbed({ apiKey })
    const result = await embed("test")

    expect(result).toEqual(vector)
    expect(Array.isArray(result)).toBe(true)
    result.forEach(v => expect(typeof v).toBe("number"))
  })

  it("throws on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    })
    const embed = cohereEmbed({ apiKey })

    await expect(embed("test")).rejects.toThrow("Cohere embedding failed: 429")
  })

  it("throws if no API key is provided", () => {
    const original = process.env["COHERE_API_KEY"]
    delete process.env["COHERE_API_KEY"]
    try {
      expect(() => cohereEmbed()).toThrow("Cohere API key required")
    } finally {
      if (original) process.env["COHERE_API_KEY"] = original
    }
  })
})
