import { describe, it, expect } from "vitest"
import { Agent } from "../../src/agent.js"
import { FunctionModel } from "../../src/test/function-model.js"
import { observeLog } from "../../src/middleware/observe/log.js"
import { observeMetrics } from "../../src/middleware/observe/metrics.js"
import { observeTraces } from "../../src/middleware/observe/traces.js"
import type { LogEvent, MetricEvent, MetricsSnapshot, SpanData } from "../../src/types.js"

describe("observe middleware integration", () => {
  it("log + metrics + traces together — no conflicts", async () => {
    const logs: LogEvent[] = []
    const metricEvents: MetricEvent[] = []
    const spans: SpanData[] = []

    const model = new FunctionModel(() => ({
      text: "integrated response",
      usage: { inputTokens: 10, outputTokens: 20 },
      finishReason: "stop",
    }))

    const agent = new Agent({ name: "integrated", model, instructions: "test", defaults: false })
    agent.use(observeLog({ output: (e) => logs.push(e) }))
    agent.use(observeMetrics({ output: (e) => metricEvents.push(e) }))
    agent.use(observeTraces({ output: (s) => spans.push(s) }))

    const { text, state } = await agent.run("hello").result

    // Agent works correctly
    expect(text).toBe("integrated response")

    // Logs captured
    expect(logs.length).toBeGreaterThan(0)
    expect(logs.some(e => e.type === "session:start")).toBe(true)
    expect(logs.some(e => e.type === "model:response")).toBe(true)
    expect(logs.every(e => e.agentName === "integrated")).toBe(true)
    expect(logs.every(e => e.level !== undefined)).toBe(true)

    // Metrics captured
    expect(metricEvents.length).toBeGreaterThan(0)
    expect(metricEvents.some(e => e.name === "agent_express_model_calls_total")).toBe(true)

    // Metrics snapshot in state
    const snapshot = state["observe:metrics"] as MetricsSnapshot
    expect(snapshot).toBeDefined()
    expect(snapshot.modelCalls).toBe(1)
    expect(snapshot.tokens.input).toBe(10)

    // Spans captured
    expect(spans.length).toBeGreaterThan(0)
    expect(spans.some(s => s.name.startsWith("session.run"))).toBe(true)
    expect(spans.some(s => s.name.startsWith("model.call"))).toBe(true)
  })

  it("all middleware capture consistent session data", async () => {
    const logs: LogEvent[] = []
    const spans: SpanData[] = []

    const model = new FunctionModel(() => ({
      text: "ok",
      usage: { inputTokens: 5, outputTokens: 10 },
      finishReason: "stop",
    }))

    const agent = new Agent({ name: "consistent", model, instructions: "test", defaults: false })
    agent.use(observeLog({ output: (e) => logs.push(e) }))
    agent.use(observeTraces({ output: (s) => spans.push(s) }))

    await agent.run("hello").result

    // Same agent name everywhere
    for (const log of logs) {
      expect(log.agentName).toBe("consistent")
    }
    for (const span of spans) {
      expect(span.attributes["agent_express.agent.name"]).toBe("consistent")
    }

    // Same sessionId in logs and spans
    const logSessionId = logs[0]!.sessionId
    const spanSessionId = spans.find(s => s.name.startsWith("session.run"))?.attributes["agent_express.session.id"]
    expect(logSessionId).toBe(spanSessionId)
  })
})
