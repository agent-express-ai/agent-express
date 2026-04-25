/**
 * @agent-express/search-pgvector — PostgreSQL + pgvector retriever.
 * @module search-pgvector
 */
import type { Chunk } from "agent-express"

export interface PgvectorRetrieverConfig {
  /** PostgreSQL connection string. Default: process.env.DATABASE_URL. */
  connectionString?: string
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

/** Validates a SQL identifier (table/column name) to prevent injection. */
function validateIdentifier(name: string, label: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid ${label}: "${name}". Only alphanumeric characters and underscores are allowed.`)
  }
}

export function pgvectorRetriever(config: PgvectorRetrieverConfig): (query: string) => Promise<Chunk[]> {
  const { connectionString = process.env["DATABASE_URL"], table = "documents", textColumn = "content", vectorColumn = "embedding", embed, topK = 5 } = config
  if (!connectionString) throw new Error("PostgreSQL connection string required. Set DATABASE_URL or pass connectionString.")

  validateIdentifier(table, "table name")
  validateIdentifier(textColumn, "text column name")
  validateIdentifier(vectorColumn, "vector column name")

  return async (query: string): Promise<Chunk[]> => {
    const vector = await embed(query)
    const pg = await import("pg") as any
    const Pg = pg.default ?? pg
    const client = new Pg.Client({ connectionString })
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
