import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { braveProvider } from "../src/index.js"

const mockFetch = vi.fn()
beforeEach(() => { vi.stubGlobal("fetch", mockFetch) })
afterEach(() => { vi.restoreAllMocks() })

describe("braveProvider", () => {
  it("throws if no API key provided", () => {
    delete process.env["BRAVE_API_KEY"]
    expect(() => braveProvider()).toThrow("Brave Search API key required")
  })

  it("calls correct URL with query parameter", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ web: { results: [] } }),
    })

    const search = braveProvider({ apiKey: "test-key" })
    await search("typescript generics")

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe("https://api.search.brave.com/res/v1/web/search")
    expect(parsed.searchParams.get("q")).toBe("typescript generics")
  })

  it("sends API key in X-Subscription-Token header", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ web: { results: [] } }),
    })

    const search = braveProvider({ apiKey: "my-brave-key" })
    await search("test")

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers["X-Subscription-Token"]).toBe("my-brave-key")
  })

  it("parses response into SearchResult[] with title, url, snippet", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        web: {
          results: [
            { title: "Result 1", url: "https://example.com/1", description: "First result" },
            { title: "Result 2", url: "https://example.com/2", description: "Second result" },
          ],
        },
      }),
    })

    const search = braveProvider({ apiKey: "key" })
    const results = await search("query")

    expect(results).toEqual([
      { title: "Result 1", url: "https://example.com/1", snippet: "First result" },
      { title: "Result 2", url: "https://example.com/2", snippet: "Second result" },
    ])
  })

  it("honors maxResults (count) config", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ web: { results: [] } }),
    })

    const search = braveProvider({ apiKey: "key", count: 10 })
    await search("test")

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    const parsed = new URL(url)
    expect(parsed.searchParams.get("count")).toBe("10")
  })

  it("uses default count of 5", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ web: { results: [] } }),
    })

    const search = braveProvider({ apiKey: "key" })
    await search("test")

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    const parsed = new URL(url)
    expect(parsed.searchParams.get("count")).toBe("5")
  })

  it("throws with status code on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    })

    const search = braveProvider({ apiKey: "key" })
    await expect(search("test")).rejects.toThrow("Brave Search failed: 429 Too Many Requests")
  })

  it("passes AbortSignal with timeout", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ web: { results: [] } }),
    })

    const search = braveProvider({ apiKey: "key" })
    await search("test")

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it("returns empty array when web.results is missing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    })

    const search = braveProvider({ apiKey: "key" })
    const results = await search("test")

    expect(results).toEqual([])
  })
})
