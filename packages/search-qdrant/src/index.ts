/**
 * @agent-express/search-qdrant — Qdrant vector DB retriever adapter.
 * Standalone retrieval only (no ingestion). Developer manages their own Qdrant instance.
 * @module search-qdrant
 */
import type { Chunk } from "agent-express"

export interface QdrantRetrieverConfig {
  /** Qdrant server URL. Default: "http://localhost:6333". */
  url?: string
  /** Collection name. */
  collection: string
  /** API key for Qdrant Cloud. Default: process.env.QDRANT_API_KEY. */
  apiKey?: string
  /** Embedding function for query. */
  embed: (text: string) => Promise<number[]>
  /** Top-K results. Default: 5. */
  topK?: number
}

export function qdrantRetriever(config: QdrantRetrieverConfig): (query: string) => Promise<Chunk[]> {
  const { url = "http://localhost:6333", collection, apiKey = process.env["QDRANT_API_KEY"], embed, topK = 5 } = config

  if (apiKey && url.startsWith("http://")) {
    const host = new URL(url).hostname
    if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
      console.warn(`[agent-express/search-qdrant] WARNING: API key is sent over plain HTTP to "${url}". Use HTTPS for non-localhost connections to protect credentials.`)
    }
  }

  return async (query: string): Promise<Chunk[]> => {
    const vector = await embed(query)
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (apiKey) headers["api-key"] = apiKey

    const response = await fetch(`${url}/collections/${collection}/points/search`, {
      method: "POST",
      headers,
      body: JSON.stringify({ vector, limit: topK, with_payload: true }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) throw new Error(`Qdrant search failed: ${response.status}`)

    const data = await response.json() as { result: Array<{ score: number; payload?: Record<string, unknown> }> }
    return data.result.map((r) => {
      const chunk: Chunk = {
        text: String(r.payload?.["text"] ?? r.payload?.["content"] ?? ""),
        score: r.score,
      }
      if (r.payload?.["source"]) chunk.source = { title: String(r.payload["source"]) }
      return chunk
    })
  }
}
