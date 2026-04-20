import type { Middleware, ModelContext } from "../../middleware.js"
import type { Chunk, ModelResponse, Tool } from "../../types.js"

/**
 * Configuration for the `search.file()` middleware.
 */
export interface SearchFileConfig {
  /** Retriever function — returns relevant chunks for a query. */
  retrieve: (query: string) => Promise<Chunk[]>
  /**
   * Retrieval mode.
   * - `"tool"` (default): registers a `search_knowledge` tool, model decides when to search.
   * - `"auto"`: retrieves every turn using the latest user message.
   */
  mode?: "tool" | "auto"
  /** Maximum chunks to inject into context. Default: 5. */
  topK?: number
  /** Custom query rewrite function (auto mode only). */
  rewriteQuery?: (message: string, history: import("../../types.js").Message[]) => string
}

/**
 * Creates a `search.file()` middleware for document/knowledge base search.
 *
 * Two modes:
 * - `"tool"` (default): registers `search_knowledge` tool — model decides when to search.
 * - `"auto"`: retrieves every turn using latest user message.
 *
 * Retrieved chunks are injected into the model context and tracked in
 * `state['search:file:sources']`.
 *
 * @param config - Retriever function and options
 * @returns Middleware
 *
 * @example
 * ```typescript
 * import { search } from "agent-express"
 * import { chromaRetriever } from "@agent-express/search-llamaindex"
 *
 * agent.use(search.file({
 *   retrieve: chromaRetriever({ sources: ["./docs"], embed: openaiEmbed() }),
 * }))
 * ```
 */
export function searchFile(config: SearchFileConfig): Middleware {
  const { retrieve, mode = "tool", topK = 5, rewriteQuery } = config

  /** Format chunks as a system message for model context. */
  function formatChunks(chunks: Chunk[]): string {
    if (chunks.length === 0) return ""
    const formatted = chunks
      .map((c, i) => {
        const source = c.source
          ? ` (source: ${c.source.title ?? c.source.url ?? "unknown"})`
          : ""
        return `[${i + 1}]${source}\n${c.text}`
      })
      .join("\n---\n")
    return `Relevant knowledge:\n---\n${formatted}\n---`
  }

  /** Perform retrieval and inject chunks. */
  async function retrieveAndInject(
    query: string,
    ctx: ModelContext,
  ): Promise<Chunk[]> {
    let chunks: Chunk[]
    try {
      chunks = await retrieve(query)
    } catch {
      // Graceful degradation — log error, proceed without augmentation
      return []
    }

    // Apply topK
    const selected = chunks
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, topK)

    // Inject into model context
    const formatted = formatChunks(selected)
    if (formatted) {
      ctx.addSystemMessage(formatted)
    }

    return selected
  }

  if (mode === "tool") {
    // Cache last retrieval results to avoid double API calls.
    // The execute function stores results here; the tool hook reads them.
    let lastRetrievedChunks: Chunk[] = []

    // Tool mode: register search_knowledge tool, model calls it
    const searchTool: Tool = {
      name: "search_knowledge",
      description: "Search the knowledge base for information relevant to the user's question. Use this when you need specific information from company docs, help articles, or FAQs.",
      jsonSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query to find relevant information",
          },
        },
        required: ["query"],
      },
      execute: async (args) => {
        const query = (args as { query: string }).query
        const chunks = await retrieve(query)
        const selected = chunks
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
          .slice(0, topK)
        // Cache for the tool hook to reuse
        lastRetrievedChunks = selected
        // Return formatted results as tool output
        return selected
          .map((c, i) => {
            const source = c.source?.title ?? c.source?.url ?? ""
            return `[${i + 1}] ${source}\n${c.text}`
          })
          .join("\n---\n") || "No relevant information found."
      },
    }

    return {
      name: "search:file",

      state: {
        "search:file:sources": {
          default: [] as Chunk[],
          reducer: (prev: unknown, delta: unknown) => [...(prev as Chunk[]), ...(delta as Chunk[])],
        },
      },

      agent(ctx, next) {
        ctx.registerTool(searchTool)
        return next()
      },

      async tool(ctx, next) {
        const result = await next()
        // Track sources when search_knowledge tool is called, using cached results
        if (ctx.tool.name === "search_knowledge") {
          if (lastRetrievedChunks.length > 0) {
            ctx.state["search:file:sources"] = lastRetrievedChunks
          }
        }
        return result
      },
    }
  }

  // Auto mode: retrieve every turn
  return {
    name: "search:file",

    state: {
      "search:file:sources": {
        default: [] as Chunk[],
        reducer: (prev: unknown, delta: unknown) => [...(prev as Chunk[]), ...(delta as Chunk[])],
      },
    },

    async model(ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse> {
      // Extract latest user message
      const userMessages = ctx.messages.filter(m => m.role === "user")
      const lastUserMsg = userMessages[userMessages.length - 1]
      const rawQuery = typeof lastUserMsg?.content === "string"
        ? lastUserMsg.content
        : ""

      if (rawQuery) {
        const query = rewriteQuery
          ? rewriteQuery(rawQuery, ctx.messages)
          : rawQuery

        const chunks = await retrieveAndInject(query, ctx)
        if (chunks.length > 0) {
          ctx.state["search:file:sources"] = chunks
        }
      }

      return next()
    },
  }
}
