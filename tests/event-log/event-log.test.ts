import { describe, it, expect } from "vitest"
import { z } from "zod"
import {
  EventLog,
  nextEventId,
  mergeEventTypeMaps,
  validateEmit,
  deriveHistory,
  CORE_EVENT_TYPES,
  EMITTED_CORE_EVENTS,
} from "../../src/event-log/index.js"
import {
  EventTypeCollisionError,
  EventValidationError,
  EventSerializationError,
  UnknownEventTypeError,
} from "../../src/errors.js"
import type { Event, Middleware } from "../../src/index.js"

describe("event-log: EventLog", () => {
  it("appends synchronously and exposes events read-your-writes", () => {
    const log = new EventLog()
    const e: Event = {
      id: nextEventId(),
      ts: Date.now(),
      type: "user:input",
      schemaVersion: 1,
      payload: { text: "hello" },
    }
    log.append(e)
    expect(log.events).toHaveLength(1)
    expect(log.events[0]?.payload).toEqual({ text: "hello" })
  })

  it("notifies subscribers in order", () => {
    const log = new EventLog()
    const seen: string[] = []
    log.subscribe((e) => seen.push(e.type))
    log.subscribe((e) => seen.push(`b:${e.type}`))
    log.append({ id: nextEventId(), ts: 1, type: "user:input", schemaVersion: 1, payload: { text: "x" } })
    expect(seen).toEqual(["user:input", "b:user:input"])
  })

  it("a throwing subscriber does not stop other subscribers or break the log", () => {
    const log = new EventLog()
    const seen: string[] = []
    log.subscribe(() => {
      throw new Error("first subscriber boom")
    })
    log.subscribe((e) => seen.push(e.type))
    log.append({ id: nextEventId(), ts: 1, type: "user:input", schemaVersion: 1, payload: { text: "x" } })
    expect(seen).toEqual(["user:input"])
    expect(log.events).toHaveLength(1)
  })

  it("unsubscribe stops further notifications", () => {
    const log = new EventLog()
    const seen: string[] = []
    const unsub = log.subscribe((e) => seen.push(e.type))
    log.append({ id: nextEventId(), ts: 1, type: "user:input", schemaVersion: 1, payload: { text: "a" } })
    unsub()
    log.append({ id: nextEventId(), ts: 2, type: "user:input", schemaVersion: 1, payload: { text: "b" } })
    expect(seen).toEqual(["user:input"])
  })

  it("drops appends after close()", () => {
    const log = new EventLog()
    log.append({ id: nextEventId(), ts: 1, type: "user:input", schemaVersion: 1, payload: { text: "a" } })
    log.close()
    log.append({ id: nextEventId(), ts: 2, type: "user:input", schemaVersion: 1, payload: { text: "b" } })
    expect(log.events).toHaveLength(1)
    expect(log.isClosed).toBe(true)
  })

  it("replay merges persisted events idempotently (skips known IDs)", () => {
    const log = new EventLog()
    const a: Event = { id: nextEventId(), ts: 1, type: "user:input", schemaVersion: 1, payload: { text: "a" } }
    const b: Event = { id: nextEventId(), ts: 2, type: "user:input", schemaVersion: 1, payload: { text: "b" } }
    log.append(a)
    log.replay([a, b]) // a already known, b is new
    expect(log.events.map((e) => e.id)).toEqual([a.id, b.id])
  })
})

describe("event-log: nextEventId", () => {
  it("returns lex-sortable UUIDv7 strings", () => {
    const ids = Array.from({ length: 50 }, () => nextEventId())
    const sorted = [...ids].sort()
    expect(ids).toEqual(sorted)
  })

  it("produces unique ids across rapid calls", () => {
    const seen = new Set<string>()
    for (let i = 0; i < 1000; i++) seen.add(nextEventId())
    expect(seen.size).toBe(1000)
  })
})

