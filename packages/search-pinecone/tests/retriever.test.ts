import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { pineconeRetriever } from "../src/index.js"

const mockFetch = vi.fn()
beforeEach(() => { vi.stubGlobal("fetch", mockFetch) })
afterEach(() => { vi.restoreAllMocks() })

const mockEmbed = vi.fn<(text: string) => Promise<number[]>>()

describe("pineconeRetriever", () => {
  beforeEach(() => {
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])
  })

  it("throws if no API key provided", () => {
    delete process.env["PINECONE_API_KEY"]
    expect(() => pineconeRetriever({
      indexHost: "https://my-index.pinecone.io",
      embed: mockEmbed,
    })).toThrow("Pinecone API key required")
  })

  it("calls correct URL (indexHost + /query)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ matches: [] }),
    })

    const retrieve = pineconeRetriever({
      apiKey: "pine-key",
      indexHost: "https://my-index-abc123.svc.pinecone.io",
      embed: mockEmbed,
    })
    await retrieve("test query")

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://my-index-abc123.svc.pinecone.io/query")
  })

  it("sends Api-Key header", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ matches: [] }),
    })

    const retrieve = pineconeRetriever({
      apiKey: "pine-secret",
      indexHost: "https://index.pinecone.io",
      embed: mockEmbed,
    })
    await retrieve("query")

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers["Api-Key"]).toBe("pine-secret")
  })

  it("sends vector in request body", async () => {
    mockEmbed.mockResolvedValueOnce([0.5, 0.6, 0.7])
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ matches: [] }),
    })

    const retrieve = pineconeRetriever({
      apiKey: "key",
      indexHost: "https://index.pinecone.io",
      embed: mockEmbed,
    })
    await retrieve("embed me")

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.vector).toEqual([0.5, 0.6, 0.7])
  })

  it("parses response into Chunk[]", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        matches: [
          { score: 0.95, metadata: { text: "Document content", source: "file.md" } },
          { score: 0.82, metadata: { content: "Another doc" } },
        ],
      }),
    })

    const retrieve = pineconeRetriever({
      apiKey: "key",
      indexHost: "https://index.pinecone.io",
      embed: mockEmbed,
    })
    const results = await retrieve("query")

    expect(results).toEqual([
      { text: "Document content", score: 0.95, source: { title: "file.md" } },
      { text: "Another doc", score: 0.82, source: undefined },
    ])
  })

  it("honors topK config", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ matches: [] }),
    })

    const retrieve = pineconeRetriever({
      apiKey: "key",
      indexHost: "https://index.pinecone.io",
      embed: mockEmbed,
      topK: 20,
    })
    await retrieve("query")

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.topK).toBe(20)
  })

  it("uses default topK of 5", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ matches: [] }),
    })

    const retrieve = pineconeRetriever({
      apiKey: "key",
      indexHost: "https://index.pinecone.io",
      embed: mockEmbed,
    })
    await retrieve("query")

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.topK).toBe(5)
  })

  it("includes namespace in body when configured", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ matches: [] }),
    })

    const retrieve = pineconeRetriever({
      apiKey: "key",
      indexHost: "https://index.pinecone.io",
      embed: mockEmbed,
      namespace: "production",
    })
    await retrieve("query")

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.namespace).toBe("production")
  })

  it("omits namespace from body when not configured", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ matches: [] }),
    })

    const retrieve = pineconeRetriever({
      apiKey: "key",
      indexHost: "https://index.pinecone.io",
      embed: mockEmbed,
    })
    await retrieve("query")

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.namespace).toBeUndefined()
  })

  it("throws with status code on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    })

    const retrieve = pineconeRetriever({
      apiKey: "key",
      indexHost: "https://index.pinecone.io",
      embed: mockEmbed,
    })
    await expect(retrieve("query")).rejects.toThrow("Pinecone query failed: 500")
  })
})
