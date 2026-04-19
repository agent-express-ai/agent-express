/**
 * @agent-express/search-tavily — Tavily Search API adapter.
 * @module search-tavily
 */
import type { SearchResult } from "agent-express"

export interface TavilyProviderConfig {
  /** Tavily API key. Default: process.env.TAVILY_API_KEY. */
  apiKey?: string
  /** Max results. Default: 5. */
  maxResults?: number
}

export function tavilyProvider(config?: TavilyProviderConfig): (query: string) => Promise<SearchResult[]> {
  const apiKey = config?.apiKey ?? process.env["TAVILY_API_KEY"]
  if (!apiKey) throw new Error("Tavily API key required. Set TAVILY_API_KEY or pass apiKey.")

  return async (query: string): Promise<SearchResult[]> => {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, query, max_results: config?.maxResults ?? 5 }),
    })
    if (!response.ok) throw new Error(`Tavily search failed: ${response.status}`)
    const data = await response.json() as { results: Array<{ title: string; url: string; content: string }> }
    return (data.results ?? []).map(r => ({ title: r.title, url: r.url, snippet: r.content }))
  }
}
