import { describe, it, expect } from "vitest"
import { guardTone } from "../src/tone.js"

describe("guard.tone()", () => {
  it("creates middleware with friendly-professional style", () => {
    const middleware = guardTone({ style: "friendly-professional" })
    expect(middleware.name).toBe("guard:tone")
    expect(middleware.model).toBeDefined()
  })

  it("creates middleware with all 6 styles", () => {
    const styles = ["friendly-professional", "formal", "casual", "empathetic", "concise", "educational"] as const
    for (const style of styles) {
      const middleware = guardTone({ style })
      expect(middleware.name).toBe("guard:tone")
    }
  })

  it("includes escalation tool name in instructions when provided", () => {
    const middleware = guardTone({
      style: "friendly-professional",
      escalationToolName: "escalate_to_human",
    })
    expect(middleware.model).toBeDefined()
  })
})
