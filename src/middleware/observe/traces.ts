import type { Middleware, AgentContext, SessionContext, TurnContext, ModelContext, ToolContext } from "../../middleware.js"
import type { ModelResponse, ToolResult, SpanData } from "../../types.js"
import { tryImportOtel } from "./otel-api.js"

/**
 * Configuration for the `observe.traces()` middleware.
 */
export interface ObserveTracesOptions {
  /** Use OTel GenAI convention span names. Default: false (framework names). */
  otel?: boolean
  /** Record prompt/response content in spans. Default: false. */
  recordContent?: boolean
  /** Custom OTel Tracer instance. Overrides global TracerProvider. */
  tracer?: import("@opentelemetry/api").Tracer
  /** Custom span output for standalone mode (when @opentelemetry/api is not installed). */
  output?: (span: SpanData) => void
}

/** Span naming tables. */
const FRAMEWORK_NAMES = {
  init: "agent.init",
  dispose: "agent.dispose",
  session: "session.run",
  sessionClose: "session.close",
  turn: "turn",
  model: "model.call",
  tool: "tool.call",
} as const

const OTEL_NAMES = {
  init: "create_agent",
  dispose: "destroy_agent",
  session: "invoke_agent",
  sessionClose: "close_session",
  turn: "turn",
  model: "chat",
  tool: "execute_tool",
} as const

/** Internal span tracker interface — abstracts OTel vs standalone. */
interface SpanTracker {
  startSpan(name: string, attributes: Record<string, string | number | boolean | string[]>, parentId?: string): string
  endSpan(spanId: string, status: "ok" | "error", error?: { type: string; message: string }, extraAttrs?: Record<string, string | number | boolean | string[]>): void
}

/** Generate a random hex ID. */
function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Creates an `observe.traces()` middleware that emits OpenTelemetry-compatible spans.
 *
 * Two modes:
 * - With `@opentelemetry/api` installed: writes to global TracerProvider
 * - Without: emits SpanData objects via `output()` callback
 *
 * Span names use framework terminology by default. Set `otel: true` for
 * OTel GenAI convention names. GenAI attributes (`gen_ai.*`) are always present
 * regardless of naming mode.
 *
 * @param opts - Configuration options
 * @returns Middleware
 */
