import type { Middleware } from "../../middleware.js"
import type { SearchResult, Tool } from "../../types.js"

/**
 * Configuration for the `search.web()` middleware.
 */
export interface SearchWebConfig {
  /** Search provider function — returns results for a query. */
  provider: (query: string) => Promise<SearchResult[]>
}

/**
 * Creates a `search.web()` middleware that registers a `web_search` tool.
 *
 * The model calls the tool when it needs information beyond the knowledge base.
 * Results are written to `state['search:web:results']` for source tracking.
 *
 * @param config - Search provider function
 * @returns Middleware
 *
 * @example
 * ```typescript
 * import { search } from "agent-express"
 * import { braveProvider } from "@agent-express/search-brave"
 *
 * agent.use(search.web({ provider: braveProvider({ apiKey }) }))
 * ```
 */
export function searchWeb(config: SearchWebConfig): Middleware {
  const { provider } = config

  const webSearchTool: Tool = {
    name: "web_search",
    description: "Search the web for current information. Use when the knowledge base doesn't have the answer, or when you need up-to-date information like pricing, news, or policies.",
    jsonSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query",
        },
      },
      required: ["query"],
    },
    execute: async (args) => {
      const query = (args as { query: string }).query
      let results: SearchResult[]
      try {
        results = await provider(query)
      } catch {
        return "Web search failed. Please try answering from your own knowledge."
      }

      if (results.length === 0) {
        return "No results found for this search query."
      }

      return results
        .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
        .join("\n---\n")
    },
  }

  return {
    name: "search:web",

    state: {
      "search:web:results": {
        default: [] as SearchResult[],
        reducer: (prev: unknown, delta: unknown) => [...(prev as SearchResult[]), ...(delta as SearchResult[])],
      },
    },

    agent(ctx, next) {
      ctx.registerTool(webSearchTool)
      return next()
    },

    async tool(ctx, next) {
      const result = await next()
      if (ctx.tool.name === "web_search") {
        try {
          const query = (ctx.args as { query: string }).query
          const results = await provider(query)
          ctx.state["search:web:results"] = results
        } catch {
          // Ignore tracking errors
        }
      }
      return result
    },
  }
}
