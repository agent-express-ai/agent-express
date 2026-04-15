import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import { FunctionModel } from "../../src/test/function-model.js"
import { observeMetrics } from "../../src/middleware/observe/metrics.js"

/** Create a mock OTel Meter with spied Counter and Histogram. */
function createMockMeter() {
  const counters = new Map<string, { add: ReturnType<typeof vi.fn> }>()
  const histograms = new Map<string, { record: ReturnType<typeof vi.fn> }>()

  const meter = {
    createCounter: vi.fn((name: string) => {
      const counter = { add: vi.fn() }
      counters.set(name, counter)
      return counter
    }),
    createHistogram: vi.fn((name: string) => {
      const histogram = { record: vi.fn() }
      histograms.set(name, histogram)
      return histogram
    }),
    createObservableGauge: vi.fn(() => ({ addCallback: vi.fn() })),
    createObservableCounter: vi.fn(() => ({ addCallback: vi.fn() })),
    createObservableUpDownCounter: vi.fn(() => ({ addCallback: vi.fn() })),
    createUpDownCounter: vi.fn(() => ({ add: vi.fn() })),
    createGauge: vi.fn(() => ({ record: vi.fn() })),
  }

  return { meter: meter as any, counters, histograms }
}

function createAgent(metrics: ReturnType<typeof observeMetrics>) {
  const model = new FunctionModel(() => ({
    text: "ok",
    usage: { inputTokens: 10, outputTokens: 20 },
    finishReason: "stop",
  }))
  const agent = new Agent({ name: "test-agent", model, instructions: "test", defaults: false })
  agent.use(metrics)
  return agent
}

describe("observe.metrics() with OTel Meter API mock", () => {
  it("creates all agent_express_* counters and histograms", async () => {
    const { meter } = createMockMeter()
    const metrics = observeMetrics({ meter })
    const agent = createAgent(metrics)

    await agent.run("hello").result

    const counterNames = (meter.createCounter as ReturnType<typeof vi.fn>).mock.calls.map((c: any[]) => c[0])
    expect(counterNames).toContain("agent_express_model_calls_total")
    expect(counterNames).toContain("agent_express_tool_calls_total")
    expect(counterNames).toContain("agent_express_turns_total")
    expect(counterNames).toContain("agent_express_sessions_total")
    expect(counterNames).toContain("agent_express_errors_total")
    expect(counterNames).toContain("agent_express_tokens_total")

    const histNames = (meter.createHistogram as ReturnType<typeof vi.fn>).mock.calls.map((c: any[]) => c[0])
    expect(histNames).toContain("agent_express_model_duration_seconds")
    expect(histNames).toContain("agent_express_tool_duration_seconds")
    expect(histNames).toContain("agent_express_turn_duration_seconds")
    expect(histNames).toContain("agent_express_session_duration_seconds")
  })

  it("counter.add() called with correct attributes for model calls", async () => {
    const { meter, counters } = createMockMeter()
    const metrics = observeMetrics({ meter })
    const agent = createAgent(metrics)

    await agent.run("hello").result

    const modelCounter = counters.get("agent_express_model_calls_total")!
    expect(modelCounter.add).toHaveBeenCalled()

    const call = modelCounter.add.mock.calls[0]!
    expect(call[0]).toBe(1) // value
    expect(call[1]).toHaveProperty("agent", "test-agent") // attributes
  })

  it("histogram.record() called with duration for model calls", async () => {
    const { meter, histograms } = createMockMeter()
    const metrics = observeMetrics({ meter })
    const agent = createAgent(metrics)

    await agent.run("hello").result

    const modelHist = histograms.get("agent_express_model_duration_seconds")!
    expect(modelHist.record).toHaveBeenCalled()

    const call = modelHist.record.mock.calls[0]!
    expect(call[0]).toBeGreaterThanOrEqual(0) // duration in seconds
    expect(call[1]).toHaveProperty("agent", "test-agent")
  })

  it("token counters called with input/output direction", async () => {
    const { meter, counters } = createMockMeter()
    const metrics = observeMetrics({ meter })
    const agent = createAgent(metrics)

    await agent.run("hello").result

    const tokenCounter = counters.get("agent_express_tokens_total")!
    const calls = tokenCounter.add.mock.calls as [number, Record<string, string>][]

    const inputCall = calls.find(c => c[1]?.direction === "input")
    const outputCall = calls.find(c => c[1]?.direction === "output")

    expect(inputCall).toBeDefined()
    expect(inputCall![0]).toBe(10)
    expect(outputCall).toBeDefined()
    expect(outputCall![0]).toBe(20)
  })

  it("otel: true additionally creates gen_ai.* metrics", async () => {
    const { meter } = createMockMeter()
    const metrics = observeMetrics({ meter, otel: true })
    const agent = createAgent(metrics)

    await agent.run("hello").result

    const histNames = (meter.createHistogram as ReturnType<typeof vi.fn>).mock.calls.map((c: any[]) => c[0])
    expect(histNames).toContain("gen_ai.client.operation.duration")
    expect(histNames).toContain("gen_ai.client.token.usage")
  })

  it("otel: false does not create gen_ai.* metrics", async () => {
    const { meter } = createMockMeter()
    const metrics = observeMetrics({ meter, otel: false })
    const agent = createAgent(metrics)

    await agent.run("hello").result

    const histNames = (meter.createHistogram as ReturnType<typeof vi.fn>).mock.calls.map((c: any[]) => c[0])
    expect(histNames.some((n: string) => n.startsWith("gen_ai."))).toBe(false)
  })

  it("custom meter takes priority over global MeterProvider", async () => {
    const { meter, counters } = createMockMeter()
    // Pass custom meter — should use it, not global
    const metrics = observeMetrics({ meter })
    const agent = createAgent(metrics)

    await agent.run("hello").result

    // Verify our custom meter was used (counters have data)
    expect(counters.get("agent_express_sessions_total")!.add).toHaveBeenCalled()
  })

  it("error categorization — counter.add with error_source and error_type", async () => {
    const { meter, counters } = createMockMeter()
    const metrics = observeMetrics({ meter })

    const model = new FunctionModel(() => { throw new Error("rate limited") })
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(metrics)

    await expect(agent.run("hello").result).rejects.toThrow()

    const errorCounter = counters.get("agent_express_errors_total")!
    expect(errorCounter.add).toHaveBeenCalled()

    const call = errorCounter.add.mock.calls[0] as [number, Record<string, string>]
    expect(call[1]).toHaveProperty("error_source", "model")
    expect(call[1]).toHaveProperty("error_type", "Error")
  })
})
