/**
 * @agent-express/search-pinecone — Pinecone managed vector DB retriever.
 * @module search-pinecone
 */
import type { Chunk } from "agent-express"

export interface PineconeRetrieverConfig {
  /** Pinecone API key. Default: process.env.PINECONE_API_KEY. */
  apiKey?: string
  /** Index host URL. */
  indexHost: string
  /** Namespace. */
  namespace?: string
  /** Embedding function. */
  embed: (text: string) => Promise<number[]>
  /** Top-K. Default: 5. */
  topK?: number
}

export function pineconeRetriever(config: PineconeRetrieverConfig): (query: string) => Promise<Chunk[]> {
  const { apiKey = process.env["PINECONE_API_KEY"], indexHost, namespace, embed, topK = 5 } = config
  if (!apiKey) throw new Error("Pinecone API key required. Set PINECONE_API_KEY or pass apiKey.")

  return async (query: string): Promise<Chunk[]> => {
    const vector = await embed(query)
    const body: Record<string, unknown> = { vector, topK, includeMetadata: true }
    if (namespace) body["namespace"] = namespace

    const response = await fetch(`${indexHost}/query`, {
      method: "POST",
      headers: { "Api-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) throw new Error(`Pinecone query failed: ${response.status}`)
    const data = await response.json() as { matches: Array<{ score: number; metadata?: Record<string, unknown> }> }

    return (data.matches ?? []).map((m) => {
      const chunk: Chunk = {
        text: String(m.metadata?.["text"] ?? m.metadata?.["content"] ?? ""),
        score: m.score,
      }
      if (m.metadata?.["source"]) chunk.source = { title: String(m.metadata["source"]) }
      return chunk
    })
  }
}
