/**
 * @agent-express/search-brave
 *
 * Brave Search API adapter for agent-express web search middleware.
 * Brave Search leads benchmarks at $3/1K queries.
 *
 * @module search-brave
 */

import type { SearchResult } from "agent-express"

/**
 * Configuration for the Brave Search provider.
 */
export interface BraveProviderConfig {
  /** Brave Search API key. Default: process.env.BRAVE_API_KEY. */
  apiKey?: string
  /** Max results per search. Default: 5. */
  count?: number
}

/**
 * Creates a Brave Search provider function for `search.web()`.
 *
 * @param config - API key and options
 * @returns Provider function: `(query: string) => Promise<SearchResult[]>`
 *
 * @example
 * ```typescript
 * import { search } from "agent-express"
 * import { braveProvider } from "@agent-express/search-brave"
 *
 * agent.use(search.web({ provider: braveProvider({ apiKey: process.env.BRAVE_API_KEY }) }))
 * ```
 */
export function braveProvider(config?: BraveProviderConfig): (query: string) => Promise<SearchResult[]> {
  const apiKey = config?.apiKey ?? process.env["BRAVE_API_KEY"]
  const count = config?.count ?? 5

  if (!apiKey) {
    throw new Error(
      "Brave Search API key required. Set BRAVE_API_KEY environment variable or pass apiKey option.",
    )
  }

  return async (query: string): Promise<SearchResult[]> => {
    const url = new URL("https://api.search.brave.com/res/v1/web/search")
    url.searchParams.set("q", query)
    url.searchParams.set("count", String(count))

    const response = await fetch(url.toString(), {
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
    })

    if (!response.ok) {
      throw new Error(`Brave Search failed: ${response.status} ${response.statusText}`)
    }

    const data = await response.json() as {
      web?: { results?: Array<{ title: string; url: string; description: string }> }
    }

    return (data.web?.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }))
  }
}
