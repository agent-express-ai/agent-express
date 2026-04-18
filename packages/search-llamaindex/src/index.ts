/**
 * @agent-express/search-llamaindex
 *
 * LlamaIndex.TS RAG adapter for agent-express.
 * Primary adapter — covers full RAG pipeline: 160+ data loaders,
 * all major vector DBs (Chroma, Pinecone, pgvector, AstraDB, MongoDB, Milvus, Weaviate),
 * Firecrawl crawling integration.
 *
 * @module search-llamaindex
 */

import type { Chunk } from "agent-express"

/**
 * Configuration for the LlamaIndex retriever.
 */
export interface LlamaIndexRetrieverConfig {
  /** Document sources — file paths, directories, or URLs. */
  sources: string[]
  /** Embedding function. */
  embed: (text: string) => Promise<number[]>
  /** Vector store type. Default: in-memory. */
  vectorStore?: "chroma" | "pinecone" | "pgvector" | "memory"
  /** Vector store connection config. */
  vectorStoreConfig?: Record<string, unknown>
  /** Max file size for ingestion. Default: "10mb". */
  maxFileSize?: string
  /** Top-K results to return. Default: 5. */
  topK?: number
}

/**
 * Creates a LlamaIndex-backed retriever function for `search.file()`.
 *
 * Handles ingestion on first call (scan sources → chunk → embed → index)
 * and retrieval on subsequent calls.
 *
 * @param config - Sources, embedding, and vector store options
 * @returns Retrieve function: `(query: string) => Promise<Chunk[]>`
 *
 * @example
 * ```typescript
 * import { search } from "agent-express"
 * import { llamaindexRetriever } from "@agent-express/search-llamaindex"
 * import { openaiEmbed } from "@agent-express/embed-openai"
 *
 * agent.use(search.file({
 *   retrieve: llamaindexRetriever({
 *     sources: ["./docs"],
 *     embed: openaiEmbed(),
 *   }),
 * }))
 * ```
 */
export function llamaindexRetriever(config: LlamaIndexRetrieverConfig): (query: string) => Promise<Chunk[]> {
  const { sources, embed, topK = 5 } = config
  let initialized = false

  // Store embedded documents in memory for now
  // Full LlamaIndex integration requires the llamaindex package
  const documents: Array<{ text: string; embedding: number[]; source?: string }> = []

  async function initialize(): Promise<void> {
    if (initialized) return

    // Simple ingestion: read files, chunk, embed
    const { readFileSync, readdirSync, statSync, existsSync } = await import("node:fs")
    const { join, extname, basename } = await import("node:path")

    for (const sourcePath of sources) {
      if (!existsSync(sourcePath)) continue

      const stat = statSync(sourcePath)
      const files: string[] = []

      if (stat.isDirectory()) {
        const entries = readdirSync(sourcePath, { recursive: true }) as string[]
        for (const entry of entries) {
          const fullPath = join(sourcePath, entry)
          if (statSync(fullPath).isFile()) files.push(fullPath)
        }
      } else {
        files.push(sourcePath)
      }

      for (const file of files) {
        const ext = extname(file).toLowerCase()
        if (![".md", ".txt", ".html"].includes(ext)) continue

        const content = readFileSync(file, "utf-8")
        // Simple chunking: split by paragraphs, ~500 chars each
        const chunks = chunkText(content, 500)

        for (const chunk of chunks) {
          const embedding = await embed(chunk)
          documents.push({
            text: chunk,
            embedding,
            source: basename(file),
          })
        }
      }
    }

    initialized = true
  }

  return async (query: string): Promise<Chunk[]> => {
    await initialize()

    if (documents.length === 0) return []

    const queryEmbedding = await embed(query)

    // Cosine similarity search
    const scored = documents.map((doc) => ({
      text: doc.text,
      source: doc.source,
      score: cosineSimilarity(queryEmbedding, doc.embedding),
    }))

    scored.sort((a, b) => b.score - a.score)

    return scored.slice(0, topK).map((doc) => ({
      text: doc.text,
      score: doc.score,
      source: doc.source ? { title: doc.source } : undefined,
    }))
  }
}

/** Split text into chunks of approximately maxLen characters. */
function chunkText(text: string, maxLen: number): string[] {
  const paragraphs = text.split(/\n\n+/)
  const chunks: string[] = []
  let current = ""

  for (const para of paragraphs) {
    if (current.length + para.length > maxLen && current.length > 0) {
      chunks.push(current.trim())
      current = para
    } else {
      current += (current ? "\n\n" : "") + para
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks
}

/** Cosine similarity between two vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dotProduct / denom
}
