import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import { devConsole } from "../../src/middleware/dev/console.js"
import type { LanguageModelV3, LanguageModelV3GenerateResult } from "@ai-sdk/provider"

function createMockModel(text = "ok"): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "mock",
    modelId: "mock",
    supportedUrls: {},
    doGenerate: vi.fn(async (): Promise<LanguageModelV3GenerateResult> => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 150, noCache: 150, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 85, text: 85, reasoning: 0 },
      },
      warnings: [],
    })),
    doStream: vi.fn(async () => { throw new Error("not implemented") }),
  }
}

describe("dev.console()", () => {
  it("outputs lifecycle events to stderr", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)

    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", logging: false })
    agent.use(devConsole())

    await agent.run("hi").result

    const output = stderrSpy.mock.calls.map((c) => c[0] as string).join("")
    expect(output).toContain("session")
    expect(output).toContain("turn #0")
    expect(output).toContain("model.call")
    expect(output).toContain("mock")

    stderrSpy.mockRestore()
  })

  it("shows session start and end", async () => {
    const lines: string[] = []
    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", logging: false })
    agent.use(devConsole({
      format: (entry) => {
        lines.push(entry.summary)
        return entry.summary
      },
    }))

    // Suppress actual stderr
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    await agent.run("hi").result
    stderrSpy.mockRestore()

    expect(lines[0]).toContain("session")
    expect(lines[lines.length - 1]).toContain("session done")
  })

  it("shows model call with tokens and duration", async () => {
    const entries: any[] = []
    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", logging: false })
    agent.use(devConsole({
      format: (entry) => {
        entries.push(entry)
        return entry.summary
      },
    }))

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    await agent.run("hi").result
    stderrSpy.mockRestore()

    const modelEntry = entries.find((e) => e.type === "model:call")
    expect(modelEntry).toBeDefined()
    expect(modelEntry.summary).toContain("model.call")
    expect(modelEntry.summary).toContain("150→85") // tokens
  })

  it("uses custom format function", async () => {
    const formatted: string[] = []
    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", logging: false })
    agent.use(devConsole({
      format: (entry) => {
        const line = `[${entry.type}] ${entry.summary}`
        formatted.push(line)
        return line
      },
    }))

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    await agent.run("hi").result
    stderrSpy.mockRestore()

    expect(formatted.some((l) => l.startsWith("[session:start]"))).toBe(true)
    expect(formatted.some((l) => l.startsWith("[model:call]"))).toBe(true)
  })
})
