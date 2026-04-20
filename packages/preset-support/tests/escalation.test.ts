import { describe, it, expect } from "vitest"
import { Agent } from "../../../src/agent.js"
import { FunctionModel } from "../../../src/test/function-model.js"
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

describe("agent.escalation() — integration", () => {
  it("triggers escalation after N unproductive turns (lines 80-91)", async () => {
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

    // First N-1 turns: model responds with text only (no tool calls) — counter increments
    for (let i = 0; i < threshold - 1; i++) {
      const result = await session.run(`message ${i + 1}`).result
      expect(result.text).toBe("I'm not sure how to help with that.")

      const state = result.state["support:escalation"] as { triggered: boolean; counter: number }
      expect(state.triggered).toBe(false)
      expect(state.counter).toBe(i + 1)
    }

    // Turn N: counter reaches threshold → escalation triggers
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
    expect(escalationState.turnIndex).toBe(threshold - 1)
    expect(escalationState.counter).toBe(0)
    expect(escalationState.toolName).toBe("escalate_to_human")

    await session.close()
    await agent.dispose()
  })

  it("keeps responding with escalation message after triggered (lines 57-61)", async () => {
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

    // Trigger escalation: 2 unproductive turns
    await session.run("msg 1").result
    const r2 = await session.run("msg 2").result
    expect(r2.text).toBe(escalationMsg)
    expect((r2.state["support:escalation"] as any).triggered).toBe(true)

    // Subsequent turns should short-circuit with the escalation message
    // (the model is NOT called — ctx.output is set and return happens before next())
    model.reset()
    let modelCalledAfterEscalation = false
    const modelAfter = new FunctionModel(() => {
      modelCalledAfterEscalation = true
      return { text: "should not see this", usage: { inputTokens: 0, outputTokens: 0 }, finishReason: "stop" }
    })

    // Since we can't swap the model mid-session, we verify by checking the output
    const r3 = await session.run("still here?").result
    expect(r3.text).toBe(escalationMsg)

    const r4 = await session.run("hello?").result
    expect(r4.text).toBe(escalationMsg)

    await session.close()
    await agent.dispose()
  })

  it("emits error event when escalation triggers (line 83)", async () => {
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

    // First turn: counter = 1, not triggered yet
    await session.run("msg 1").result

    // Second turn: counter reaches threshold, escalation fires with error event
    const events: import("../../../src/types.js").StreamEvent[] = []
    const run = session.run("msg 2")
    for await (const event of run) {
      events.push(event)
    }

    const errorEvents = events.filter((e) => e.type === "error")
    expect(errorEvents.length).toBeGreaterThan(0)
    expect((errorEvents[0] as any).error.message).toContain("Escalation safety-net triggered")
    expect((errorEvents[0] as any).error.message).toContain(`${threshold} unproductive turns`)

    await session.close()
    await agent.dispose()
  })

  it("resets counter when tools are called (line 73)", async () => {
    const threshold = 3

    const model = new FunctionModel(() => ({
      text: "text response",
      usage: { inputTokens: 0, outputTokens: 0 },
      finishReason: "stop",
    }))

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })

    // Add escalation FIRST (outermost in onion) so it reads observe:tools
    // AFTER the mock middleware sets it (inner middleware runs first after next())
    agent.use(agentEscalation({ after: threshold }))

    // Simulate observe:tools by adding a middleware that sets the state
    // after some turns (mimicking tool usage in specific turns)
    let turnCount = 0
    agent.use({
      name: "mock:observe-tools",
      state: {
        "observe:tools": {
          default: [] as Array<{ name: string }>,
        },
      },
      async turn(ctx, next) {
        turnCount++
        await next()
        // On turn 2, simulate that a tool was called (resets counter)
        if (turnCount === 2) {
          ctx.state["observe:tools"] = [{ name: "some_tool" }]
        } else {
          ctx.state["observe:tools"] = []
        }
      },
    })

    await agent.init()
    const session = agent.session()

    // Turn 1: no tools → counter = 1
    const r1 = await session.run("msg 1").result
    expect((r1.state["support:escalation"] as any).counter).toBe(1)

    // Turn 2: tools called → counter resets to 0
    const r2 = await session.run("msg 2").result
    expect((r2.state["support:escalation"] as any).counter).toBe(0)

    // Turn 3: no tools → counter = 1 (not 3, because it was reset)
    const r3 = await session.run("msg 3").result
    expect((r3.state["support:escalation"] as any).counter).toBe(1)

    // Turn 4: no tools → counter = 2
    const r4 = await session.run("msg 4").result
    expect((r4.state["support:escalation"] as any).counter).toBe(2)

    // Turn 5: no tools → counter = 3 = threshold → triggered
    const r5 = await session.run("msg 5").result
    expect((r5.state["support:escalation"] as any).triggered).toBe(true)

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
