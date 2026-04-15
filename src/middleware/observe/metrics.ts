import type { Middleware, SessionContext, TurnContext, ModelContext, ToolContext } from "../../middleware.js"
import type { ModelResponse, ToolResult, MetricEvent, MetricsSnapshot } from "../../types.js"
import { tryImportOtel } from "./otel-api.js"

/** Histogram bucket boundaries tuned for AI agent workloads. */
const BUCKETS = {
  model: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15, 30, 60],
  tool: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  turn: [0.5, 1, 2.5, 5, 10, 15, 30, 60, 120],
  session: [1, 5, 10, 30, 60, 120, 300, 600],
}

/**
 * Configuration for the `observe.metrics()` middleware.
 */
export interface ObserveMetricsOptions {
  /** Emit OTel GenAI standard metrics alongside agent_express_* metrics. Default: false. */
  otel?: boolean
  /** Custom OTel Meter instance. Overrides global MeterProvider. */
  meter?: import("@opentelemetry/api").Meter
  /** Custom output callback for standalone mode (when @opentelemetry/api is not installed). */
  output?: (event: MetricEvent) => void
}

/** Internal interface for recording metrics — abstracts OTel vs standalone. */
interface MetricRecorder {
  counterAdd(name: string, attributes: Record<string, string>, value?: number): void
  histogramRecord(name: string, attributes: Record<string, string>, value: number): void
}

/**
 * Creates an `observe.metrics()` middleware that tracks agent performance metrics
 * via the `@opentelemetry/api` Meter API.
 *
 * Two modes:
 * - With `@opentelemetry/api` installed: creates counters/histograms via the Meter API.
 *   User configures their own MeterProvider and exporter (Prometheus, OTLP, etc.).
 * - Without: emits MetricEvent objects via `output()` callback.
 *
 * Session-scoped snapshots are written to `state['observe:metrics']`.
 * Memory management and export format are the OTel SDK's responsibility, not ours.
 *
 * @param opts - Configuration options
 * @returns Middleware
 */
