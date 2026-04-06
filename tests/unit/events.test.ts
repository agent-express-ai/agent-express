import { describe, it, expect } from "vitest"
import { EventBus } from "../../src/events.js"
import type { StreamEvent } from "../../src/types.js"

describe("EventBus", () => {
  it("emits and iterates events in order", async () => {
    const bus = new EventBus()
    bus.emit({ type: "session:start", sessionId: "s1" })
    bus.emit({ type: "model:chunk", text: "hello" })
    bus.close()

    const events: StreamEvent[] = []
    for await (const event of bus) {
      events.push(event)
    }

    expect(events).toHaveLength(2)
    expect(events[0]!.type).toBe("session:start")
    expect(events[1]!.type).toBe("model:chunk")
  })

  it("waits for new events when buffer is empty", async () => {
    const bus = new EventBus()
    const events: StreamEvent[] = []

    const iterating = (async () => {
      for await (const event of bus) {
        events.push(event)
      }
    })()

    // Emit after iteration started
    await new Promise((r) => setTimeout(r, 10))
    bus.emit({ type: "model:chunk", text: "delayed" })
    bus.close()

    await iterating

    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe("model:chunk")
  })

  it("stops iteration when closed", async () => {
    const bus = new EventBus()
    bus.close()

    const events: StreamEvent[] = []
    for await (const event of bus) {
      events.push(event)
    }

    expect(events).toHaveLength(0)
  })

  it("ignores events emitted after close", async () => {
    const bus = new EventBus()
    bus.emit({ type: "session:start", sessionId: "s1" })
    bus.close()
    bus.emit({ type: "model:chunk", text: "ignored" })

    const events: StreamEvent[] = []
    for await (const event of bus) {
      events.push(event)
    }

    expect(events).toHaveLength(1)
  })
})
