import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { exaProvider } from "../src/index.js"

const mockFetch = vi.fn()
beforeEach(() => { vi.stubGlobal("fetch", mockFetch) })
afterEach(() => { vi.restoreAllMocks() })

describe("exaProvider", () => {
  it("throws if no API key provided", () => {
    delete process.env["EXA_API_KEY"]
    expect(() => exaProvider()).toThrow("Exa API key required")
  })

  it("sends API key in x-api-key header", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    })

    const search = exaProvider({ apiKey: "exa-secret" })
    await search("test")

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers["x-api-key"]).toBe("exa-secret")
  })

  it("sends correct request body format", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    })

    const search = exaProvider({ apiKey: "key", numResults: 8 })
    await search("semantic search query")

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.exa.ai/search")
    expect(init.method).toBe("POST")

    const body = JSON.parse(init.body as string)
    expect(body.query).toBe("semantic search query")
    expect(body.numResults).toBe(8)
    expect(body.contents).toEqual({ text: true })
  })

  it("uses default numResults of 5", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    })

    const search = exaProvider({ apiKey: "key" })
    await search("test")

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.numResults).toBe(5)
  })

  it("parses response into SearchResult[]", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { title: "Doc 1", url: "https://doc1.com", text: "Some text content" },
          { title: "Doc 2", url: "https://doc2.com", text: undefined },
        ],
      }),
    })

    const search = exaProvider({ apiKey: "key" })
    const results = await search("query")

    expect(results).toEqual([
      { title: "Doc 1", url: "https://doc1.com", snippet: "Some text content" },
      { title: "Doc 2", url: "https://doc2.com", snippet: "" },
    ])
  })

  it("throws with status code on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
    })

    const search = exaProvider({ apiKey: "key" })
    await expect(search("test")).rejects.toThrow("Exa search failed: 403")
  })

  it("returns empty array when results is missing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    })

    const search = exaProvider({ apiKey: "key" })
    const results = await search("test")

    expect(results).toEqual([])
  })
})
