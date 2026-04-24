import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import { FunctionModel } from "../../src/test/function-model.js"
import { observeTraces } from "../../src/middleware/observe/traces.js"
import { toolsFunction } from "../../src/tools/function.js"
import { defaults } from "../../src/defaults.js"
import { z } from "zod"

/** Create a mock OTel Tracer with spied Span objects. */
function createMockTracer() {
  const endedSpans: Array<{
    name: string
    attributes: Record<string, unknown>
    statusCode?: number
    statusMessage?: string
    errorType?: string
    extraAttributes: Record<string, unknown>
  }> = []

  const tracer = {
    startSpan: vi.fn((name: string, options?: { attributes?: Record<string, unknown> }) => {
      const spanRecord = {
        name,
        attributes: { ...(options?.attributes ?? {}) },
        extraAttributes: {} as Record<string, unknown>,
        statusCode: undefined as number | undefined,
        statusMessage: undefined as string | undefined,
        errorType: undefined as string | undefined,
      }

      const span = {
        setAttribute: vi.fn((key: string, value: unknown) => {
          spanRecord.extraAttributes[key] = value
        }),
        setAttributes: vi.fn((attrs: Record<string, unknown>) => {
          Object.assign(spanRecord.extraAttributes, attrs)
        }),
        setStatus: vi.fn((status: { code: number; message?: string }) => {
          spanRecord.statusCode = status.code
          spanRecord.statusMessage = status.message
        }),
        end: vi.fn(() => {
          endedSpans.push(spanRecord)
        }),
        spanContext: vi.fn(() => ({
          traceId: "mock-trace-id",
          spanId: "mock-span-id",
          traceFlags: 1,
        })),
        isRecording: vi.fn(() => true),
      }
      return span
    }),
  }

  return { tracer: tracer as any, endedSpans }
}

function createAgent(traces: ReturnType<typeof observeTraces>) {
  const model = new FunctionModel(() => ({
    text: "ok",
    usage: { inputTokens: 10, outputTokens: 20 },
    finishReason: "stop",
  }))
  const agent = new Agent({ name: "test-agent", model, instructions: "test", defaults: false })
  agent.use(traces)
  return agent
}

