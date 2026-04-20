/**
 * @agent-express/search-exa — Exa semantic search API adapter.
 * @module search-exa
 */
import type { SearchResult } from "agent-express"

export interface ExaProviderConfig {
  /** Exa API key. Default: process.env.EXA_API_KEY. */
  apiKey?: string
  /** Number of results. Default: 5. */
  numResults?: number
}

export function exaProvider(config?: ExaProviderConfig): (query: string) => Promise<SearchResult[]> {
  const apiKey = config?.apiKey ?? process.env["EXA_API_KEY"]
  if (!apiKey) throw new Error("Exa API key required. Set EXA_API_KEY or pass apiKey.")

  return async (query: string): Promise<SearchResult[]> => {
    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query, numResults: config?.numResults ?? 5, contents: { text: true } }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`Exa search failed: ${response.status}`)
    const data = await response.json() as { results: Array<{ title: string; url: string; text?: string }> }
    return (data.results ?? []).map(r => ({ title: r.title, url: r.url, snippet: r.text ?? "" }))
  }
}
