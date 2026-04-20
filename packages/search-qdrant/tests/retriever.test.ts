import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { qdrantRetriever } from "../src/index.js"

const mockFetch = vi.fn()
beforeEach(() => { vi.stubGlobal("fetch", mockFetch) })
afterEach(() => { vi.restoreAllMocks() })

const mockEmbed = vi.fn<(text: string) => Promise<number[]>>()

describe("qdrantRetriever", () => {
  beforeEach(() => {
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])
  })

  it("calls correct URL (url + /collections/{collection}/points/search)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: [] }),
    })

    const retrieve = qdrantRetriever({
      url: "https://qdrant.example.com",
      collection: "my_docs",
      embed: mockEmbed,
    })
    await retrieve("test")

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://qdrant.example.com/collections/my_docs/points/search")
  })

  it("sends api-key header when API key is provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: [] }),
    })

    const retrieve = qdrantRetriever({
      url: "https://qdrant.cloud.example.com",
      collection: "docs",
      apiKey: "qdrant-secret",
      embed: mockEmbed,
    })
    await retrieve("query")

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers["api-key"]).toBe("qdrant-secret")
  })

  it("does not send api-key header when no API key", async () => {
    delete process.env["QDRANT_API_KEY"]
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: [] }),
    })

    const retrieve = qdrantRetriever({
      url: "http://localhost:6333",
      collection: "docs",
      embed: mockEmbed,
    })
    await retrieve("query")

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers["api-key"]).toBeUndefined()
  })

  it("sends vector in request body", async () => {
    mockEmbed.mockResolvedValueOnce([0.4, 0.5, 0.6])
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: [] }),
    })

    const retrieve = qdrantRetriever({
      url: "http://localhost:6333",
      collection: "docs",
      embed: mockEmbed,
    })
    await retrieve("embed this")

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.vector).toEqual([0.4, 0.5, 0.6])
  })

  it("sends limit (topK) and with_payload in body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: [] }),
    })

    const retrieve = qdrantRetriever({
      url: "http://localhost:6333",
      collection: "docs",
      embed: mockEmbed,
      topK: 15,
    })
    await retrieve("query")

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.limit).toBe(15)
    expect(body.with_payload).toBe(true)
  })

  it("parses response into Chunk[]", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: [
          { score: 0.99, payload: { text: "Hello world", source: "intro.md" } },
          { score: 0.85, payload: { content: "Fallback content" } },
        ],
      }),
    })

    const retrieve = qdrantRetriever({
      url: "http://localhost:6333",
      collection: "docs",
      embed: mockEmbed,
    })
    const results = await retrieve("query")

    expect(results).toEqual([
      { text: "Hello world", score: 0.99, source: { title: "intro.md" } },
      { text: "Fallback content", score: 0.85, source: undefined },
    ])
  })

  it("uses default URL of localhost:6333", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: [] }),
    })

    const retrieve = qdrantRetriever({
      collection: "my_collection",
      embed: mockEmbed,
    })
    await retrieve("query")

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://localhost:6333/collections/my_collection/points/search")
  })

  it("warns on non-localhost HTTP with API key", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    qdrantRetriever({
      url: "http://qdrant.remote.com",
      collection: "docs",
      apiKey: "secret",
      embed: mockEmbed,
    })

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("WARNING: API key is sent over plain HTTP"),
    )
    warnSpy.mockRestore()
  })

  it("does not warn for localhost HTTP with API key", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    qdrantRetriever({
      url: "http://localhost:6333",
      collection: "docs",
      apiKey: "secret",
      embed: mockEmbed,
    })

    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it("does not warn for HTTPS with API key", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    qdrantRetriever({
      url: "https://qdrant.cloud.example.com",
      collection: "docs",
      apiKey: "secret",
      embed: mockEmbed,
    })

    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it("throws with status code on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    })

    const retrieve = qdrantRetriever({
      url: "http://localhost:6333",
      collection: "missing",
      embed: mockEmbed,
    })
    await expect(retrieve("query")).rejects.toThrow("Qdrant search failed: 404")
  })
})
