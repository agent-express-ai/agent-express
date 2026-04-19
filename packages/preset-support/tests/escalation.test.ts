import { describe, it, expect } from "vitest"
import { agentEscalation } from "../src/escalation.js"

describe("agent.escalation()", () => {
  it("creates middleware with default config", () => {
    const middleware = agentEscalation()
    expect(middleware.name).toBe("support:escalation")
    expect(middleware.turn).toBeDefined()
    expect(middleware.state).toBeDefined()
  })

  it("creates middleware with custom after threshold", () => {
    const middleware = agentEscalation({ after: 3 })
    expect(middleware.name).toBe("support:escalation")
  })

  it("creates middleware with custom message", () => {
    const middleware = agentEscalation({ message: "Transferring..." })
    expect(middleware.name).toBe("support:escalation")
  })

  it("creates middleware with custom tool name", () => {
    const middleware = agentEscalation({ toolName: "transfer_to_agent" })
    expect(middleware.name).toBe("support:escalation")
  })

  it("state declaration includes support:escalation", () => {
    const middleware = agentEscalation()
    expect(middleware.state!["support:escalation"]).toBeDefined()
    expect(middleware.state!["support:escalation"]!.default).toEqual({ triggered: false, counter: 0 })
  })
})
