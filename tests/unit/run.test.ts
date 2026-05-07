import { describe, it, expect } from "vitest"
import { AgentRun } from "../../src/run.js"
import { EventLog } from "../../src/event-log/event-log.js"
import { nextEventId } from "../../src/event-log/id.js"
import type { Event, RunResult } from "../../src/types.js"

const mockResult: RunResult = {
  text: "hello",
  state: {},
}

describe("AgentRun", () => {
  it("streams only events emitted after the run was constructed", async () => {
    const log = new EventLog()
    log.append({ id: nextEventId(), ts: Date.now(), type: "user:input", schemaVersion: 1, payload: { text: "earlier" } })
    const run = new AgentRun(log)

    log.append({ id: nextEventId(), ts: Date.now(), type: "model:chunk", schemaVersion: 1, payload: { callIndex: 0, text: "hi" } })
    log.append({ id: nextEventId(), ts: Date.now(), type: "model:end", schemaVersion: 1, payload: { callIndex: 0, text: "hi", finishReason: "stop" } })
    run.complete(mockResult)

    const events: Event[] = []
    for await (const event of run) {
      events.push(event)
    }

    expect(events).toHaveLength(2)
    expect(events[0]!.type).toBe("model:chunk")
    expect(events[1]!.type).toBe("model:end")
  })

  it("resolves .result with RunResult", async () => {
    const log = new EventLog()
    const run = new AgentRun(log)
    run.complete(mockResult)
    const result = await run.result
    expect(result.text).toBe("hello")
  })

  it("rejects .result on failure", async () => {
    const log = new EventLog()
    const run = new AgentRun(log)
    run.fail(new Error("boom"))
    await expect(run.result).rejects.toThrow("boom")
  })

  it("stops yielding once complete() is called", async () => {
    const log = new EventLog()
    const run = new AgentRun(log)
    run.result.catch(() => {})

    const collecting = (async () => {
      const collected: Event[] = []
      for await (const event of run) collected.push(event)
      return collected
    })()

    log.append({ id: nextEventId(), ts: Date.now(), type: "user:input", schemaVersion: 1, payload: { text: "x" } })
    run.complete(mockResult)
    log.append({ id: nextEventId(), ts: Date.now(), type: "user:input", schemaVersion: 1, payload: { text: "y" } })

    const events = await collecting
    expect(events).toHaveLength(1)
  })
})
