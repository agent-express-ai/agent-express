import { describe, it, expect } from "vitest"
import { toMatchAgentSnapshot, serializeForSnapshot } from "../../src/test/snapshot.js"

// Register the custom matcher
expect.extend({ toMatchAgentSnapshot })

// Augment Vitest's Assertion interface for type-safe usage
declare module "vitest" {
  interface Assertion<T = any> {
    toMatchAgentSnapshot(options?: { exclude?: string[] }): void
  }
}

describe("toMatchAgentSnapshot", () => {
  it("creates and matches a snapshot", () => {
    const result = {
      text: "Hello, world!",
      state: {
        "observe:usage": { inputTokens: 10, outputTokens: 5 },
        "counter": 42,
      },
    }

    // First call creates the snapshot, subsequent calls match against it
    expect(result).toMatchAgentSnapshot()
  })

  it("with exclude omits specified state keys", () => {
    const result = {
      text: "Stable output",
      state: {
        "observe:duration": 123.456,
        "observe:usage": { inputTokens: 10, outputTokens: 5 },
        "counter": 1,
      },
    }

    // Exclude the non-deterministic duration key
    expect(result).toMatchAgentSnapshot({ exclude: ["observe:duration"] })
  })

  it("sorts state keys deterministically", () => {
    const result = {
      text: "test",
      state: {
        "z-key": 1,
        "a-key": 2,
        "m-key": 3,
      },
    }

    const serialized = serializeForSnapshot(result)
    const keys = Object.keys(serialized.state as Record<string, unknown>)
    expect(keys).toEqual(["a-key", "m-key", "z-key"])
  })

  it("includes data field when present", () => {
    const result = {
      text: "structured",
      state: {},
      data: { name: "Alice", age: 30 },
    }

    const serialized = serializeForSnapshot(result)
    expect(serialized.data).toEqual({ name: "Alice", age: 30 })
  })

  it("excludes data field when undefined", () => {
    const result = {
      text: "text-only",
      state: { key: "val" },
    }

    const serialized = serializeForSnapshot(result)
    expect(serialized).not.toHaveProperty("data")
  })

  it("exclude removes multiple keys", () => {
    const result = {
      text: "test",
      state: {
        "keep-me": true,
        "remove-1": 123,
        "remove-2": 456,
        "also-keep": "yes",
      },
    }

    const serialized = serializeForSnapshot(result, { exclude: ["remove-1", "remove-2"] })
    const stateKeys = Object.keys(serialized.state as Record<string, unknown>)
    expect(stateKeys).toEqual(["also-keep", "keep-me"])
  })
})