export function observeMetrics(opts?: ObserveMetricsOptions): Middleware {
  const emitOtelGenAI = opts?.otel ?? false
  const customMeter = opts?.meter
  const outputCallback = opts?.output

  let recorder: MetricRecorder | null = null
  let initPromise: Promise<void> | null = null

  async function ensureRecorder(): Promise<MetricRecorder> {
    if (recorder) return recorder

    // Custom meter takes priority
    if (customMeter) {
      recorder = createOtelRecorder(customMeter, emitOtelGenAI)
      return recorder
    }

    // Explicit output callback = standalone mode (user chose this)
    if (outputCallback) {
      recorder = createStandaloneRecorder(outputCallback)
      return recorder
    }

    // Try global MeterProvider
    const otel = await tryImportOtel()
    if (otel) {
      const meter = otel.metrics.getMeter("agent-express")
      recorder = createOtelRecorder(meter, emitOtelGenAI)
      return recorder
    }

    // No OTel, no callback — silent no-op
    recorder = createStandaloneRecorder()
    return recorder
  }

  // Start detection early
  initPromise = ensureRecorder().then(() => {})

  return {
    name: "observe:metrics",

    state: {
      "observe:metrics": {
        default: null as MetricsSnapshot | null,
      },
    },

    async session(ctx: SessionContext, next: () => Promise<void>): Promise<void> {
      await initPromise
      const rec = recorder!

      const snapshot: MetricsSnapshot = {
        modelCalls: 0,
        toolCalls: 0,
        turns: 0,
        errors: 0,
        tokens: { input: 0, output: 0 },
        duration: { session: 0, turns: [], models: [], tools: [] },
      }

      // Write snapshot to state immediately — will be updated in-place by inner hooks
      ctx.state["observe:metrics"] = snapshot

      // Attach snapshot to context for inner hooks to mutate
      ;(ctx as SessionContext & { __metricsSnapshot: MetricsSnapshot }).__metricsSnapshot = snapshot

      const agentName = ctx.agent.name
      const sessionStart = Date.now()

      rec.counterAdd("agent_express_sessions_total", { agent: agentName })

      try {
        await next()
      } catch (err) {
        rec.counterAdd("agent_express_errors_total", {
          agent: agentName,
          error_source: "agent",
          error_type: (err as Error).constructor?.name ?? "Error",
        })
        snapshot.errors++
        throw err
      } finally {
        const durationSec = (Date.now() - sessionStart) / 1000
        rec.histogramRecord("agent_express_session_duration_seconds", { agent: agentName }, durationSec)
        snapshot.duration.session = Date.now() - sessionStart
      }
    },

    async turn(ctx: TurnContext, next: () => Promise<void>): Promise<void> {
      const rec = recorder!
      const snapshot = (ctx as TurnContext & { __metricsSnapshot: MetricsSnapshot }).__metricsSnapshot
      const agentName = ctx.agent.name
      const turnStart = Date.now()

      rec.counterAdd("agent_express_turns_total", { agent: agentName })
      if (snapshot) snapshot.turns++

      try {
        await next()
      } finally {
        const durationSec = (Date.now() - turnStart) / 1000
        rec.histogramRecord("agent_express_turn_duration_seconds", { agent: agentName }, durationSec)
        if (snapshot) snapshot.duration.turns.push(Date.now() - turnStart)
      }
    },

    async model(ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse> {
      const rec = recorder!
      const snapshot = (ctx as ModelContext & { __metricsSnapshot: MetricsSnapshot }).__metricsSnapshot
      const agentName = ctx.agent.name
      const modelStr = ctx.model
      const provider = modelStr.includes("/") ? modelStr.split("/")[0]! : "unknown"
      const modelStart = Date.now()

      rec.counterAdd("agent_express_model_calls_total", { agent: agentName, model: modelStr, provider })

      try {
        const response = await next()

        const durationSec = (Date.now() - modelStart) / 1000
        rec.histogramRecord("agent_express_model_duration_seconds", { agent: agentName, model: modelStr, provider }, durationSec)

        if (response.usage) {
          rec.counterAdd("agent_express_tokens_total", { agent: agentName, direction: "input", model: modelStr }, response.usage.inputTokens)
          rec.counterAdd("agent_express_tokens_total", { agent: agentName, direction: "output", model: modelStr }, response.usage.outputTokens)

          if (emitOtelGenAI) {
            rec.histogramRecord("gen_ai.client.token.usage", { "gen_ai.token.type": "input" }, response.usage.inputTokens)
            rec.histogramRecord("gen_ai.client.token.usage", { "gen_ai.token.type": "output" }, response.usage.outputTokens)
          }
        }

        if (emitOtelGenAI) {
          rec.histogramRecord("gen_ai.client.operation.duration", { "gen_ai.operation.name": "chat" }, durationSec)
        }

        if (snapshot) {
          snapshot.modelCalls++
          snapshot.tokens.input += response.usage?.inputTokens ?? 0
          snapshot.tokens.output += response.usage?.outputTokens ?? 0
          snapshot.duration.models.push(Date.now() - modelStart)
        }

        return response
      } catch (err) {
        rec.counterAdd("agent_express_errors_total", {
          agent: agentName,
          error_source: "model",
          error_type: (err as Error).constructor?.name ?? "Error",
        })
        if (snapshot) snapshot.errors++
        throw err
      }
    },

    async tool(ctx: ToolContext, next: () => Promise<ToolResult>): Promise<ToolResult> {
      const rec = recorder!
      const snapshot = (ctx as ToolContext & { __metricsSnapshot: MetricsSnapshot }).__metricsSnapshot
      const agentName = ctx.agent.name
      const toolName = ctx.tool.name
      const toolStart = Date.now()

      rec.counterAdd("agent_express_tool_calls_total", { agent: agentName, tool: toolName })
      if (snapshot) snapshot.toolCalls++

      try {
        const result = await next()

        const durationSec = (Date.now() - toolStart) / 1000
        rec.histogramRecord("agent_express_tool_duration_seconds", { agent: agentName, tool: toolName }, durationSec)
        if (snapshot) snapshot.duration.tools.push(Date.now() - toolStart)

        if (result.isError) {
          rec.counterAdd("agent_express_errors_total", {
            agent: agentName,
            error_source: "tool",
            error_type: "ToolExecutionError",
          })
          if (snapshot) snapshot.errors++
        }

        return result
      } catch (err) {
        rec.counterAdd("agent_express_errors_total", {
          agent: agentName,
          error_source: "tool",
          error_type: (err as Error).constructor?.name ?? "Error",
        })
        if (snapshot) snapshot.errors++
        throw err
      }
    },
  }
}

/** Create a recorder that uses the OTel Meter API. */
function createOtelRecorder(meter: import("@opentelemetry/api").Meter, emitGenAI: boolean): MetricRecorder {
  const counters = new Map<string, import("@opentelemetry/api").Counter>()
  const histograms = new Map<string, import("@opentelemetry/api").Histogram>()

  function getCounter(name: string): import("@opentelemetry/api").Counter {
    let c = counters.get(name)
    if (!c) {
      c = meter.createCounter(name)
      counters.set(name, c)
    }
    return c
  }

  function getHistogram(name: string): import("@opentelemetry/api").Histogram {
    let h = histograms.get(name)
    if (!h) {
      const buckets = name.includes("model_duration") ? BUCKETS.model
        : name.includes("tool_duration") ? BUCKETS.tool
        : name.includes("turn_duration") ? BUCKETS.turn
        : name.includes("session_duration") ? BUCKETS.session
        : name.includes("gen_ai.client.operation.duration") ? BUCKETS.model
        : BUCKETS.model
      h = meter.createHistogram(name, { advice: { explicitBucketBoundaries: buckets } })
      histograms.set(name, h)
    }
    return h
  }

  // Pre-create standard metrics
  getCounter("agent_express_model_calls_total")
  getCounter("agent_express_tool_calls_total")
  getCounter("agent_express_turns_total")
  getCounter("agent_express_sessions_total")
  getCounter("agent_express_errors_total")
  getCounter("agent_express_tokens_total")
  getHistogram("agent_express_model_duration_seconds")
  getHistogram("agent_express_tool_duration_seconds")
  getHistogram("agent_express_turn_duration_seconds")
  getHistogram("agent_express_session_duration_seconds")
  if (emitGenAI) {
    getHistogram("gen_ai.client.operation.duration")
    getHistogram("gen_ai.client.token.usage")
  }

  return {
    counterAdd(name, attributes, value = 1) {
      getCounter(name).add(value, attributes)
    },
    histogramRecord(name, attributes, value) {
      getHistogram(name).record(value, attributes)
    },
  }
}

/** Create a standalone recorder that emits MetricEvent objects via callback. */
function createStandaloneRecorder(output?: (event: MetricEvent) => void): MetricRecorder {
  const emit = output ?? (() => {})
  return {
    counterAdd(name, attributes, value = 1) {
      emit({ name, type: "counter", attributes, value })
    },
    histogramRecord(name, attributes, value) {
      emit({ name, type: "histogram", attributes, value })
    },
  }
}
