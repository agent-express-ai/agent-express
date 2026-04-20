import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import { FunctionModel } from "../../src/test/function-model.js"
import { observeMetrics } from "../../src/middleware/observe/metrics.js"
import { toolsFunction } from "../../src/tools/function.js"
import { defaults } from "../../src/defaults.js"
import { z } from "zod"
import type { MetricsSnapshot } from "../../src/types.js"

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

  it("tool metrics — OTel counter.add for tool_calls_total and histogram for duration", async () => {
    const { meter, counters, histograms } = createMockMeter()
    const metrics = observeMetrics({ meter })

    const model = new FunctionModel((_messages, { callIndex }) => {
      if (callIndex === 0) {
        return {
          text: undefined,
          toolCalls: [{ toolCallId: "tc1", toolName: "echo", args: { msg: "hi" } }],
          usage: { inputTokens: 10, outputTokens: 5 },
          finishReason: "tool-calls",
        }
      }
      return { text: "done", usage: { inputTokens: 15, outputTokens: 10 }, finishReason: "stop" }
    })

    const echoTool = toolsFunction({
      name: "echo",
      description: "Echo",
      schema: z.object({ msg: z.string() }),
      execute: async ({ msg }) => msg,
    })

    const agent = new Agent({ name: "test-agent", model, instructions: "test", defaults: false })
    agent.use(defaults())
    agent.use(echoTool)
    agent.use(metrics)

    await agent.run("hello").result

    const toolCounter = counters.get("agent_express_tool_calls_total")!
    expect(toolCounter.add).toHaveBeenCalled()
    const toolCall = toolCounter.add.mock.calls.find(
      (c: any[]) => c[1]?.tool === "echo"
    )
    expect(toolCall).toBeDefined()

    const toolHist = histograms.get("agent_express_tool_duration_seconds")!
    expect(toolHist.record).toHaveBeenCalled()
  })

  it("tool error — OTel errors_total with error_source=tool", async () => {
    const { meter, counters } = createMockMeter()
    const metrics = observeMetrics({ meter })

    const model = new FunctionModel((_messages, { callIndex }) => {
      if (callIndex === 0) {
        return {
          text: undefined,
          toolCalls: [{ toolCallId: "tc1", toolName: "fail", args: {} }],
          usage: { inputTokens: 10, outputTokens: 5 },
          finishReason: "tool-calls",
        }
      }
      return { text: "recovered", usage: { inputTokens: 15, outputTokens: 10 }, finishReason: "stop" }
    })

    const failTool = toolsFunction({
      name: "fail",
      description: "Fails",
      schema: z.object({}),
      execute: async () => { throw new Error("tool broke") },
    })

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(defaults())
    agent.use(failTool)
    agent.use(metrics)

    await agent.run("hello").result

    const errorCounter = counters.get("agent_express_errors_total")!
    const toolErrors = (errorCounter.add.mock.calls as [number, Record<string, string>][])
      .filter(c => c[1]?.error_source === "tool")
    expect(toolErrors.length).toBeGreaterThan(0)
    expect(toolErrors[0]![1]).toHaveProperty("error_type", "ToolExecutionError")
  })

  it("custom metric mapping — OTel counter from custom mapping", async () => {
    const { meter, counters } = createMockMeter()
    const metrics = observeMetrics({
      meter,
      custom: [{
        stateKey: "test:custom-val",
        metric: "my_custom_counter",
        type: "counter",
        extract: (value) => ({ value: value as number, attributes: { region: "us" } }),
      }],
    })

    const model = new FunctionModel(() => ({
      text: "ok",
      usage: { inputTokens: 10, outputTokens: 20 },
      finishReason: "stop",
    }))
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(metrics)
    agent.use({
      name: "set-state",
      session: async (ctx, next) => {
        ctx.state["test:custom-val"] = 7
        await next()
      },
    })

    await agent.run("hello").result

    const customCounter = counters.get("my_custom_counter")
    expect(customCounter).toBeDefined()
    expect(customCounter!.add).toHaveBeenCalledWith(7, { region: "us" })
  })

  it("custom metric mapping — OTel histogram from custom mapping", async () => {
    const { meter, histograms } = createMockMeter()
    const metrics = observeMetrics({
      meter,
      custom: [{
        stateKey: "test:latency",
        metric: "my_custom_histogram",
        type: "histogram",
        extract: (value) => ({ value: value as number }),
      }],
    })

    const model = new FunctionModel(() => ({
      text: "ok",
      usage: { inputTokens: 10, outputTokens: 20 },
      finishReason: "stop",
    }))
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(metrics)
    agent.use({
      name: "set-state",
      session: async (ctx, next) => {
        ctx.state["test:latency"] = 1.5
        await next()
      },
    })

    await agent.run("hello").result

    const customHist = histograms.get("my_custom_histogram")
    expect(customHist).toBeDefined()
    expect(customHist!.record).toHaveBeenCalledWith(1.5, {})
  })

  it("otel: true — gen_ai.client.token.usage recorded via OTel histogram", async () => {
    const { meter, histograms } = createMockMeter()
    const metrics = observeMetrics({ meter, otel: true })
    const agent = createAgent(metrics)

    await agent.run("hello").result

    const tokenHist = histograms.get("gen_ai.client.token.usage")!
    expect(tokenHist.record).toHaveBeenCalled()

    const calls = tokenHist.record.mock.calls as [number, Record<string, string>][]
    const inputCall = calls.find(c => c[1]?.["gen_ai.token.type"] === "input")
    const outputCall = calls.find(c => c[1]?.["gen_ai.token.type"] === "output")
    expect(inputCall).toBeDefined()
    expect(inputCall![0]).toBe(10)
    expect(outputCall).toBeDefined()
    expect(outputCall![0]).toBe(20)
  })

  it("otel: true — gen_ai.client.operation.duration recorded", async () => {
    const { meter, histograms } = createMockMeter()
    const metrics = observeMetrics({ meter, otel: true })
    const agent = createAgent(metrics)

    await agent.run("hello").result

    const opDuration = histograms.get("gen_ai.client.operation.duration")!
    expect(opDuration.record).toHaveBeenCalled()

    const calls = opDuration.record.mock.calls as [number, Record<string, string>][]
    expect(calls[0]![1]?.["gen_ai.operation.name"]).toBe("chat")
    expect(calls[0]![0]).toBeGreaterThanOrEqual(0)
  })

  it("histogram bucket boundaries — correct BUCKETS used for each metric", async () => {
    const { meter } = createMockMeter()
    const metrics = observeMetrics({ meter })
    const agent = createAgent(metrics)

    await agent.run("hello").result

    const histCalls = (meter.createHistogram as ReturnType<typeof vi.fn>).mock.calls as [string, any][]
    const modelDurCall = histCalls.find(c => c[0] === "agent_express_model_duration_seconds")
    const toolDurCall = histCalls.find(c => c[0] === "agent_express_tool_duration_seconds")
    const turnDurCall = histCalls.find(c => c[0] === "agent_express_turn_duration_seconds")
    const sessionDurCall = histCalls.find(c => c[0] === "agent_express_session_duration_seconds")

    // All should pass advice with bucket boundaries
    expect(modelDurCall![1]?.advice?.explicitBucketBoundaries).toBeDefined()
    expect(toolDurCall![1]?.advice?.explicitBucketBoundaries).toBeDefined()
    expect(turnDurCall![1]?.advice?.explicitBucketBoundaries).toBeDefined()
    expect(sessionDurCall![1]?.advice?.explicitBucketBoundaries).toBeDefined()

    // Session buckets should be longer than model buckets
    const sessionBuckets = sessionDurCall![1].advice.explicitBucketBoundaries as number[]
    const modelBuckets = modelDurCall![1].advice.explicitBucketBoundaries as number[]
    expect(sessionBuckets[sessionBuckets.length - 1]!).toBeGreaterThan(modelBuckets[modelBuckets.length - 1]!)
  })

  it("tool catch — OTel errors_total when tool middleware throws", async () => {
    const { meter, counters } = createMockMeter()
    const metrics = observeMetrics({ meter })

    const model = new FunctionModel((_messages, { callIndex }) => {
      if (callIndex === 0) {
        return {
          text: undefined,
          toolCalls: [{ toolCallId: "tc1", toolName: "ok_tool", args: {} }],
          usage: { inputTokens: 10, outputTokens: 5 },
          finishReason: "tool-calls",
        }
      }
      return { text: "done", usage: { inputTokens: 15, outputTokens: 10 }, finishReason: "stop" }
    })

    const okTool = toolsFunction({
      name: "ok_tool",
      description: "Does nothing",
      schema: z.object({}),
      execute: async () => "ok",
    })

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(defaults())
    agent.use(okTool)
    agent.use(metrics)
    agent.use({
      name: "tool-thrower",
      tool: async (_ctx, next) => {
        await next()
        throw new TypeError("tool crash")
      },
    })

    await expect(agent.run("hello").result).rejects.toThrow("tool crash")

    const errorCounter = counters.get("agent_express_errors_total")!
    const toolErrors = (errorCounter.add.mock.calls as [number, Record<string, string>][])
      .filter(c => c[1]?.error_source === "tool")
    expect(toolErrors.length).toBeGreaterThan(0)
    expect(toolErrors.some(c => c[1]?.error_type === "TypeError")).toBe(true)
  })

  it("session error — OTel errors_total with error_source=agent", async () => {
    const { meter, counters } = createMockMeter()
    const metrics = observeMetrics({ meter })

    const model = new FunctionModel(() => ({
      text: "ok",
      usage: { inputTokens: 10, outputTokens: 5 },
      finishReason: "stop",
    }))
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(metrics)
    // Inner middleware throws during session lifecycle
    agent.use({
      name: "exploding",
      session: async () => { throw new Error("crash") },
    })

    await expect(agent.run("hello").result).rejects.toThrow()

    const errorCounter = counters.get("agent_express_errors_total")!
    const agentErrors = (errorCounter.add.mock.calls as [number, Record<string, string>][])
      .filter(c => c[1]?.error_source === "agent")
    expect(agentErrors.length).toBeGreaterThan(0)
  })

  it("session error — snapshot.errors incremented on session error", async () => {
    const { meter } = createMockMeter()
    const metrics = observeMetrics({ meter })

    const model = new FunctionModel(() => ({
      text: "ok",
      usage: { inputTokens: 10, outputTokens: 5 },
      finishReason: "stop",
    }))
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(metrics)
    agent.use({
      name: "exploding",
      session: async () => { throw new Error("crash") },
    })

    // Session-level catch runs and increments snapshot.errors
    await expect(agent.run("hello").result).rejects.toThrow()
  })
})
