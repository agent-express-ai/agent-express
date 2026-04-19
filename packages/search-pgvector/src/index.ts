/**
 * @agent-express/search-pgvector — PostgreSQL + pgvector retriever.
 * @module search-pgvector
 */
import type { Chunk } from "agent-express"

export interface PgvectorRetrieverConfig {
  /** PostgreSQL connection string. */
  connectionString: string
  /** Table name containing vectors. Default: "documents". */
  table?: string
  /** Text column. Default: "content". */
  textColumn?: string
  /** Vector column. Default: "embedding". */
  vectorColumn?: string
  /** Embedding function. */
  embed: (text: string) => Promise<number[]>
  /** Top-K. Default: 5. */
  topK?: number
}

export function pgvectorRetriever(config: PgvectorRetrieverConfig): (query: string) => Promise<Chunk[]> {
  const { connectionString, table = "documents", textColumn = "content", vectorColumn = "embedding", embed, topK = 5 } = config

  return async (query: string): Promise<Chunk[]> => {
    const vector = await embed(query)
    const { default: pg } = await import("pg")
    const client = new pg.Client({ connectionString })
    await client.connect()
    try {
      const vectorStr = `[${vector.join(",")}]`
      const result = await client.query(
        `SELECT ${textColumn}, 1 - (${vectorColumn} <=> $1::vector) as score FROM ${table} ORDER BY ${vectorColumn} <=> $1::vector LIMIT $2`,
        [vectorStr, topK],
      )
      return result.rows.map((row: Record<string, unknown>) => ({
        text: String(row[textColumn]),
        score: Number(row["score"]),
      }))
    } finally {
      await client.end()
    }
  }
}