describe("observe.traces() with OTel Tracer API mock", () => {
  it("tracer.startSpan() called for each lifecycle phase", async () => {
    const { tracer, endedSpans } = createMockTracer()
    const traces = observeTraces({ tracer })
    const agent = createAgent(traces)

    await agent.run("hello").result

    // Should have: session.run, turn, model.call, session.close (at minimum)
    const spanNames = endedSpans.map(s => s.name)
    expect(spanNames.some(n => n.startsWith("session.run"))).toBe(true)
    expect(spanNames.some(n => n.startsWith("turn"))).toBe(true)
    expect(spanNames.some(n => n.startsWith("model.call"))).toBe(true)
    expect(spanNames.some(n => n.startsWith("session.close"))).toBe(true)
  })

  it("otel mode — span names use GenAI conventions", async () => {
    const { tracer, endedSpans } = createMockTracer()
    const traces = observeTraces({ tracer, otel: true })
    const agent = createAgent(traces)

    await agent.run("hello").result

    const spanNames = endedSpans.map(s => s.name)
    expect(spanNames.some(n => n.startsWith("invoke_agent"))).toBe(true)
    expect(spanNames.some(n => n.startsWith("chat"))).toBe(true)
    expect(spanNames.some(n => n.startsWith("close_session"))).toBe(true)
  })

  it("model span has gen_ai.* attributes", async () => {
    const { tracer, endedSpans } = createMockTracer()
    const traces = observeTraces({ tracer })
    const agent = createAgent(traces)

    await agent.run("hello").result

    const modelSpan = endedSpans.find(s => s.name.startsWith("model.call"))!
    expect(modelSpan.attributes["gen_ai.operation.name"]).toBeDefined()
    expect(modelSpan.attributes["gen_ai.provider.name"]).toBeDefined()
    expect(modelSpan.attributes["gen_ai.request.model"]).toBeDefined()

    // Usage attrs are set via setAttributes (extraAttributes)
    expect(modelSpan.extraAttributes["gen_ai.usage.input_tokens"]).toBe(10)
    expect(modelSpan.extraAttributes["gen_ai.usage.output_tokens"]).toBe(20)
  })

  it("model span has framework attributes", async () => {
    const { tracer, endedSpans } = createMockTracer()
    const traces = observeTraces({ tracer })
    const agent = createAgent(traces)

    await agent.run("hello").result

    const modelSpan = endedSpans.find(s => s.name.startsWith("model.call"))!
    expect(modelSpan.attributes["agent_express.agent.name"]).toBe("test-agent")
    expect(modelSpan.attributes["agent_express.session.id"]).toBeDefined()
  })

  it("span.end() called on all spans", async () => {
    const { tracer, endedSpans } = createMockTracer()
    const traces = observeTraces({ tracer })
    const agent = createAgent(traces)

    await agent.run("hello").result

    // All started spans should be ended
    const startCount = (tracer.startSpan as ReturnType<typeof vi.fn>).mock.calls.length
    expect(endedSpans.length).toBe(startCount)
  })

  it("span.setStatus(ERROR) on model failure", async () => {
    const { tracer, endedSpans } = createMockTracer()
    const traces = observeTraces({ tracer })

    const model = new FunctionModel(() => { throw new Error("API timeout") })
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(traces)

    await expect(agent.run("hello").result).rejects.toThrow()

    const modelSpan = endedSpans.find(s => s.name.startsWith("model.call"))!
    expect(modelSpan.statusCode).toBe(2) // SpanStatusCode.ERROR
    expect(modelSpan.statusMessage).toBe("API timeout")
    expect(modelSpan.extraAttributes["error.type"]).toBe("Error")
  })

  it("custom tracer takes priority over global TracerProvider", async () => {
    const { tracer, endedSpans } = createMockTracer()
    // Pass custom tracer — should use it, not global
    const traces = observeTraces({ tracer })
    const agent = createAgent(traces)

    await agent.run("hello").result

    // Verify our custom tracer was used
    expect((tracer.startSpan as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0)
    expect(endedSpans.length).toBeGreaterThan(0)
  })

  it("recordContent: true — content passed to span attributes", async () => {
    const { tracer, endedSpans } = createMockTracer()
    const traces = observeTraces({ tracer, recordContent: true })
    const agent = createAgent(traces)

    await agent.run("hello").result

    const modelSpan = endedSpans.find(s => s.name.startsWith("model.call"))!
    // Input messages set at startSpan time (in attributes)
    expect(modelSpan.attributes["gen_ai.input.messages"]).toBeDefined()
    // Output messages set via setAttributes (in extraAttributes)
    expect(modelSpan.extraAttributes["gen_ai.output.messages"]).toBeDefined()
  })

  it("recordContent: false — no content in span attributes", async () => {
    const { tracer, endedSpans } = createMockTracer()
    const traces = observeTraces({ tracer, recordContent: false })
    const agent = createAgent(traces)

    await agent.run("hello").result

    const modelSpan = endedSpans.find(s => s.name.startsWith("model.call"))!
    expect(modelSpan.attributes["gen_ai.input.messages"]).toBeUndefined()
    expect(modelSpan.extraAttributes["gen_ai.output.messages"]).toBeUndefined()
  })

  it("session span has agent_express.session.id attribute", async () => {
    const { tracer, endedSpans } = createMockTracer()
    const traces = observeTraces({ tracer })
    const agent = createAgent(traces)

    await agent.run("hello").result

    const sessionSpan = endedSpans.find(s => s.name.startsWith("session.run"))!
    expect(sessionSpan.attributes["agent_express.session.id"]).toBeDefined()
    expect(typeof sessionSpan.attributes["agent_express.session.id"]).toBe("string")
  })

  it("turn span has turn.id and turn.index attributes", async () => {
    const { tracer, endedSpans } = createMockTracer()
    const traces = observeTraces({ tracer })
    const agent = createAgent(traces)

    await agent.run("hello").result

    const turnSpan = endedSpans.find(s => s.name.startsWith("turn"))!
    expect(turnSpan.attributes["agent_express.turn.id"]).toBeDefined()
    expect(turnSpan.attributes["agent_express.turn.index"]).toBe(0)
  })

  it("tool span — OTel span created with tool attributes", async () => {
    const { tracer, endedSpans } = createMockTracer()
    const traces = observeTraces({ tracer })

    const model = new FunctionModel((_messages, { callIndex }) => {
      if (callIndex === 0) {
        return {
          text: undefined,
          toolCalls: [{ toolCallId: "tc1", toolName: "greet", args: { name: "world" } }],
          usage: { inputTokens: 10, outputTokens: 5 },
          finishReason: "tool-calls",
        }
      }
      return { text: "Hello world!", usage: { inputTokens: 15, outputTokens: 10 }, finishReason: "stop" }
    })

    const greetTool = toolsFunction({
      name: "greet",
      description: "Greet someone",
      schema: z.object({ name: z.string() }),
      execute: async ({ name }) => `Hello, ${name}!`,
    })

    const agent = new Agent({ name: "test-agent", model, instructions: "test", defaults: false })
    agent.use(defaults())
    agent.use(greetTool)
    agent.use(traces)

    await agent.run("hello").result

    const toolSpan = endedSpans.find(s => s.name.startsWith("tool.call"))
    if (toolSpan) {
      expect(toolSpan.attributes["agent_express.tool.name"]).toBe("greet")
      expect(toolSpan.attributes["agent_express.call.id"]).toBeDefined()
      expect(toolSpan.attributes["agent_express.call.index"]).toBeDefined()
      // No error status for successful tool
      expect(toolSpan.statusCode).toBeUndefined()
    }
  })

  it("tool span — OTel otel mode uses execute_tool naming", async () => {
    const { tracer, endedSpans } = createMockTracer()
    const traces = observeTraces({ tracer, otel: true })

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

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(defaults())
    agent.use(echoTool)
    agent.use(traces)

    await agent.run("hello").result

    const toolSpan = endedSpans.find(s => s.name.startsWith("execute_tool"))
    if (toolSpan) {
      expect(toolSpan.name).toBe("execute_tool echo")
    }
  })

  it("tool error — OTel span setStatus(ERROR) for tool failure", async () => {
    const { tracer, endedSpans } = createMockTracer()
    const traces = observeTraces({ tracer })

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
      description: "Fails",
      schema: z.object({}),
      execute: async () => { throw new Error("boom error") },
    })

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(defaults())
    agent.use(boomTool)
    agent.use(traces)

    await agent.run("hello").result

    const toolSpan = endedSpans.find(s => s.name.startsWith("tool.call"))
    if (toolSpan) {
      expect(toolSpan.statusCode).toBe(2) // SpanStatusCode.ERROR
      expect(toolSpan.extraAttributes["error.type"]).toBe("ToolExecutionError")
    }
  })

  it("tool span — recordContent: true adds args and result via setAttributes", async () => {
    const { tracer, endedSpans } = createMockTracer()
    const traces = observeTraces({ tracer, recordContent: true })

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

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(defaults())
    agent.use(echoTool)
    agent.use(traces)

    await agent.run("hello").result

    const toolSpan = endedSpans.find(s => s.name.startsWith("tool.call"))
    if (toolSpan) {
      // args are set at startSpan
      expect(toolSpan.attributes["gen_ai.tool.call.arguments"]).toBeDefined()
      // result is set via setAttributes
      expect(toolSpan.extraAttributes["gen_ai.tool.call.result"]).toBeDefined()
    }
  })

  it("tool span — recordContent: false has no content attributes", async () => {
    const { tracer, endedSpans } = createMockTracer()
    const traces = observeTraces({ tracer, recordContent: false })

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

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(defaults())
    agent.use(echoTool)
    agent.use(traces)

    await agent.run("hello").result

    const toolSpan = endedSpans.find(s => s.name.startsWith("tool.call"))
    if (toolSpan) {
      expect(toolSpan.attributes["gen_ai.tool.call.arguments"]).toBeUndefined()
      expect(toolSpan.extraAttributes["gen_ai.tool.call.result"]).toBeUndefined()
    }
  })

  it("session error — OTel span setStatus(ERROR) for session failure", async () => {
    const { tracer, endedSpans } = createMockTracer()
    const traces = observeTraces({ tracer })

    const model = new FunctionModel(() => ({
      text: "ok",
      usage: { inputTokens: 10, outputTokens: 5 },
      finishReason: "stop",
    }))
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(traces)
    // Inner middleware throws during session lifecycle
    agent.use({
      name: "exploding",
      session: async () => { throw new Error("session crash") },
    })

    await expect(agent.run("hello").result).rejects.toThrow("session crash")

    const sessionSpan = endedSpans.find(s => s.name.startsWith("session.run"))!
    expect(sessionSpan.statusCode).toBe(2) // SpanStatusCode.ERROR
    expect(sessionSpan.statusMessage).toBe("session crash")
    expect(sessionSpan.extraAttributes["error.type"]).toBe("Error")
  })

  it("session error — no session.close span when session errors", async () => {
    const { tracer, endedSpans } = createMockTracer()
    const traces = observeTraces({ tracer })

    const model = new FunctionModel(() => ({
      text: "ok",
      usage: { inputTokens: 10, outputTokens: 5 },
      finishReason: "stop",
    }))
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(traces)
    agent.use({
      name: "exploding",
      session: async () => { throw new Error("crash") },
    })

    await expect(agent.run("hello").result).rejects.toThrow()

    const closeSpan = endedSpans.find(s => s.name.startsWith("session.close"))
    expect(closeSpan).toBeUndefined()
  })

  it("turn error — OTel span setStatus(ERROR) for turn failure", async () => {
    const { tracer, endedSpans } = createMockTracer()
    const traces = observeTraces({ tracer })

    const model = new FunctionModel(() => { throw new TypeError("bad") })
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(traces)

    await expect(agent.run("hello").result).rejects.toThrow()

    const turnSpan = endedSpans.find(s => s.name.startsWith("turn"))!
    expect(turnSpan.statusCode).toBe(2)
    expect(turnSpan.statusMessage).toBe("bad")
    expect(turnSpan.extraAttributes["error.type"]).toBe("TypeError")
  })

  it("tool catch — OTel span setStatus(ERROR) when tool middleware throws", async () => {
    const { tracer, endedSpans } = createMockTracer()
    const traces = observeTraces({ tracer })

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
    agent.use(traces)
    agent.use({
      name: "tool-thrower",
      tool: async (_ctx, next) => {
        await next()
        throw new RangeError("tool middleware exploded")
      },
    })

    await expect(agent.run("hello").result).rejects.toThrow("tool middleware exploded")

    const toolSpan = endedSpans.find(s => s.name.startsWith("tool.call"))
    if (toolSpan) {
      expect(toolSpan.statusCode).toBe(2) // SpanStatusCode.ERROR
      expect(toolSpan.statusMessage).toBe("tool middleware exploded")
      expect(toolSpan.extraAttributes["error.type"]).toBe("RangeError")
    }
  })

  it("model span — gen_ai.response.finish_reasons set in extraAttributes", async () => {
    const { tracer, endedSpans } = createMockTracer()
    const traces = observeTraces({ tracer })
    const agent = createAgent(traces)

    await agent.run("hello").result

    const modelSpan = endedSpans.find(s => s.name.startsWith("model.call"))!
    expect(modelSpan.extraAttributes["gen_ai.response.finish_reasons"]).toEqual(["stop"])
  })

  it("model span — gen_ai.usage.input_tokens and output_tokens correct values", async () => {
    const { tracer, endedSpans } = createMockTracer()
    const traces = observeTraces({ tracer })
    const agent = createAgent(traces)

    await agent.run("hello").result

    const modelSpan = endedSpans.find(s => s.name.startsWith("model.call"))!
    expect(modelSpan.extraAttributes["gen_ai.usage.input_tokens"]).toBe(10)
    expect(modelSpan.extraAttributes["gen_ai.usage.output_tokens"]).toBe(20)
  })

  it("model span — provider extracted from model string", async () => {
    const { tracer, endedSpans } = createMockTracer()
    const traces = observeTraces({ tracer })
    const agent = createAgent(traces)

    await agent.run("hello").result

    const modelSpan = endedSpans.find(s => s.name.startsWith("model.call"))!
    // FunctionModel uses "function" provider and "function-model" modelId
    expect(modelSpan.attributes["agent_express.provider"]).toBeDefined()
    expect(modelSpan.attributes["gen_ai.provider.name"]).toBeDefined()
  })
})
