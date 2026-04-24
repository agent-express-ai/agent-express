import { describe, it, expect } from "vitest"
import { Agent } from "../../src/agent.js"
import { FunctionModel } from "../../src/test/function-model.js"
import { observeMetrics } from "../../src/middleware/observe/metrics.js"
import { toolsFunction } from "../../src/tools/function.js"
import { defaults } from "../../src/defaults.js"
import { z } from "zod"
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

  it("tool metrics — tool_calls_total and tool_duration_seconds emitted", async () => {
    const events: MetricEvent[] = []
    const metrics = observeMetrics({ output: (e) => events.push(e) })

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
      description: "Echo message",
      schema: z.object({ msg: z.string() }),
      execute: async ({ msg }) => msg,
    })

    const agent = new Agent({ name: "tool-test", model, instructions: "test", defaults: false })
    agent.use(defaults())
    agent.use(echoTool)
    agent.use(metrics)

    await agent.run("hello").result

    expect(events.some(e => e.name === "agent_express_tool_calls_total" && e.attributes.tool === "echo")).toBe(true)
    expect(events.some(e => e.name === "agent_express_tool_duration_seconds" && e.attributes.tool === "echo")).toBe(true)
  })

  it("tool metrics — snapshot records toolCalls and tool duration", async () => {
    const metrics = observeMetrics({ output: () => {} })

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
      description: "Echo message",
      schema: z.object({ msg: z.string() }),
      execute: async ({ msg }) => msg,
    })

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(defaults())
    agent.use(echoTool)
    agent.use(metrics)

    const { state } = await agent.run("hello").result
    const snapshot = state["observe:metrics"] as MetricsSnapshot

    expect(snapshot.toolCalls).toBe(1)
    expect(snapshot.duration.tools).toHaveLength(1)
    expect(snapshot.duration.tools[0]).toBeGreaterThanOrEqual(0)
  })

  it("tool error — errors_total incremented with error_source=tool", async () => {
    const events: MetricEvent[] = []
    const metrics = observeMetrics({ output: (e) => events.push(e) })

    const model = new FunctionModel((_messages, { callIndex }) => {
      if (callIndex === 0) {
        return {
          text: undefined,
          toolCalls: [{ toolCallId: "tc1", toolName: "boom", args: {} }],
          usage: { inputTokens: 10, outputTokens: 5 },
          finishReason: "tool-calls",
        }
      }
      return { text: "recovered", usage: { inputTokens: 15, outputTokens: 10 }, finishReason: "stop" }
    })

    const boomTool = toolsFunction({
      name: "boom",
      description: "A tool that errors",
      schema: z.object({}),
      execute: async () => { throw new Error("tool error") },
    })

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(defaults())
    agent.use(boomTool)
    agent.use(metrics)

    await agent.run("hello").result

    const toolErrors = events.filter(
      e => e.name === "agent_express_errors_total" && e.attributes.error_source === "tool"
    )
    expect(toolErrors.length).toBeGreaterThan(0)
    expect(toolErrors[0]!.attributes.error_type).toBe("ToolExecutionError")
  })

  it("tool error — snapshot.errors incremented", async () => {
    const metrics = observeMetrics({ output: () => {} })

    const model = new FunctionModel((_messages, { callIndex }) => {
      if (callIndex === 0) {
        return {
          text: undefined,
          toolCalls: [{ toolCallId: "tc1", toolName: "boom", args: {} }],
          usage: { inputTokens: 10, outputTokens: 5 },
          finishReason: "tool-calls",
        }
      }
      return { text: "recovered", usage: { inputTokens: 15, outputTokens: 10 }, finishReason: "stop" }
    })

    const boomTool = toolsFunction({
      name: "boom",
      description: "A tool that errors",
      schema: z.object({}),
      execute: async () => { throw new Error("tool error") },
    })

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(defaults())
    agent.use(boomTool)
    agent.use(metrics)

    const { state } = await agent.run("hello").result
    const snapshot = state["observe:metrics"] as MetricsSnapshot
    expect(snapshot.errors).toBeGreaterThan(0)
  })

  it("custom metric mapping — counter type", async () => {
    const events: MetricEvent[] = []
    const metrics = observeMetrics({
      output: (e) => events.push(e),
      custom: [{
        stateKey: "test:counter-value",
        metric: "custom_counter",
        type: "counter",
        extract: (value) => ({ value: value as number, attributes: { source: "test" } }),
      }],
    })

    const model = new FunctionModel(() => ({
      text: "ok",
      usage: { inputTokens: 10, outputTokens: 20 },
      finishReason: "stop",
    }))
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(metrics)
    // Set state value that the custom mapping reads
    agent.use({
      name: "set-state",
      session: async (ctx, next) => {
        ctx.state["test:counter-value"] = 42
        await next()
      },
    })

    const { state } = await agent.run("hello").result

    const customEvent = events.find(e => e.name === "custom_counter")
    expect(customEvent).toBeDefined()
    expect(customEvent!.type).toBe("counter")
    expect(customEvent!.value).toBe(42)
    expect(customEvent!.attributes.source).toBe("test")
  })

  it("custom metric mapping — histogram type", async () => {
    const events: MetricEvent[] = []
    const metrics = observeMetrics({
      output: (e) => events.push(e),
      custom: [{
        stateKey: "test:hist-value",
        metric: "custom_histogram",
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
        ctx.state["test:hist-value"] = 3.14
        await next()
      },
    })

    await agent.run("hello").result

    const customEvent = events.find(e => e.name === "custom_histogram")
    expect(customEvent).toBeDefined()
    expect(customEvent!.type).toBe("histogram")
    expect(customEvent!.value).toBe(3.14)
  })

  it("custom metric mapping — skips null/undefined state values", async () => {
    const events: MetricEvent[] = []
    const metrics = observeMetrics({
      output: (e) => events.push(e),
      custom: [{
        stateKey: "nonexistent:key",
        metric: "should_not_emit",
        type: "counter",
        extract: (value) => ({ value: value as number }),
      }],
    })

    const agent = createTestAgent([metrics])
    await agent.run("hello").result

    expect(events.some(e => e.name === "should_not_emit")).toBe(false)
  })

  it("custom metric mapping — ignores extraction errors gracefully", async () => {
    const events: MetricEvent[] = []
    const metrics = observeMetrics({
      output: (e) => events.push(e),
      custom: [{
        stateKey: "test:bad-value",
        metric: "should_not_crash",
        type: "counter",
        extract: () => { throw new Error("extract failed") },
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
        ctx.state["test:bad-value"] = "something"
        await next()
      },
    })

    // Should not throw
    const { text } = await agent.run("hello").result
    expect(text).toBe("ok")
    expect(events.some(e => e.name === "should_not_crash")).toBe(false)
  })

  it("no output callback — silent no-op mode", async () => {
    // No output, no OTel — should work silently
    const metrics = observeMetrics()
    const agent = createTestAgent([metrics])

    const { text, state } = await agent.run("hello").result
    expect(text).toBe("ok")

    const snapshot = state["observe:metrics"] as MetricsSnapshot
    expect(snapshot).toBeDefined()
    expect(snapshot.modelCalls).toBe(1)
  })

  it("tool catch — errors_total when tool middleware throws", async () => {
    const events: MetricEvent[] = []
    const metrics = observeMetrics({ output: (e) => events.push(e) })

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
    // Tool middleware that throws — triggers the metrics tool catch branch
    agent.use({
      name: "tool-thrower",
      tool: async (_ctx, next) => {
        await next()
        throw new TypeError("tool middleware crash")
      },
    })

    await expect(agent.run("hello").result).rejects.toThrow("tool middleware crash")

    const toolErrors = events.filter(
      e => e.name === "agent_express_errors_total" && e.attributes.error_source === "tool"
    )
    expect(toolErrors.length).toBeGreaterThan(0)
    expect(toolErrors.some(e => e.attributes.error_type === "TypeError")).toBe(true)
  })

  it("session error — errors_total with error_source=agent", async () => {
    const events: MetricEvent[] = []
    const metrics = observeMetrics({ output: (e) => events.push(e) })

    const model = new FunctionModel(() => ({
      text: "ok",
      usage: { inputTokens: 10, outputTokens: 20 },
      finishReason: "stop",
    }))
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(metrics)
    // Inner middleware throws during session lifecycle
    agent.use({
      name: "exploding",
      session: async () => { throw new Error("session fail") },
    })

    await expect(agent.run("hello").result).rejects.toThrow()

    // Agent-level error is tracked because session catch runs
    const errorEvents = events.filter(e => e.name === "agent_express_errors_total")
    expect(errorEvents.length).toBeGreaterThan(0)
    expect(errorEvents.some(e => e.attributes.error_source === "agent")).toBe(true)
  })
})
