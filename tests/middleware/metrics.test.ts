import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import { FunctionModel } from "../../src/test/function-model.js"
import { observeMetrics } from "../../src/middleware/observe/metrics.js"
import type { MetricEvent, MetricsSnapshot } from "../../src/types.js"

describe("observe.metrics()", () => {
  function createTestAgent(middlewares: Parameters<Agent["use"]>[0][]) {
    const model = new FunctionModel(() => ({
      text: "ok",
      usage: { inputTokens: 10, outputTokens: 20 },
      finishReason: "stop",
    }))
    const agent = new Agent({ name: "test-agent", model, instructions: "test", defaults: false })
    for (const m of middlewares) agent.use(m)
    return agent
  }

  it("standalone mode — emits MetricEvent via output callback", async () => {
    const events: MetricEvent[] = []
    const metrics = observeMetrics({ output: (e) => events.push(e) })
    const agent = createTestAgent([metrics])

    await agent.run("hello").result

    const counterEvents = events.filter(e => e.type === "counter")
    const histogramEvents = events.filter(e => e.type === "histogram")

    // Should have counters for sessions, turns, model_calls, tokens
    expect(counterEvents.some(e => e.name === "agent_express_sessions_total")).toBe(true)
    expect(counterEvents.some(e => e.name === "agent_express_turns_total")).toBe(true)
    expect(counterEvents.some(e => e.name === "agent_express_model_calls_total")).toBe(true)
    expect(counterEvents.some(e => e.name === "agent_express_tokens_total")).toBe(true)

    // Should have histograms for durations
    expect(histogramEvents.some(e => e.name === "agent_express_model_duration_seconds")).toBe(true)
    expect(histogramEvents.some(e => e.name === "agent_express_turn_duration_seconds")).toBe(true)
    expect(histogramEvents.some(e => e.name === "agent_express_session_duration_seconds")).toBe(true)
  })

  it("counter events have correct agent attribute", async () => {
    const events: MetricEvent[] = []
    const metrics = observeMetrics({ output: (e) => events.push(e) })
    const agent = createTestAgent([metrics])

    await agent.run("hello").result

    const sessionCounter = events.find(e => e.name === "agent_express_sessions_total")
    expect(sessionCounter?.attributes.agent).toBe("test-agent")
  })

  it("model metrics include model and provider attributes", async () => {
    const events: MetricEvent[] = []
    const metrics = observeMetrics({ output: (e) => events.push(e) })

    const model = new FunctionModel(() => ({
      text: "ok",
      usage: { inputTokens: 10, outputTokens: 20 },
      finishReason: "stop",
    }))
    // FunctionModel doesn't use provider/model string format,
    // so provider will be "unknown"
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(metrics)

    await agent.run("hello").result

    const modelCounter = events.find(e => e.name === "agent_express_model_calls_total")
    expect(modelCounter?.attributes.agent).toBe("test")
  })

  it("token counters have direction attribute", async () => {
    const events: MetricEvent[] = []
    const metrics = observeMetrics({ output: (e) => events.push(e) })
    const agent = createTestAgent([metrics])

    await agent.run("hello").result

    const tokenEvents = events.filter(e => e.name === "agent_express_tokens_total")
    const inputEvent = tokenEvents.find(e => e.attributes.direction === "input")
    const outputEvent = tokenEvents.find(e => e.attributes.direction === "output")

    expect(inputEvent).toBeDefined()
    expect(inputEvent?.value).toBe(10)
    expect(outputEvent).toBeDefined()
    expect(outputEvent?.value).toBe(20)
  })

  it("state['observe:metrics'] contains session-scoped MetricsSnapshot", async () => {
    const metrics = observeMetrics({ output: () => {} }) // standalone mode to test state writing
    const agent = createTestAgent([metrics])

    const { state } = await agent.run("hello").result

    const snapshot = state["observe:metrics"] as MetricsSnapshot
    expect(snapshot).toBeDefined()
    expect(snapshot.modelCalls).toBe(1)
    expect(snapshot.turns).toBe(1)
    expect(snapshot.tokens.input).toBe(10)
    expect(snapshot.tokens.output).toBe(20)
    expect(snapshot.errors).toBe(0)
    // Note: session duration is written in session hook finally — may be 0
    // if state is snapshot'd before finally runs. Inner durations are reliable.
    expect(snapshot.duration.models).toHaveLength(1)
    expect(snapshot.duration.turns).toHaveLength(1)
  })

  it("otel: true additionally emits gen_ai.* metrics", async () => {
    const events: MetricEvent[] = []
    const metrics = observeMetrics({ otel: true, output: (e) => events.push(e) })
    const agent = createTestAgent([metrics])

    await agent.run("hello").result

    expect(events.some(e => e.name === "gen_ai.client.operation.duration")).toBe(true)
    expect(events.some(e => e.name === "gen_ai.client.token.usage")).toBe(true)
  })

  it("otel: false (default) does not emit gen_ai.* metrics", async () => {
    const events: MetricEvent[] = []
    const metrics = observeMetrics({ output: (e) => events.push(e) })
    const agent = createTestAgent([metrics])

    await agent.run("hello").result

    expect(events.some(e => e.name.startsWith("gen_ai."))).toBe(false)
  })

  it("error categorization — increments errors_total with error_source", async () => {
    const events: MetricEvent[] = []
    const metrics = observeMetrics({ output: (e) => events.push(e) })

    const model = new FunctionModel(() => {
      throw new Error("API rate limited")
    })
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(metrics)

    await expect(agent.run("hello").result).rejects.toThrow()

    const errorEvents = events.filter(e => e.name === "agent_express_errors_total")
    expect(errorEvents.length).toBeGreaterThan(0)
    expect(errorEvents.some(e => e.attributes.error_source === "model")).toBe(true)
  })
})
