import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { tavilyProvider } from "../src/index.js"

const mockFetch = vi.fn()
beforeEach(() => { vi.stubGlobal("fetch", mockFetch) })
afterEach(() => { vi.restoreAllMocks() })

describe("tavilyProvider", () => {
  it("throws if no API key provided", () => {
    delete process.env["TAVILY_API_KEY"]
    expect(() => tavilyProvider()).toThrow("Tavily API key required")
  })

  it("sends API key in request body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    })

    const search = tavilyProvider({ apiKey: "tavily-key" })
    await search("test query")

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.api_key).toBe("tavily-key")
  })

  it("sends query and max_results in body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    })

    const search = tavilyProvider({ apiKey: "key", maxResults: 10 })
    await search("AI agents")

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.query).toBe("AI agents")
    expect(body.max_results).toBe(10)
  })

  it("uses default maxResults of 5", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    })

    const search = tavilyProvider({ apiKey: "key" })
    await search("test")

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.max_results).toBe(5)
  })

  it("calls correct URL with POST method", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    })

    const search = tavilyProvider({ apiKey: "key" })
    await search("test")

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.tavily.com/search")
    expect(init.method).toBe("POST")
  })

  it("parses response correctly", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { title: "Page A", url: "https://a.com", content: "Content of A" },
          { title: "Page B", url: "https://b.com", content: "Content of B" },
        ],
      }),
    })

    const search = tavilyProvider({ apiKey: "key" })
    const results = await search("query")

    expect(results).toEqual([
      { title: "Page A", url: "https://a.com", snippet: "Content of A" },
      { title: "Page B", url: "https://b.com", snippet: "Content of B" },
    ])
  })

  it("throws with status code on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
    })

    const search = tavilyProvider({ apiKey: "key" })
    await expect(search("test")).rejects.toThrow("Tavily search failed: 401")
  })

  it("returns empty array when results is missing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    })

    const search = tavilyProvider({ apiKey: "key" })
    const results = await search("test")

    expect(results).toEqual([])
  })
})
