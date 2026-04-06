import { describe, it, expect } from "vitest"
import { AgentRun } from "../../src/run.js"
import type { StreamEvent, RunResult } from "../../src/types.js"

const mockResult: RunResult = {
  output: "hello",
  cost: 0.001,
  usage: { inputTokens: 10, outputTokens: 5 },
  tools: [],
  turns: 1,
  duration: 100,
  messages: [],
  state: {},
}

describe("AgentRun", () => {
  it("streams events via async iteration", async () => {
    const run = new AgentRun()
    run.emit({ type: "session:start", sessionId: "s1" })
    run.emit({ type: "model:chunk", text: "hi" })
    run.complete(mockResult)

    const events: StreamEvent[] = []
    for await (const event of run) {
      events.push(event)
    }

    expect(events).toHaveLength(3) // start + chunk + session:end
    expect(events[0]!.type).toBe("session:start")
    expect(events[1]!.type).toBe("model:chunk")
    expect(events[2]!.type).toBe("session:end")
  })

  it("resolves .result with RunResult", async () => {
    const run = new AgentRun()
    run.complete(mockResult)

    const result = await run.result
    expect(result.output).toBe("hello")
    expect(result.cost).toBe(0.001)
  })

  it("rejects .result on failure", async () => {
    const run = new AgentRun()
    run.fail(new Error("boom"))

    await expect(run.result).rejects.toThrow("boom")
  })

  it("emits error event on failure", async () => {
    const run = new AgentRun()

    // Prevent unhandled rejection — we test .result rejection separately
    run.result.catch(() => {})

    const collecting = (async () => {
      const events: StreamEvent[] = []
      for await (const event of run) {
        events.push(event)
      }
      return events
    })()

    run.fail(new Error("boom"))

    const events = await collecting
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe("error")
  })
})
