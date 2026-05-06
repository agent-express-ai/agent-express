import { describe, it, expect } from "vitest"
import { SessionState } from "../../src/session-store.js"

describe("SessionState", () => {
  it("starts in created state with generated id", () => {
    const session = new SessionState(undefined, [])
    expect(session.status).toBe("created")
    expect(session.id).toBeTruthy()
    expect(session.history).toEqual([])
  })

  it("uses provided session id", () => {
    const session = new SessionState("my-session", [])
    expect(session.id).toBe("my-session")
  })

  it("transitions created → running → completed", () => {
    const session = new SessionState(undefined, [])
    session.start()
    expect(session.status).toBe("running")
    session.complete()
    expect(session.status).toBe("completed")
  })

  it("transitions created → running → failed", () => {
    const session = new SessionState(undefined, [])
    session.start()
    session.fail()
    expect(session.status).toBe("failed")
  })

  it("throws when starting from non-created state", () => {
    const session = new SessionState(undefined, [])
    session.start()
    expect(() => session.start()).toThrow("Cannot start session")
  })

  it("derives history from event log via user:input + model:response projection", () => {
    const session = new SessionState(undefined, [])
    session.eventLog.append({
      id: "01",
      ts: 1,
      type: "user:input",
      schemaVersion: 1,
      payload: { text: "hello" },
    })
    session.eventLog.append({
      id: "02",
      ts: 2,
      type: "model:response",
      schemaVersion: 1,
      payload: { text: "hi" },
    })
    expect(session.history).toHaveLength(2)
    expect(session.history[0]!.role).toBe("user")
    expect(session.history[0]!.content).toBe("hello")
    expect(session.history[1]!.role).toBe("assistant")
    expect(session.history[1]!.content).toBe("hi")
  })

  it("initializes state from schemas", () => {
    const session = new SessionState(undefined, [
      { counter: { default: 0 } },
      { name: { default: "test" } },
    ])
    expect(session.state.counter).toBe(0)
    expect(session.state.name).toBe("test")
  })

  it("snapshots state as deep copy", () => {
    const session = new SessionState(undefined, [{ items: { default: [1, 2] } }])
    const snap = session.snapshotState()
    ;(snap.items as number[]).push(3)
    expect(session.state.items).toEqual([1, 2])
  })
})
