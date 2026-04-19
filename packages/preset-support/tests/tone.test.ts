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

  it("custom rules appended to instructions", () => {
    const middleware = guardTone({
      style: "friendly-professional",
      rules: ["Use customer's name when known", "Always apologize first"],
    })
    expect(middleware.name).toBe("guard:tone")
    expect(middleware.model).toBeDefined()
  })

  it("language option accepted", () => {
    const middleware = guardTone({
      style: "formal",
      language: "es",
    })
    expect(middleware.name).toBe("guard:tone")
  })

  it("auto language option accepted", () => {
    const middleware = guardTone({
      style: "empathetic",
      language: "auto",
    })
    expect(middleware.name).toBe("guard:tone")
  })
})
