import { describe, it, expect } from "vitest"

// Cross-package integration tests — verify all adapter packages export correct factory signatures.
// Detailed per-adapter tests live in packages/*/tests/.

describe("Adapter packages — exports", () => {
  it("all search adapters export factory functions", async () => {
    const { braveProvider } = await import("../../packages/search-brave/src/index.js")
    const { tavilyProvider } = await import("../../packages/search-tavily/src/index.js")
    const { exaProvider } = await import("../../packages/search-exa/src/index.js")
    const { qdrantRetriever } = await import("../../packages/search-qdrant/src/index.js")
    const { pineconeRetriever } = await import("../../packages/search-pinecone/src/index.js")
    const { pgvectorRetriever } = await import("../../packages/search-pgvector/src/index.js")
    const { llamaindexRetriever } = await import("../../packages/search-llamaindex/src/index.js")

    expect(typeof braveProvider).toBe("function")
    expect(typeof tavilyProvider).toBe("function")
    expect(typeof exaProvider).toBe("function")
    expect(typeof qdrantRetriever).toBe("function")
    expect(typeof pineconeRetriever).toBe("function")
    expect(typeof pgvectorRetriever).toBe("function")
    expect(typeof llamaindexRetriever).toBe("function")
  })

  it("all embed adapters export factory functions", async () => {
    const { openaiEmbed } = await import("../../packages/embed-openai/src/index.js")
    const { cohereEmbed } = await import("../../packages/embed-cohere/src/index.js")

    expect(typeof openaiEmbed).toBe("function")
    expect(typeof cohereEmbed).toBe("function")
  })

  it("all session adapters export factory functions", async () => {
    const { sqliteStore } = await import("../../packages/session-sqlite/src/index.js")
    const { redisStore } = await import("../../packages/session-redis/src/index.js")
    const { postgresStore } = await import("../../packages/session-postgres/src/index.js")
    const { openaiStore } = await import("../../packages/session-openai/src/index.js")

    expect(typeof sqliteStore).toBe("function")
    expect(typeof redisStore).toBe("function")
    expect(typeof postgresStore).toBe("function")
    expect(typeof openaiStore).toBe("function")
  })
})
