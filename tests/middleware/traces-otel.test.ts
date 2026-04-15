import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import { FunctionModel } from "../../src/test/function-model.js"
import { observeTraces } from "../../src/middleware/observe/traces.js"

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
})
