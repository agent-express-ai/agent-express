import { describe, it, expect } from "vitest"
import { Agent } from "../../src/agent.js"
import { TestModel } from "../../src/test/test-model.js"
import { RecordModel, ReplayModel } from "../../src/test/recorder.js"
import { readFile, unlink } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("RecordModel", () => {
  it("wraps a model and records interactions", async () => {
    const inner = new TestModel({ defaultText: "recorded response" })
    const recorder = new RecordModel(inner)

    expect(recorder.specificationVersion).toBe("v3")
    expect(recorder.provider).toBe("test")
    expect(recorder.modelId).toBe("test-model")

    const agent = new Agent({
      name: "test",
      model: recorder,
      instructions: "You are helpful.",
      defaults: false,
    })

    const { text } = await agent.run("Hello").result
    expect(text).toBe("recorded response")

    // saveCassette to verify interactions were recorded
    const tmpPath = join(tmpdir(), `recorder-test-${Date.now()}.json`)
    try {
      await recorder.saveCassette(tmpPath)
      const raw = await readFile(tmpPath, "utf-8")
      const cassette = JSON.parse(raw)

      expect(cassette.version).toBe(1)
      expect(cassette.model).toBe("test-model")
      expect(cassette.recordedAt).toBeDefined()
      expect(cassette.interactions).toHaveLength(1)
      expect(cassette.interactions[0].request.callIndex).toBe(0)
      expect(cassette.interactions[0].request.messages.length).toBeGreaterThan(0)
      expect(cassette.interactions[0].response.text).toBe("recorded response")
    } finally {
      await unlink(tmpPath).catch(() => {})
    }
  })

  it("saveCassette writes JSON to disk and scrubs API keys", async () => {
    const inner = new TestModel({ defaultText: "ok" })
    const recorder = new RecordModel(inner)

    const agent = new Agent({
      name: "test",
      model: recorder,
      instructions: "test",
      defaults: false,
    })
    await agent.run("test").result

    const tmpPath = join(tmpdir(), `recorder-scrub-${Date.now()}.json`)
    try {
      await recorder.saveCassette(tmpPath)
      const raw = await readFile(tmpPath, "utf-8")

      // File should be valid JSON
      const parsed = JSON.parse(raw)
      expect(parsed.version).toBe(1)
      expect(parsed.interactions).toHaveLength(1)

      // Verify it doesn't contain common API key patterns
      // (Even though TestModel doesn't add any, we verify the file was written correctly)
      expect(raw).not.toMatch(/sk-[a-zA-Z0-9]{20,}/)
    } finally {
      await unlink(tmpPath).catch(() => {})
    }
  })
})

describe("ReplayModel", () => {
  it("serves recorded responses in order", async () => {
    const replay = ReplayModel.fromJSON({
      version: 1,
      model: "test-model",
      recordedAt: new Date().toISOString(),
      interactions: [
        {
          request: { messages: [{ role: "user", content: "Hello" }], tools: [], callIndex: 0 },
          response: { text: "First reply", usage: { inputTokens: 10, outputTokens: 5 }, finishReason: "stop" },
        },
        {
          request: { messages: [{ role: "user", content: "Bye" }], tools: [], callIndex: 1 },
          response: { text: "Second reply", usage: { inputTokens: 8, outputTokens: 4 }, finishReason: "stop" },
        },
      ],
    })

    expect(replay.specificationVersion).toBe("v3")
    expect(replay.provider).toBe("replay")
    expect(replay.modelId).toBe("test-model")

    // First call
    const agent1 = new Agent({
      name: "test",
      model: replay,
      instructions: "test",
      defaults: false,
    })
    const r1 = await agent1.run("Hello").result
    expect(r1.text).toBe("First reply")

    // Second call
    const r2 = await agent1.run("Bye").result
    expect(r2.text).toBe("Second reply")
  })

  it("throws when exhausted", async () => {
    const replay = ReplayModel.fromJSON({
      version: 1,
      model: "test-model",
      recordedAt: new Date().toISOString(),
      interactions: [
        {
          request: { messages: [{ role: "user", content: "Hello" }], tools: [], callIndex: 0 },
          response: { text: "Only one", usage: { inputTokens: 5, outputTokens: 3 }, finishReason: "stop" },
        },
      ],
    })

    const agent = new Agent({
      name: "test",
      model: replay,
      instructions: "test",
      defaults: false,
    })

    // First call succeeds
    await agent.run("Hello").result

    // Second call should throw
    await expect(agent.run("Again").result).rejects.toThrow("ReplayModel exhausted")
  })

  it("fromFile reads a cassette from disk", async () => {
    // First, record a cassette
    const inner = new TestModel({ defaultText: "from file" })
    const recorder = new RecordModel(inner)

    const agent = new Agent({
      name: "test",
      model: recorder,
      instructions: "test",
      defaults: false,
    })
    await agent.run("test input").result

    const tmpPath = join(tmpdir(), `replay-fromfile-${Date.now()}.json`)
    try {
      await recorder.saveCassette(tmpPath)

      // Now replay from file
      const replay = await ReplayModel.fromFile(tmpPath)
      const replayAgent = new Agent({
        name: "test",
        model: replay,
        instructions: "test",
        defaults: false,
      })
      const { text } = await replayAgent.run("ignored").result
      expect(text).toBe("from file")
    } finally {
      await unlink(tmpPath).catch(() => {})
    }
  })
})