describe("event-log: mergeEventTypeMaps + validateEmit", () => {
  it("merges core + middleware vocabularies", () => {
    const mw: Middleware = {
      name: "channel-test",
      events: {
        "channel:test:msg": { schema: z.object({ text: z.string() }), schemaVersion: 1 },
      },
    }
    const merged = mergeEventTypeMaps([mw])
    expect("channel:test:msg" in merged).toBe(true)
    expect("user:input" in merged).toBe(true) // core preserved
  })

  it("throws EventTypeCollisionError on middleware ↔ middleware collision", () => {
    const a: Middleware = {
      name: "a",
      events: { "x:y": { schema: z.unknown(), schemaVersion: 1 } },
    }
    const b: Middleware = {
      name: "b",
      events: { "x:y": { schema: z.unknown(), schemaVersion: 1 } },
    }
    expect(() => mergeEventTypeMaps([a, b])).toThrow(EventTypeCollisionError)
  })

  it("throws EventTypeCollisionError when middleware redeclares a core type", () => {
    const mw: Middleware = {
      name: "naughty",
      events: { "user:input": { schema: z.unknown(), schemaVersion: 1 } },
    }
    expect(() => mergeEventTypeMaps([mw])).toThrow(EventTypeCollisionError)
  })

  it("throws EventTypeCollisionError when middleware claims a reserved-only type", () => {
    const mw: Middleware = {
      name: "early-bird",
      events: { "agent:handoff": { schema: z.unknown(), schemaVersion: 1 } },
    }
    expect(() => mergeEventTypeMaps([mw])).toThrow(EventTypeCollisionError)
  })

  it("throws UnknownEventTypeError on emit of an unregistered type", () => {
    const merged = mergeEventTypeMaps([])
    expect(() => validateEmit(merged, "channel:nonexistent", { text: "x" })).toThrow(UnknownEventTypeError)
  })

  it("throws EventValidationError on bad payload", () => {
    const merged = mergeEventTypeMaps([])
    expect(() => validateEmit(merged, "user:input", { wrongField: 42 })).toThrow(EventValidationError)
  })

  it("throws EventSerializationError on non-JSON-serializable payload (function)", () => {
    const mw: Middleware = {
      name: "loose",
      events: {
        "channel:loose": {
          schema: z.object({ payload: z.any() }),
          schemaVersion: 1,
        },
      },
    }
    const merged = mergeEventTypeMaps([mw])
    expect(() =>
      validateEmit(merged, "channel:loose", { payload: () => "no" }),
    ).toThrow(EventSerializationError)
  })

  it("throws EventSerializationError on circular reference", () => {
    const mw: Middleware = {
      name: "loose",
      events: {
        "channel:loose": { schema: z.any(), schemaVersion: 1 },
      },
    }
    const merged = mergeEventTypeMaps([mw])
    type Circular = { self?: Circular }
    const circ: Circular = {}
    circ.self = circ
    expect(() => validateEmit(merged, "channel:loose", circ)).toThrow(EventSerializationError)
  })
})

describe("event-log: core event-type map completeness", () => {
  it("declares all expected core-emitted types", () => {
    const expected = [
      "user:input",
      "model:start",
      "model:chunk",
      "model:end",
      "model:response",
      "tool:call",
      "tool:result",
      "turn:start",
      "turn:end",
      "error",
    ]
    for (const type of expected) {
      expect(EMITTED_CORE_EVENTS[type]).toBeDefined()
    }
  })

  it("declares all expected reserved-only types", () => {
    const reserved = [
      "compaction:applied",
      "agent:handoff",
      "agent:delegate",
      "permission:approved",
      "permission:denied",
      "permission:modified",
      "turn:diff",
      "turn:plan",
      "model:reasoning:chunk",
      "model:reasoning:end",
    ]
    for (const type of reserved) {
      expect(CORE_EVENT_TYPES.has(type)).toBe(true)
    }
  })

  it("turn:end carries a status enum that distinguishes the three outcomes", () => {
    const merged = mergeEventTypeMaps([])
    // Valid statuses
    expect(() =>
      validateEmit(merged, "turn:end", { turnIndex: 0, turnId: "t", text: "x", status: "completed" }),
    ).not.toThrow()
    expect(() =>
      validateEmit(merged, "turn:end", { turnIndex: 0, turnId: "t", text: "x", status: "interrupted" }),
    ).not.toThrow()
    expect(() =>
      validateEmit(merged, "turn:end", { turnIndex: 0, turnId: "t", text: "x", status: "failed" }),
    ).not.toThrow()
    // Invalid status
    expect(() =>
      validateEmit(merged, "turn:end", { turnIndex: 0, turnId: "t", text: "x", status: "weird" }),
    ).toThrow(EventValidationError)
  })

  it("schema-completeness: each emitted type carries the fields a reader needs", () => {
    const merged = mergeEventTypeMaps([])
    expect(() =>
      validateEmit(merged, "model:response", { text: "ok", usage: { inputTokens: 1, outputTokens: 2 } }),
    ).not.toThrow()
    expect(() =>
      validateEmit(merged, "tool:call", { tool: "sum", args: { a: 1 }, callId: "c1" }),
    ).not.toThrow()
    expect(() =>
      validateEmit(merged, "tool:result", { tool: "sum", callId: "c1", result: 3 }),
    ).not.toThrow()
  })
})

