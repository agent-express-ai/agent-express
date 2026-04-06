import { describe, it, expect } from "vitest"
import { createSessionState, snapshotState } from "../../src/state.js"

describe("createSessionState", () => {
  it("returns default values", () => {
    const state = createSessionState([
      { counter: { default: 0 }, name: { default: "test" } },
    ])
    expect(state.counter).toBe(0)
    expect(state.name).toBe("test")
  })

  it("allows direct writes without reducer", () => {
    const state = createSessionState([{ counter: { default: 0 } }])
    state.counter = 5
    expect(state.counter).toBe(5)
  })

  it("dispatches reducer on write", () => {
    const state = createSessionState([
      {
        totalCost: {
          default: 0,
          reducer: (prev: unknown, delta: unknown) => (prev as number) + (delta as number),
        },
      },
    ])

    state.totalCost = 0.003
    expect(state.totalCost).toBe(0.003)

    state.totalCost = 0.002
    expect(state.totalCost).toBe(0.005)
  })

  it("merges schemas from multiple middleware", () => {
    const state = createSessionState([
      { cost: { default: 0, reducer: (p: unknown, d: unknown) => (p as number) + (d as number) } },
      { messages: { default: [] as string[] } },
    ])

    expect(state.cost).toBe(0)
    expect(state.messages).toEqual([])
  })

  it("persists values across reads", () => {
    const state = createSessionState([{ counter: { default: 0 } }])
    state.counter = 42
    expect(state.counter).toBe(42)
    expect(state.counter).toBe(42) // still 42
  })
})

describe("snapshotState", () => {
  it("returns a deep copy", () => {
    const state = createSessionState([
      { items: { default: [1, 2, 3] } },
    ])
    const snap = snapshotState(state)
    expect(snap.items).toEqual([1, 2, 3])

    // Mutating snapshot doesn't affect original
    ;(snap.items as number[]).push(4)
    expect(state.items).toEqual([1, 2, 3])
  })
})