export function observeTraces(opts?: ObserveTracesOptions): Middleware {
  const useOtelNames = opts?.otel ?? false
  const recordContent = opts?.recordContent ?? false
  const customTracer = opts?.tracer
  const outputCallback = opts?.output
  const names = useOtelNames ? OTEL_NAMES : FRAMEWORK_NAMES

  let tracker: SpanTracker | null = null
  let initPromise: Promise<void> | null = null

  async function ensureTracker(): Promise<SpanTracker> {
    if (tracker) return tracker

    // Custom tracer takes priority
    if (customTracer) {
      tracker = createOtelTracker(customTracer)
      return tracker
    }

    // Explicit output = standalone
    if (outputCallback) {
      tracker = createStandaloneTracker(outputCallback)
      return tracker
    }

    // Try global TracerProvider
    const otel = await tryImportOtel()
    if (otel) {
      const tracer = otel.trace.getTracer("agent-express")
      tracker = createOtelTracker(tracer)
      return tracker
    }

    // No OTel, no callback — silent no-op
    tracker = createStandaloneTracker()
    return tracker
  }

  initPromise = ensureTracker().then(() => {})

  /** Extract provider from model string. */
  function extractProvider(model: string): string {
    return model.includes("/") ? model.split("/")[0]! : "unknown"
  }

  return {
    name: "observe:traces",

    // Note: agent.init/dispose spans are not implemented via the agent hook because
    // the agent onion stays open from init() until dispose() — making spans wrap
    // the entire agent lifecycle instead of just init. Session/turn/model/tool hooks
    // provide the essential tracing hierarchy.

    async session(ctx: SessionContext, next: () => Promise<void>): Promise<void> {
      await initPromise
      const t = tracker!
      const agentName = ctx.agent.name
      const spanName = `${names.session} ${agentName}`

      // Store session span ID for child spans
      const sessionSpanId = t.startSpan(spanName, {
        "agent_express.agent.name": agentName,
        "agent_express.session.id": ctx.sessionId,
      })
      ;(ctx as SessionContext & { __traceSessionSpanId: string }).__traceSessionSpanId = sessionSpanId

      try {
        await next()

        // session.close span — child of session
        const closeSpanName = `${names.sessionClose} ${agentName}`
        const closeSpanId = t.startSpan(closeSpanName, {
          "agent_express.agent.name": agentName,
          "agent_express.session.id": ctx.sessionId,
        }, sessionSpanId)
        t.endSpan(closeSpanId, "ok")

        t.endSpan(sessionSpanId, "ok")
      } catch (err) {
        t.endSpan(sessionSpanId, "error", {
          type: (err as Error).constructor?.name ?? "Error",
          message: (err as Error).message ?? String(err),
        })
        throw err
      }
    },

    async turn(ctx: TurnContext, next: () => Promise<void>): Promise<void> {
      const t = tracker!
      const sessionSpanId = (ctx as TurnContext & { __traceSessionSpanId?: string }).__traceSessionSpanId
      const spanName = `${names.turn} ${ctx.turnIndex}`

      const spanId = t.startSpan(spanName, {
        "agent_express.agent.name": ctx.agent.name,
        "agent_express.session.id": ctx.sessionId,
        "agent_express.turn.id": ctx.turnId,
        "agent_express.turn.index": ctx.turnIndex,
      }, sessionSpanId)
      ;(ctx as TurnContext & { __traceTurnSpanId: string }).__traceTurnSpanId = spanId

      try {
        await next()
        t.endSpan(spanId, "ok")
      } catch (err) {
        t.endSpan(spanId, "error", {
          type: (err as Error).constructor?.name ?? "Error",
          message: (err as Error).message ?? String(err),
        })
        throw err
      }
    },

    async model(ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse> {
      const t = tracker!
      const turnSpanId = (ctx as ModelContext & { __traceTurnSpanId?: string }).__traceTurnSpanId
      const modelStr = ctx.model
      const provider = extractProvider(modelStr)
      const spanName = `${names.model} ${modelStr}`

      const attrs: Record<string, string | number | boolean | string[]> = {
        "agent_express.agent.name": ctx.agent.name,
        "agent_express.session.id": ctx.sessionId,
        "agent_express.model": modelStr,
        "agent_express.provider": provider,
        "agent_express.call.index": ctx.callIndex,
        // GenAI attributes (always present)
        "gen_ai.operation.name": useOtelNames ? "chat" : "model.call",
        "gen_ai.provider.name": provider,
        "gen_ai.request.model": modelStr,
      }

      if (recordContent && ctx.messages) {
        attrs["gen_ai.input.messages"] = JSON.stringify(ctx.messages)
      }

      const spanId = t.startSpan(spanName, attrs, turnSpanId)

      try {
        const response = await next()

        const extraAttrs: Record<string, string | number | boolean | string[]> = {
          "gen_ai.usage.input_tokens": response.usage?.inputTokens ?? 0,
          "gen_ai.usage.output_tokens": response.usage?.outputTokens ?? 0,
          "gen_ai.response.finish_reasons": [response.finishReason],
        }

        if (recordContent && response.text) {
          extraAttrs["gen_ai.output.messages"] = JSON.stringify([{ role: "assistant", content: response.text }])
        }

        t.endSpan(spanId, "ok", undefined, extraAttrs)
        return response
      } catch (err) {
        t.endSpan(spanId, "error", {
          type: (err as Error).constructor?.name ?? "Error",
          message: (err as Error).message ?? String(err),
        })
        throw err
      }
    },

    async tool(ctx: ToolContext, next: () => Promise<ToolResult>): Promise<ToolResult> {
      const t = tracker!
      const turnSpanId = (ctx as ToolContext & { __traceTurnSpanId?: string }).__traceTurnSpanId
      const toolName = ctx.tool.name
      const spanName = `${names.tool} ${toolName}`

      const attrs: Record<string, string | number | boolean | string[]> = {
        "agent_express.agent.name": ctx.agent.name,
        "agent_express.session.id": ctx.sessionId,
        "agent_express.tool.name": toolName,
        "agent_express.call.id": ctx.callId,
        "agent_express.call.index": ctx.callIndex,
      }

      if (recordContent) {
        attrs["gen_ai.tool.call.arguments"] = JSON.stringify(ctx.args)
      }

      const spanId = t.startSpan(spanName, attrs, turnSpanId)

      try {
        const result = await next()

        if (recordContent) {
          attrs["gen_ai.tool.call.result"] = JSON.stringify(result.result)
        }

        if (result.isError) {
          t.endSpan(spanId, "error", { type: "ToolExecutionError", message: String(result.result) })
        } else {
          t.endSpan(spanId, "ok")
        }
        return result
      } catch (err) {
        t.endSpan(spanId, "error", {
          type: (err as Error).constructor?.name ?? "Error",
          message: (err as Error).message ?? String(err),
        })
        throw err
      }
    },
  }
}

/** Create a tracker that uses the OTel Tracer API. */
function createOtelTracker(tracer: import("@opentelemetry/api").Tracer): SpanTracker {
  const spans = new Map<string, import("@opentelemetry/api").Span>()

  return {
    startSpan(name, attributes, _parentId) {
      // OTel handles parent context automatically via context propagation
      const span = tracer.startSpan(name, {
        attributes: attributes as Record<string, string | number | boolean>,
      })
      const id = randomHex(8)
      spans.set(id, span)
      return id
    },
    endSpan(spanId, status, error, extraAttrs) {
      const span = spans.get(spanId)
      if (!span) return
      if (extraAttrs) {
        span.setAttributes(extraAttrs as Record<string, string | number | boolean>)
      }
      if (status === "error" && error) {
        span.setStatus({ code: 2 /* SpanStatusCode.ERROR */, message: error.message })
        span.setAttribute("error.type", error.type)
      }
      span.end()
      spans.delete(spanId)
    },
  }
}

/** Create a standalone tracker that emits SpanData via callback. */
function createStandaloneTracker(output?: (span: SpanData) => void): SpanTracker {
  const emit = output ?? (() => {})
  const pending = new Map<string, { name: string; traceId: string; spanId: string; parentId: string | undefined; startTime: number; attributes: Record<string, string | number | boolean | string[]> }>()
  const currentTraceId = randomHex(16)

  return {
    startSpan(name, attributes, parentId) {
      const spanId = randomHex(8)
      pending.set(spanId, {
        name,
        traceId: currentTraceId,
        spanId,
        parentId,
        startTime: Date.now(),
        attributes: { ...attributes },
      })
      return spanId
    },
    endSpan(spanId, status, error, extraAttrs) {
      const data = pending.get(spanId)
      if (!data) return
      if (extraAttrs) {
        Object.assign(data.attributes, extraAttrs)
      }
      const spanData: SpanData = {
        name: data.name,
        traceId: data.traceId,
        spanId: data.spanId,
        startTime: data.startTime,
        endTime: Date.now(),
        attributes: data.attributes,
        status,
      }
      if (data.parentId) spanData.parentId = data.parentId
      if (error) spanData.error = error
      emit(spanData)
      pending.delete(spanId)
    },
  }
}