describe("event-log: deriveHistory", () => {
  function ev<T>(type: string, payload: T, schemaVersion = 1): Event {
    return { id: nextEventId(), ts: Date.now(), type, schemaVersion, payload }
  }

  it("derives empty history from empty log", () => {
    expect(deriveHistory([])).toEqual([])
  })

  it("projects user:input + model:response into a turn", () => {
    const events: Event[] = [
      ev("turn:start", { turnIndex: 0, turnId: "t1" }),
      ev("user:input", { text: "hi" }),
      ev("model:response", { text: "hello!" }),
      ev("turn:end", { turnIndex: 0, turnId: "t1", text: "hello!", status: "completed" }),
    ]
    expect(deriveHistory(events)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello!" },
    ])
  })

  it("falls back to model:end when no model:response present", () => {
    const events: Event[] = [
      ev("turn:start", { turnIndex: 0, turnId: "t1" }),
      ev("user:input", { text: "hi" }),
      ev("model:end", { callIndex: 0, text: "fallback", finishReason: "stop" }),
      ev("turn:end", { turnIndex: 0, turnId: "t1", text: "fallback", status: "completed" }),
    ]
    expect(deriveHistory(events)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "fallback" },
    ])
  })

  it("ignores tool calls/results, model chunks, errors", () => {
    const events: Event[] = [
      ev("turn:start", { turnIndex: 0, turnId: "t1" }),
      ev("user:input", { text: "compute 2+2" }),
      ev("tool:call", { tool: "calc", args: { x: 2 }, callId: "c1" }),
      ev("tool:result", { tool: "calc", callId: "c1", result: 4 }),
      ev("model:chunk", { callIndex: 0, text: "Result " }),
      ev("model:chunk", { callIndex: 0, text: "is 4." }),
      ev("model:response", { text: "Result is 4." }),
      ev("turn:end", { turnIndex: 0, turnId: "t1", text: "Result is 4.", status: "completed" }),
    ]
    expect(deriveHistory(events)).toEqual([
      { role: "user", content: "compute 2+2" },
      { role: "assistant", content: "Result is 4." },
    ])
  })

  it("trims via maxHistory", () => {
    const events: Event[] = []
    for (let i = 0; i < 5; i++) {
      events.push(
        ev("turn:start", { turnIndex: i, turnId: `t${i}` }),
        ev("user:input", { text: `q${i}` }),
        ev("model:response", { text: `a${i}` }),
        ev("turn:end", { turnIndex: i, turnId: `t${i}`, text: `a${i}`, status: "completed" }),
      )
    }
    const trimmed = deriveHistory(events, 4)
    expect(trimmed).toHaveLength(4)
    expect(trimmed[0]).toEqual({ role: "user", content: "q3" })
    expect(trimmed[3]).toEqual({ role: "assistant", content: "a4" })
  })

  it("handles in-progress turn (model:end without turn:end)", () => {
    const events: Event[] = [
      ev("turn:start", { turnIndex: 0, turnId: "t1" }),
      ev("user:input", { text: "hi" }),
      ev("model:end", { callIndex: 0, text: "partial...", finishReason: "stop" }),
    ]
    expect(deriveHistory(events)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "partial..." },
    ])
  })
})
