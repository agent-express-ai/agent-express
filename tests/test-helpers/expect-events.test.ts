import { describe, it, expect } from "vitest"
import { expectEventTypes, expectEventPayload, countEvents } from "../../src/test/expect-events.js"
import type { Event } from "../../src/types.js"

const events: Event[] = [
  { id: "1", ts: 1, type: "turn:start", schemaVersion: 1, payload: { turnIndex: 0, turnId: "t1" } },
  { id: "2", ts: 2, type: "user:input", schemaVersion: 1, payload: { text: "hi" } },
  { id: "3", ts: 3, type: "model:start", schemaVersion: 1, payload: { model: "m", callIndex: 0 } },
  { id: "4", ts: 4, type: "model:end", schemaVersion: 1, payload: { callIndex: 0, text: "ok", finishReason: "stop" } },
  { id: "5", ts: 5, type: "model:response", schemaVersion: 1, payload: { text: "ok" } },
  { id: "6", ts: 6, type: "turn:end", schemaVersion: 1, payload: { turnIndex: 0, turnId: "t1", text: "ok", status: "completed" } },
]

describe("test helpers: expect-events", () => {
  it("expectEventTypes passes when sequence appears as ordered subsequence", () => {
    expect(() => expectEventTypes(events, ["turn:start", "user:input", "turn:end"])).not.toThrow()
  })

  it("expectEventTypes throws when an expected type is missing", () => {
    expect(() => expectEventTypes(events, ["turn:start", "tool:call"])).toThrow(/missing "tool:call"/)
  })

  it("expectEventTypes throws when expected types appear out of order", () => {
    expect(() => expectEventTypes(events, ["turn:end", "user:input"])).toThrow(/missing "user:input"/)
  })

  it("expectEventPayload returns the typed payload of the first matching event", () => {
    const userIn = expectEventPayload<{ text: string }>(events, "user:input")
    expect(userIn.text).toBe("hi")

    const turnEnd = expectEventPayload<{ status: string }>(events, "turn:end")
    expect(turnEnd.status).toBe("completed")
  })

  it("expectEventPayload throws if event type not found", () => {
    expect(() => expectEventPayload(events, "tool:call")).toThrow(/no event of type "tool:call"/)
  })

  it("countEvents returns zero for absent type and the right count for present types", () => {
    expect(countEvents(events, "tool:call")).toBe(0)
    expect(countEvents(events, "model:end")).toBe(1)
    expect(countEvents(events, "user:input")).toBe(1)
  })
})
