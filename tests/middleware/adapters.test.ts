import { describe, it, expect } from "vitest"

// Test adapter exports and factory functions
// These are structural tests — no real API calls

describe("Adapter packages — factory functions", () => {
  // embed-openai
  it("openaiEmbed throws without API key", async () => {
    const { openaiEmbed } = await import("../../packages/embed-openai/src/index.js")
    const original = process.env["OPENAI_API_KEY"]
    delete process.env["OPENAI_API_KEY"]
    try {
      expect(() => openaiEmbed()).toThrow("API key required")
    } finally {
      if (original) process.env["OPENAI_API_KEY"] = original
    }
  })

  it("openaiEmbed returns function when key provided", async () => {
    const { openaiEmbed } = await import("../../packages/embed-openai/src/index.js")
    const fn = openaiEmbed({ apiKey: "test-key" })
    expect(typeof fn).toBe("function")
  })

  // embed-cohere
  it("cohereEmbed throws without API key", async () => {
    const { cohereEmbed } = await import("../../packages/embed-cohere/src/index.js")
    const original = process.env["COHERE_API_KEY"]
    delete process.env["COHERE_API_KEY"]
    try {
      expect(() => cohereEmbed()).toThrow("API key required")
    } finally {
      if (original) process.env["COHERE_API_KEY"] = original
    }
  })

  // search-brave
  it("braveProvider throws without API key", async () => {
    const { braveProvider } = await import("../../packages/search-brave/src/index.js")
    const original = process.env["BRAVE_API_KEY"]
    delete process.env["BRAVE_API_KEY"]
    try {
      expect(() => braveProvider()).toThrow("API key required")
    } finally {
      if (original) process.env["BRAVE_API_KEY"] = original
    }
  })

  it("braveProvider returns function when key provided", async () => {
    const { braveProvider } = await import("../../packages/search-brave/src/index.js")
    const fn = braveProvider({ apiKey: "test-key" })
    expect(typeof fn).toBe("function")
  })

  // search-tavily
  it("tavilyProvider throws without API key", async () => {
    const { tavilyProvider } = await import("../../packages/search-tavily/src/index.js")
    const original = process.env["TAVILY_API_KEY"]
    delete process.env["TAVILY_API_KEY"]
    try {
      expect(() => tavilyProvider()).toThrow("API key required")
    } finally {
      if (original) process.env["TAVILY_API_KEY"] = original
    }
  })

  // search-exa
  it("exaProvider throws without API key", async () => {
    const { exaProvider } = await import("../../packages/search-exa/src/index.js")
    const original = process.env["EXA_API_KEY"]
    delete process.env["EXA_API_KEY"]
    try {
      expect(() => exaProvider()).toThrow("API key required")
    } finally {
      if (original) process.env["EXA_API_KEY"] = original
    }
  })

  // search-qdrant
  it("qdrantRetriever returns function", async () => {
    const { qdrantRetriever } = await import("../../packages/search-qdrant/src/index.js")
    const fn = qdrantRetriever({ collection: "test", embed: async () => [0.1, 0.2] })
    expect(typeof fn).toBe("function")
  })

  // search-pinecone
  it("pineconeRetriever throws without API key", async () => {
    const { pineconeRetriever } = await import("../../packages/search-pinecone/src/index.js")
    const original = process.env["PINECONE_API_KEY"]
    delete process.env["PINECONE_API_KEY"]
    try {
      expect(() => pineconeRetriever({ indexHost: "https://test.pinecone.io", embed: async () => [0.1] })).toThrow("API key required")
    } finally {
      if (original) process.env["PINECONE_API_KEY"] = original
    }
  })

  // session-openai
  it("openaiStore throws without API key", async () => {
    const { openaiStore } = await import("../../packages/session-openai/src/index.js")
    const original = process.env["OPENAI_API_KEY"]
    delete process.env["OPENAI_API_KEY"]
    try {
      expect(() => openaiStore()).toThrow("API key required")
    } finally {
      if (original) process.env["OPENAI_API_KEY"] = original
    }
  })

  // session-sqlite
  it("sqliteStore returns SessionStore", async () => {
    const { sqliteStore } = await import("../../packages/session-sqlite/src/index.js")
    const store = sqliteStore({ path: ":memory:" })
    expect(store.load).toBeDefined()
    expect(store.save).toBeDefined()
    expect(store.delete).toBeDefined()
    expect(store.add).toBeDefined()
    expect(store.list).toBeDefined()
  })

  it("sqliteStore load returns null for unknown session", async () => {
    const { sqliteStore } = await import("../../packages/session-sqlite/src/index.js")
    const store = sqliteStore({ path: ":memory:" })
    const result = await store.load("nonexistent")
    expect(result).toBeNull()
  })

  it("sqliteStore save + load roundtrip", async () => {
    const { sqliteStore } = await import("../../packages/session-sqlite/src/index.js")
    const store = sqliteStore({ path: ":memory:" })
    await store.save("s1", {
      state: { count: 42 },
      history: [{ role: "user", content: "Hello" }, { role: "assistant", content: "Hi!" }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    const loaded = await store.load("s1")
    expect(loaded).not.toBeNull()
    expect(loaded!.state["count"]).toBe(42)
    expect(loaded!.history).toHaveLength(2)
    expect(loaded!.history[0]!.content).toBe("Hello")
  })

  it("sqliteStore add appends message", async () => {
    const { sqliteStore } = await import("../../packages/session-sqlite/src/index.js")
    const store = sqliteStore({ path: ":memory:" })
    await store.add("s2", { role: "user", content: "First" })
    await store.add("s2", { role: "assistant", content: "Second" })
    const msgs = await store.list("s2", { order: "asc" })
    expect(msgs).toHaveLength(2)
    expect(msgs[0]!.content).toBe("First")
    expect(msgs[1]!.content).toBe("Second")
  })

  it("sqliteStore list with pagination", async () => {
    const { sqliteStore } = await import("../../packages/session-sqlite/src/index.js")
    const store = sqliteStore({ path: ":memory:" })
    for (let i = 1; i <= 10; i++) {
      await store.add("s3", { role: "user", content: `msg-${i}` })
    }
    const page = await store.list("s3", { limit: 3, offset: 2, order: "asc" })
    expect(page).toHaveLength(3)
    expect(page[0]!.content).toBe("msg-3")
  })

  it("sqliteStore delete removes session", async () => {
    const { sqliteStore } = await import("../../packages/session-sqlite/src/index.js")
    const store = sqliteStore({ path: ":memory:" })
    await store.save("s4", { state: {}, history: [], createdAt: "", updatedAt: "" })
    await store.delete("s4")
    const loaded = await store.load("s4")
    expect(loaded).toBeNull()
  })

  // search-llamaindex (basic)
  it("llamaindexRetriever returns function", async () => {
    const { llamaindexRetriever } = await import("../../packages/search-llamaindex/src/index.js")
    const fn = llamaindexRetriever({
      sources: [],
      embed: async () => [0.1, 0.2, 0.3],
    })
    expect(typeof fn).toBe("function")
  })
})
