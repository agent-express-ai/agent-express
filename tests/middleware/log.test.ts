import { describe, it, expect } from "vitest"
import { Agent } from "../../src/agent.js"
import { FunctionModel } from "../../src/test/function-model.js"
import { observeLog } from "../../src/middleware/observe/log.js"
import type { LogEvent } from "../../src/types.js"

function createAgent(logOpts: Parameters<typeof observeLog>[0]) {
  const model = new FunctionModel(() => ({
    text: "ok",
    usage: { inputTokens: 10, outputTokens: 20 },
    finishReason: "stop",
  }))
  const agent = new Agent({ name: "test-agent", model, instructions: "test", defaults: false })
  agent.use(observeLog(logOpts))
  return agent
}

describe("observe.log() enhancements", () => {
  it("level field — info for normal lifecycle events", async () => {
    const events: LogEvent[] = []
    const agent = createAgent({ output: (e) => events.push(e) })

    await agent.run("hello").result

    for (const event of events) {
      expect(event.level).toBeDefined()
      expect(["debug", "info", "warn", "error"]).toContain(event.level)
    }

    const infoEvents = events.filter(e => e.level === "info")
    expect(infoEvents.length).toBeGreaterThan(0)
  })

  it("agentName on all events", async () => {
    const events: LogEvent[] = []
    const agent = createAgent({ output: (e) => events.push(e) })

    await agent.run("hello").result

    for (const event of events) {
      expect(event.agentName).toBe("test-agent")
    }
  })

  it("turnId on turn/model events", async () => {
    const events: LogEvent[] = []
    const agent = createAgent({ output: (e) => events.push(e) })

    await agent.run("hello").result

    const turnEvents = events.filter(e => e.type.startsWith("turn:"))
    for (const event of turnEvents) {
      expect(event.turnId).toBeDefined()
    }

    const modelEvents = events.filter(e => e.type.startsWith("model:"))
    for (const event of modelEvents) {
      expect(event.turnId).toBeDefined()
    }
  })

  it("durationMs on end events", async () => {
    const events: LogEvent[] = []
    const agent = createAgent({ output: (e) => events.push(e) })

    await agent.run("hello").result

    const modelResponse = events.find(e => e.type === "model:response")
    expect(modelResponse?.durationMs).toBeDefined()
    expect(modelResponse!.durationMs!).toBeGreaterThanOrEqual(0)

    const turnEnd = events.find(e => e.type === "turn:end")
    expect(turnEnd?.durationMs).toBeDefined()
  })

  it("error field on model failure", async () => {
    const events: LogEvent[] = []
    const model = new FunctionModel(() => { throw new Error("API timeout") })
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(observeLog({ output: (e) => events.push(e) }))

    await expect(agent.run("hello").result).rejects.toThrow()

    const errorEvents = events.filter(e => e.level === "error")
    expect(errorEvents.length).toBeGreaterThan(0)

    const modelError = errorEvents.find(e => e.type === "model:response")
    expect(modelError?.error).toBeDefined()
    expect(modelError!.error!.type).toBe("Error")
    expect(modelError!.error!.message).toBe("API timeout")
  })

  it("recordContent: true — content at debug level", async () => {
    const events: LogEvent[] = []
    const agent = createAgent({ output: (e) => events.push(e), recordContent: true })

    await agent.run("hello").result

    const modelResponse = events.find(e => e.type === "model:response")
    expect(modelResponse?.level).toBe("debug")
    expect(modelResponse?.data["response"]).toBeDefined()
  })

  it("recordContent: false (default) — no content, info level", async () => {
    const events: LogEvent[] = []
    const agent = createAgent({ output: (e) => events.push(e) })

    await agent.run("hello").result

    const modelResponse = events.find(e => e.type === "model:response")
    expect(modelResponse?.level).toBe("info")
    expect(modelResponse?.data["response"]).toBeUndefined()
    expect(modelResponse?.data["messages"]).toBeUndefined()
  })

  it("backward compatibility — all original fields present", async () => {
    const events: LogEvent[] = []
    const agent = createAgent({ output: (e) => events.push(e) })

    await agent.run("hello").result

    for (const event of events) {
      expect(event.timestamp).toBeDefined()
      expect(event.type).toBeDefined()
      expect(event.sessionId).toBeDefined()
      expect(event.turnIndex).toBeDefined()
      expect(event.data).toBeDefined()
    }
  })
})
