import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockQuery = vi.fn()
const mockConnect = vi.fn()
const mockEnd = vi.fn()

vi.mock("pg", () => ({
  default: {
    Client: vi.fn().mockImplementation(() => ({
      connect: mockConnect,
      query: mockQuery,
      end: mockEnd,
    })),
  },
}))

import { pgvectorRetriever } from "../src/index.js"

const mockEmbed = vi.fn<(text: string) => Promise<number[]>>()

describe("pgvectorRetriever", () => {
  beforeEach(() => {
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])
    mockConnect.mockResolvedValue(undefined)
    mockEnd.mockResolvedValue(undefined)
    mockQuery.mockResolvedValue({ rows: [] })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("throws if no connection string provided", () => {
    delete process.env["DATABASE_URL"]
    expect(() => pgvectorRetriever({ embed: mockEmbed })).toThrow(
      "PostgreSQL connection string required",
    )
  })

  it("SQL query contains correct table and column names", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const retrieve = pgvectorRetriever({
      connectionString: "postgresql://localhost/test",
      table: "my_docs",
      textColumn: "body",
      vectorColumn: "vec",
      embed: mockEmbed,
    })
    await retrieve("query")

    const sql = mockQuery.mock.calls[0][0] as string
    expect(sql).toContain("my_docs")
    expect(sql).toContain("body")
    expect(sql).toContain("vec")
  })

  it("uses default table/column names", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const retrieve = pgvectorRetriever({
      connectionString: "postgresql://localhost/test",
      embed: mockEmbed,
    })
    await retrieve("query")

    const sql = mockQuery.mock.calls[0][0] as string
    expect(sql).toContain("documents")
    expect(sql).toContain("content")
    expect(sql).toContain("embedding")
  })

  it("passes vector parameter correctly", async () => {
    mockEmbed.mockResolvedValueOnce([0.7, 0.8, 0.9])
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const retrieve = pgvectorRetriever({
      connectionString: "postgresql://localhost/test",
      embed: mockEmbed,
    })
    await retrieve("embed this")

    const params = mockQuery.mock.calls[0][1] as unknown[]
    expect(params[0]).toBe("[0.7,0.8,0.9]")
  })

  it("passes topK as LIMIT parameter", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const retrieve = pgvectorRetriever({
      connectionString: "postgresql://localhost/test",
      embed: mockEmbed,
      topK: 10,
    })
    await retrieve("query")

    const params = mockQuery.mock.calls[0][1] as unknown[]
    expect(params[1]).toBe(10)
  })

  it("parses results into Chunk[]", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { content: "First document", score: 0.95 },
        { content: "Second document", score: 0.80 },
      ],
    })

    const retrieve = pgvectorRetriever({
      connectionString: "postgresql://localhost/test",
      embed: mockEmbed,
    })
    const results = await retrieve("query")

    expect(results).toEqual([
      { text: "First document", score: 0.95 },
      { text: "Second document", score: 0.80 },
    ])
  })

  it("reads from custom text column in results", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ body: "Custom column content", score: 0.9 }],
    })

    const retrieve = pgvectorRetriever({
      connectionString: "postgresql://localhost/test",
      textColumn: "body",
      embed: mockEmbed,
    })
    const results = await retrieve("query")

    expect(results[0].text).toBe("Custom column content")
  })

  it("throws on invalid table name (SQL injection prevention)", () => {
    expect(() =>
      pgvectorRetriever({
        connectionString: "postgresql://localhost/test",
        table: "users; DROP TABLE",
        embed: mockEmbed,
      }),
    ).toThrow('Invalid table name: "users; DROP TABLE"')
  })

  it("throws on invalid text column name", () => {
    expect(() =>
      pgvectorRetriever({
        connectionString: "postgresql://localhost/test",
        textColumn: "col-name",
        embed: mockEmbed,
      }),
    ).toThrow('Invalid text column name: "col-name"')
  })

  it("throws on invalid vector column name", () => {
    expect(() =>
      pgvectorRetriever({
        connectionString: "postgresql://localhost/test",
        vectorColumn: "123bad",
        embed: mockEmbed,
      }),
    ).toThrow('Invalid vector column name: "123bad"')
  })

  it("closes client connection after query", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const retrieve = pgvectorRetriever({
      connectionString: "postgresql://localhost/test",
      embed: mockEmbed,
    })
    await retrieve("query")

    expect(mockEnd).toHaveBeenCalled()
  })
})
