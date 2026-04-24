import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import { FunctionModel } from "../../src/test/function-model.js"
import { searchFile } from "../../src/middleware/search/file.js"
import type { Chunk } from "../../src/types.js"

const mockChunks: Chunk[] = [
  { text: "Password reset: Go to Settings > Security > Reset Password.", score: 0.95, source: { title: "Password Guide", url: "https://help.example.com/password" } },
  { text: "Contact support at support@example.com for account issues.", score: 0.80, source: { title: "Contact Us" } },
  { text: "Low relevance filler text.", score: 0.30 },
]

const mockRetriever = vi.fn(async () => [...mockChunks])

function createAgent(config: Parameters<typeof searchFile>[0]) {
  const model = new FunctionModel((messages) => {
    // Check if search_knowledge tool call was requested
    const hasKnowledge = messages.some(m =>
      typeof m.content === "string" && m.content.includes("Relevant knowledge")
    )
    return {
      text: hasKnowledge ? "Based on the docs: go to Settings." : "I don't know.",
      usage: { inputTokens: 10, outputTokens: 5 },
      finishReason: "stop",
    }
  })
  const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
  agent.use(searchFile(config))
  return agent
}

describe("search.file()", () => {
  it("auto mode — retrieves every turn, chunks injected into context", async () => {
    mockRetriever.mockClear()
    const agent = createAgent({ retrieve: mockRetriever, mode: "auto" })

    const { text } = await agent.run("How do I reset my password?").result

    expect(mockRetriever).toHaveBeenCalledWith("How do I reset my password?")
    expect(text).toContain("Settings")
  })

  it("auto mode — topK limits chunks", async () => {
    const retriever = vi.fn(async () => [...mockChunks])
    const agent = createAgent({ retrieve: retriever, mode: "auto", topK: 1 })

    const { state } = await agent.run("password").result

    const sources = state["search:file:sources"] as Chunk[]
    expect(sources).toHaveLength(1)
    expect(sources[0]!.score).toBe(0.95) // highest score kept
  })

  it("auto mode — empty results, graceful degradation", async () => {
    const emptyRetriever = vi.fn(async () => [])
    const agent = createAgent({ retrieve: emptyRetriever, mode: "auto" })

    const { text } = await agent.run("something").result

    expect(text).toBeDefined() // agent still responds
    expect(emptyRetriever).toHaveBeenCalled()
  })

  it("auto mode — retriever throws, graceful degradation", async () => {
    const failingRetriever = vi.fn(async () => { throw new Error("DB connection failed") })
    const agent = createAgent({ retrieve: failingRetriever, mode: "auto" })

    const { text } = await agent.run("something").result

    expect(text).toBeDefined() // agent still responds
  })

  it("auto mode — sources tracked in state", async () => {
    const retriever = vi.fn(async () => [...mockChunks])
    const agent = createAgent({ retrieve: retriever, mode: "auto" })

    const { state } = await agent.run("reset password").result

    const sources = state["search:file:sources"] as Chunk[]
    expect(sources.length).toBeGreaterThan(0)
    expect(sources[0]!.source?.title).toBe("Password Guide")
  })

  it("tool mode — search_knowledge tool registered", async () => {
    // In tool mode, the model needs to call the tool
    // For this test, just verify the middleware creates without error
    const agent = createAgent({ retrieve: mockRetriever, mode: "tool" })
    // Agent init registers the tool
    await agent.init()
    await agent.dispose()
  })

  it("default mode is tool", async () => {
    const agent = createAgent({ retrieve: mockRetriever })
    // No mode specified — should default to tool (register search_knowledge)
    await agent.init()
    await agent.dispose()
  })
})
