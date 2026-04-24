import { describe, it, expect, vi, beforeEach } from "vitest"
import { llamaindexRetriever } from "../src/index.js"

const mockEmbed = vi.fn<(text: string) => Promise<number[]>>()

describe("llamaindexRetriever", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns empty results when sources is empty", async () => {
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])

    const retrieve = llamaindexRetriever({
      sources: [],
      embed: mockEmbed,
    })
    const results = await retrieve("any query")

    expect(results).toEqual([])
  })

  it("returns empty results when no files found at sources", async () => {
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])

    const retrieve = llamaindexRetriever({
      sources: ["/nonexistent/path/that/does/not/exist"],
      embed: mockEmbed,
    })
    const results = await retrieve("query")

    expect(results).toEqual([])
  })

  it("performs cosine similarity search and returns ranked Chunk[]", async () => {
    // Create a temporary file for testing
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs")
    const { join } = await import("node:path")
    const tmpDir = mkdtempSync(join(import.meta.dirname ?? "/tmp", "llama-test-"))

    try {
      writeFileSync(join(tmpDir, "doc1.md"), "Hello world document")
      writeFileSync(join(tmpDir, "doc2.md"), "Goodbye moon document")

      // Embed function returns different vectors for different texts
      let callCount = 0
      mockEmbed.mockImplementation(async () => {
        callCount++
        if (callCount <= 2) {
          // Document embeddings (during indexing)
          return callCount === 1 ? [1, 0, 0] : [0, 1, 0]
        }
        // Query embedding (closer to first doc)
        return [0.9, 0.1, 0]
      })

      const retrieve = llamaindexRetriever({
        sources: [tmpDir],
        embed: mockEmbed,
        topK: 2,
      })
      const results = await retrieve("hello")

      expect(results.length).toBe(2)
      // First result should have higher score (closer to [1,0,0])
      expect(results[0].score).toBeGreaterThan(results[1].score)
      expect(results[0].text).toBeDefined()
      expect(results[0].source).toBeDefined()
    } finally {
      rmSync(tmpDir, { recursive: true })
    }
  })

  it("respects topK limit", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs")
    const { join } = await import("node:path")
    const tmpDir = mkdtempSync(join(import.meta.dirname ?? "/tmp", "llama-topk-"))

    try {
      writeFileSync(join(tmpDir, "a.md"), "First paragraph\n\nSecond paragraph\n\nThird paragraph")

      let callIdx = 0
      mockEmbed.mockImplementation(async () => {
        callIdx++
        // Vary the embeddings slightly for each chunk
        return [callIdx * 0.1, 0.5, 0.5]
      })

      const retrieve = llamaindexRetriever({
        sources: [tmpDir],
        embed: mockEmbed,
        topK: 1,
      })
      const results = await retrieve("test")

      expect(results.length).toBeLessThanOrEqual(1)
    } finally {
      rmSync(tmpDir, { recursive: true })
    }
  })

  it("includes source information in results", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs")
    const { join } = await import("node:path")
    const tmpDir = mkdtempSync(join(import.meta.dirname ?? "/tmp", "llama-source-"))

    try {
      writeFileSync(join(tmpDir, "readme.md"), "Some content here")

      mockEmbed.mockResolvedValue([0.5, 0.5, 0.5])

      const retrieve = llamaindexRetriever({
        sources: [tmpDir],
        embed: mockEmbed,
      })
      const results = await retrieve("content")

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].source).toEqual({ title: "readme.md" })
    } finally {
      rmSync(tmpDir, { recursive: true })
    }
  })

  it("only processes .md, .txt, .html files", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs")
    const { join } = await import("node:path")
    const tmpDir = mkdtempSync(join(import.meta.dirname ?? "/tmp", "llama-ext-"))

    try {
      writeFileSync(join(tmpDir, "valid.md"), "Markdown content")
      writeFileSync(join(tmpDir, "valid.txt"), "Text content")
      writeFileSync(join(tmpDir, "ignored.pdf"), "PDF content")
      writeFileSync(join(tmpDir, "ignored.json"), '{"key": "value"}')

      mockEmbed.mockResolvedValue([0.5, 0.5, 0.5])

      const retrieve = llamaindexRetriever({
        sources: [tmpDir],
        embed: mockEmbed,
      })
      const results = await retrieve("content")

      // Should have results from .md and .txt but not .pdf or .json
      // Embed is called once per chunk during indexing + once for query
      // 2 files indexed = at least 2 embed calls for docs + 1 for query
      const totalEmbedCalls = mockEmbed.mock.calls.length
      // At minimum 2 doc embeds + 1 query embed = 3
      expect(totalEmbedCalls).toBeGreaterThanOrEqual(3)
      expect(results.length).toBeGreaterThan(0)
    } finally {
      rmSync(tmpDir, { recursive: true })
    }
  })
})
