import { describe, it, expect } from "vitest"
import { Agent } from "../../../src/agent.js"
import { FunctionModel } from "../../../src/test/function-model.js"
import { agentEscalation } from "../src/escalation.js"

describe("agent.escalation()", () => {
  it("creates middleware with default config", () => {
    const middleware = agentEscalation()
    expect(middleware.name).toBe("support:escalation")
    expect(middleware.turn).toBeDefined()
    expect(middleware.model).toBeDefined()
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

describe("agent.escalation() — integration", () => {
  it("triggers escalation after N unproductive turns", async () => {
    const threshold = 3
    const escalationMsg = "Connecting you to a human."

    const model = new FunctionModel(() => ({
      text: "I'm not sure how to help with that.",
      usage: { inputTokens: 0, outputTokens: 0 },
      finishReason: "stop",
    }))

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(agentEscalation({ after: threshold, message: escalationMsg }))

    await agent.init()
    const session = agent.session()

    for (let i = 0; i < threshold - 1; i++) {
      const result = await session.run(`message ${i + 1}`).result
      expect(result.text).toBe("I'm not sure how to help with that.")

      const state = result.state["support:escalation"] as { triggered: boolean; counter: number }
      expect(state.triggered).toBe(false)
      expect(state.counter).toBe(i + 1)
    }

    const escalationResult = await session.run("still stuck").result
    expect(escalationResult.text).toBe(escalationMsg)

    const escalationState = escalationResult.state["support:escalation"] as {
      triggered: boolean
      reason: string
      turnIndex: number
      counter: number
      toolName: string
    }
    expect(escalationState.triggered).toBe(true)
    expect(escalationState.reason).toBe("safety-net")
    expect(escalationState.toolName).toBe("escalate_to_human")

    await session.close()
    await agent.dispose()
  })

  it("keeps responding with escalation message after triggered", async () => {
    const threshold = 2
    const escalationMsg = "Transferring to human."

    const model = new FunctionModel(() => ({
      text: "generic response",
      usage: { inputTokens: 0, outputTokens: 0 },
      finishReason: "stop",
    }))

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(agentEscalation({ after: threshold, message: escalationMsg }))

    await agent.init()
    const session = agent.session()

    await session.run("msg 1").result
    const r2 = await session.run("msg 2").result
    expect(r2.text).toBe(escalationMsg)
    expect((r2.state["support:escalation"] as any).triggered).toBe(true)

    const r3 = await session.run("still here?").result
    expect(r3.text).toBe(escalationMsg)

    await session.close()
    await agent.dispose()
  })

  it("emits error event when escalation triggers", async () => {
    const threshold = 2

    const model = new FunctionModel(() => ({
      text: "dunno",
      usage: { inputTokens: 0, outputTokens: 0 },
      finishReason: "stop",
    }))

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(agentEscalation({ after: threshold }))

    await agent.init()
    const session = agent.session()

    await session.run("msg 1").result

    const events: import("../../../src/types.js").Event[] = []
    const run = session.run("msg 2")
    for await (const event of run) {
      events.push(event)
    }

    const errorEvents = events.filter((e) => e.type === "error")
    expect(errorEvents.length).toBeGreaterThan(0)
    const payload = errorEvents[0]!.payload as { kind: string; message: string }
    expect(payload.message).toContain("Escalation safety-net triggered")

    await session.close()
    await agent.dispose()
  })

  it("resets counter when model returns tool calls", async () => {
    const threshold = 3
    let callCount = 0

    const model = new FunctionModel(() => {
      callCount++
      // Call 2 is turn 2's first model call - return tool call to reset counter
      if (callCount === 2) {
        return {
          text: "",
          toolCalls: [{ toolCallId: "tc1", toolName: "lookup", args: {} }],
          usage: { inputTokens: 0, outputTokens: 0 },
          finishReason: "tool-calls",
        }
      }
      // Call 3 is turn 2's second model call (after tool result)
      if (callCount === 3) {
        return {
          text: "Found it!",
          usage: { inputTokens: 0, outputTokens: 0 },
          finishReason: "stop",
        }
      }
      return {
        text: "text response",
        usage: { inputTokens: 0, outputTokens: 0 },
        finishReason: "stop",
      }
    })

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(agentEscalation({ after: threshold }))
    agent.use({
      name: "mock:tools",
      agent(ctx, next) {
        ctx.registerTool({
          name: "lookup",
          description: "test",
          jsonSchema: { type: "object", properties: {} },
          execute: async () => "result",
        })
        return next()
      },
    })

    await agent.init()
    const session = agent.session()

    // Turn 1: no tools, counter = 1
    const r1 = await session.run("msg 1").result
    expect((r1.state["support:escalation"] as any).counter).toBe(1)

    // Turn 2: tool call, counter resets to 0
    const r2 = await session.run("msg 2").result
    expect((r2.state["support:escalation"] as any).counter).toBe(0)

    // Turn 3: no tools, counter = 1 (not 3)
    const r3 = await session.run("msg 3").result
    expect((r3.state["support:escalation"] as any).counter).toBe(1)

    await session.close()
    await agent.dispose()
  })

  it("uses custom toolName in state when triggered", async () => {
    const model = new FunctionModel(() => ({
      text: "response",
      usage: { inputTokens: 0, outputTokens: 0 },
      finishReason: "stop",
    }))

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(agentEscalation({ after: 1, toolName: "transfer_to_agent" }))

    const { state } = await agent.run("test").result

    const escalationState = state["support:escalation"] as {
      triggered: boolean
      toolName: string
    }
    expect(escalationState.triggered).toBe(true)
    expect(escalationState.toolName).toBe("transfer_to_agent")
  })
})
