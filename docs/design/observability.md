---
title: Observability
status: shipped
ships-with: v0.2.0+
last-revised: 2026-05-07
audience: contributors
---

# Observability

> Six middleware that record what happens during an agent run: usage,
> tool calls, duration, structured logs, OpenTelemetry metrics, and
> OpenTelemetry distributed traces. All optional, all composable
> through the same `(ctx, next)` pattern, all pluggable into existing
> observability stacks (Prometheus, Grafana, Datadog, Honeycomb, ELK,
> any OTLP receiver).

The framework's design choice: don't build a parallel observability
system. Instead, expose what happens through standard interfaces
(state writes, structured logs, OTel API) and let users wire their
existing stack.

---

## 1. Six middleware, two layers

```
┌──────────────────────────────────────────────────────────────────┐
│  In-memory layer — read via session.state                         │
│                                                                   │
│  observe.usage()        → state["observe:usage"]    token totals │
│  observe.tools()        → state["observe:tools"]    tool calls   │
│  observe.duration()     → state["observe:duration"] turn timings │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Export layer — emits to external observability systems           │
│                                                                   │
│  observe.log()          → JSON lines to stderr / custom sink     │
│  observe.metrics()      → OpenTelemetry Meter API → Prometheus / │
│                            OTLP / standalone callback             │
│  observe.traces()       → OpenTelemetry Tracer API → Jaeger /    │
│                            Honeycomb / OTLP / standalone callback │
└──────────────────────────────────────────────────────────────────┘
```

Layer 1 writes to `session.state` so any code (other middleware,
your application) can read it via well-known keys. This is the
"data is in state, not in events" choice — see
[`event-log.md`](event-log.md) § 17.5 for the rationale (state is a
projection of accumulated effects; duplicating in events would create
two sources of truth for things like usage totals).

Layer 2 exports what's happening to external systems. These are the
pieces that integrate with your production stack.

---

## 2. The three in-memory observers

### 2.1 `observe.usage()` — token totals

Sums `usage` from every `model:end` response into:

```typescript
state["observe:usage"] = {
  inputTokens: number,
  outputTokens: number,
  cacheReadInputTokens: number,
  cacheCreationInputTokens: number,
}
```

Reducer-merged across model calls (see
[`middleware-interface.md`](middleware-interface.md) for state schema
declarations). Lives in
[`src/middleware/observe/usage.ts`](../../src/middleware/observe/usage.ts).
Always in `defaults()`.

### 2.2 `observe.tools()` — tool call records

Every `tool:result` is appended to:

```typescript
state["observe:tools"] = ToolCallRecord[]   // one entry per call

ToolCallRecord = {
  callId: string
  tool: string
  args: Record<string, unknown>
  result: unknown
  isError?: boolean
  durationMs: number
}
```

Used by `testAgent({ expect: { toolsCalled: ["x"] } })` and by
custom assertions. Lives in
[`src/middleware/observe/tools.ts`](../../src/middleware/observe/tools.ts).
Always in `defaults()`.

### 2.3 `observe.duration()` — turn timing

Captures wall-clock duration of each turn:

```typescript
state["observe:duration"] = {
  turnMs: number,        // last turn
  totalMs: number,       // accumulated across all turns
}
```

Lives in
[`src/middleware/observe/duration.ts`](../../src/middleware/observe/duration.ts).
Always in `defaults()`.

These three are nearly free — small synchronous writes per event. The
expensive ones are the export layer.

---

## 3. `observe.log()` — structured JSON logs

```typescript
agent.use(observe.log())
// Default: JSON lines to stderr, one per lifecycle event

agent.use(observe.log({ output: customSink }))
// Custom sink — write to your logger, file, queue
```

Each lifecycle event becomes a `LogEvent`:

```typescript
{
  type: "session:start" | "session:end" | "turn:start" | "turn:end" |
        "model:start" | "model:end" | "tool:start" | "tool:end" | ...
  level: "info" | "warn" | "error",
  agentName: string,
  sessionId: string,
  turnId?: string,
  ts: number,                  // epoch ms
  durationMs?: number,
  error?: { type, message },   // when something failed
  traceId?: string,             // OTel correlation
  spanId?: string,
  // ... event-specific fields
}
```

Three design decisions:

**No content by default.** `recordContent: false` is the default. The
log contains *what happened* (event types, durations, errors) but not
*what was said* (prompts, completions). This is the right default for
production — log volume and PII risk are both bounded. Opt in with
`recordContent: true` for debug environments.

**Trace correlation.** When `observe.traces()` is also active,
`traceId` and `spanId` are populated automatically (read from the
OTel context). One log line correlates to one trace span — you can
jump from log to trace in tools that support it (Datadog, Honeycomb,
Grafana Tempo).

**Structured by default, human-readable optional.** Default output
is JSON lines suitable for log shippers. Pass a custom
`output: (event) => void` to format differently (e.g., pretty-print
for local dev console).

Lives in
[`src/middleware/observe/log.ts`](../../src/middleware/observe/log.ts).

---

## 4. `observe.metrics()` — OpenTelemetry metrics

The most engineered piece. Records 10 standard metrics plus arbitrary
custom mappings, exports through three modes (global OTel provider,
custom Meter, standalone callback).

### 4.1 The 10 standard metrics

```
agent_express_session_total              counter   sessions started
agent_express_session_errors_total       counter   sessions that failed
agent_express_turn_total                 counter   turns executed
agent_express_turn_errors_total          counter   turns that failed
agent_express_turn_duration_seconds      histogram per-turn wall time
agent_express_model_calls_total          counter   model invocations
agent_express_model_duration_seconds     histogram per-model-call wall time
agent_express_model_tokens_total         counter   tokens consumed (input/output/cache)
agent_express_tool_calls_total           counter   tool invocations
agent_express_tool_duration_seconds      histogram per-tool wall time
```

Histogram buckets are tuned for AI agent workloads (10s latency tail
for `model_duration`, 30s for `tool_duration`, 600s for `session`).
See
[`src/middleware/observe/metrics.ts`](../../src/middleware/observe/metrics.ts)
for the bucket arrays.

Each metric has standard attributes: `agent_name`, `model`,
`tool_name` where applicable, `error_source` (model | tool | agent)
on error counters.

### 4.2 GenAI semantic conventions

Optional standard `gen_ai.*` metric names following OpenTelemetry's
emerging GenAI semantic conventions
(<https://opentelemetry.io/docs/specs/semconv/gen-ai/>). Enable with:

```typescript
agent.use(observe.metrics({ genAi: true }))
```

This adds parallel metrics with names like
`gen_ai.client.token.usage` alongside the framework names. You get
both, so dashboards built against either convention work.

### 4.3 Three export modes

**Mode 1 — Global OTel provider** (most common for production):

```typescript
import { metrics as otelMetrics } from "@opentelemetry/api"
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics"
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http"

const provider = new MeterProvider({
  readers: [new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: "https://your-otlp-endpoint" }),
  })],
})
otelMetrics.setGlobalMeterProvider(provider)

agent.use(observe.metrics())   // picks up global provider
```

The middleware looks for a globally-set MeterProvider and uses it. No
config needed.

**Mode 2 — Custom Meter instance**:

```typescript
import { metrics } from "@opentelemetry/api"
const meter = metrics.getMeter("custom-namespace")

agent.use(observe.metrics({ meter }))
```

Useful for multi-tenant scenarios where each tenant has its own
metric namespace, or for routing agent-express metrics to a different
backend than the rest of your app.

**Mode 3 — Standalone callback** (no OTel SDK installed):

```typescript
agent.use(observe.metrics({
  output: (event: MetricEvent) => {
    // event = { name, type: "counter" | "histogram", value, attributes }
    console.log(`metric: ${event.name} = ${event.value}`)
  },
}))
```

Useful for quick local debugging or when you want to push metrics to
something other than OpenTelemetry (e.g., a custom Prometheus
push-gateway). The standalone callback receives every metric event
the middleware would normally feed to the OTel Meter.

### 4.4 `@opentelemetry/api` is an optional peer

`@opentelemetry/api` is an optional peer dependency. The middleware
detects whether it's installed at runtime
([`tryImportOtel`](../../src/middleware/observe/otel-api.ts)). If
installed and a MeterProvider is configured, metrics flow there. If
not installed, the standalone callback works.

This means: zero overhead for users who don't want metrics, no
runtime error if OTel isn't installed.

### 4.5 Custom state-to-metric mappings

For middleware-specific metrics (e.g., RAG chunks retrieved by
`search.file()`):

```typescript
agent.use(observe.metrics({
  custom: [
    {
      stateKey: "search:file:sources",
      metric: "agent_express_rag_chunks_total",
      type: "counter",
      extract: (value) => ({
        value: (value as Source[]).length,
        attributes: { kind: "rag" },
      }),
    },
  ],
}))
```

The middleware reads state at turn end, calls `extract` on the value,
emits the metric. Pluggable without modifying the framework.

---

## 5. `observe.traces()` — distributed tracing

Same structure as `observe.metrics()`: framework-named spans by
default, GenAI convention as opt-in, three export modes, optional
peer dep on `@opentelemetry/api`.

### 5.1 Span hierarchy

```
agent.init                        ←  agent hook before-next
  session.run                     ←  session hook around runs (opt-in)
    turn                          ←  turn hook around one cycle
      model.call                  ←  model hook around each LLM call
      tool.call                   ←  tool hook around each tool exec
      tool.call (parallel sibling)
      model.call (next iteration)
    session.close                 ←  session hook after-next
agent.dispose                     ←  agent hook after-next
```

Two naming tables:

```typescript
// Default (framework names)
{ init: "agent.init", dispose: "agent.dispose", session: "session.run",
  turn: "turn", model: "model.call", tool: "tool.call" }

// OTel GenAI conventions (with otel: true)
{ session: "chat", turn: "agent invoke", model: "chat ${modelId}",
  tool: "execute_tool ${toolName}", ... }
```

GenAI naming follows
<https://opentelemetry.io/docs/specs/semconv/gen-ai/>, so spans
appear correctly in tools that understand the convention (e.g.,
LangSmith, Honeycomb's GenAI views).

### 5.2 Span attributes

`gen_ai.*` attributes follow OTel GenAI conventions when `otel: true`:

```
gen_ai.system: "anthropic" | "openai" | ...
gen_ai.request.model: "claude-sonnet-4-6"
gen_ai.response.model: "claude-sonnet-4-6"
gen_ai.usage.input_tokens: 1234
gen_ai.usage.output_tokens: 567
gen_ai.tool.name: "search"
```

Plus framework-specific attributes (`agent.name`, `session.id`,
`turn.id`).

### 5.3 Trace context propagation

The middleware reads `traceparent` from incoming HTTP requests when
the handler is mounted via `createHandler()` and propagates the
context through the agent loop. Outgoing tool calls (e.g., to MCP
servers) inherit the trace context automatically through the OTel
SDK's normal mechanisms — no extra wiring needed.

This means: a request that arrives at `/api/agent` with a trace ID
shows up as a child span of the upstream service's span. End-to-end
distributed tracing works out of the box.

### 5.4 Standalone mode

Same as metrics — pass `output: (span: SpanData) => void` to receive
span events directly without needing the full OTel SDK installed.

Useful for testing assertions over span shape, or for piping spans to
a custom destination.

---

## 6. Why OpenTelemetry, not a custom format

Three reasons:

1. **Adoption.** OTel is the default observability layer for new
   software in 2025–2026. Datadog, New Relic, Honeycomb, Grafana
   Cloud, Jaeger, Tempo, Lightstep, AWS X-Ray, Azure Monitor,
   Google Cloud Operations — all consume OTel. Building a custom
   format means asking users to adopt your format and write adapters
   for every backend they already have.

2. **GenAI semantic conventions are converging.** OTel's
   `gen_ai.*` namespace is becoming the de-facto vocabulary for
   AI-application observability (LangSmith, OpenAI's own
   instrumentation, Honeycomb's AI views). Aligning with it from day
   one means agent-express agents look "native" in those tools.

3. **Optional peer dep keeps it free.** `@opentelemetry/api` is the
   minimal interface (no SDK, no exporters, no protocol code). At
   ~50KB it's negligible if you use it, and zero overhead if you
   don't (the middleware detects absence and falls back to standalone
   callbacks).

The cost: OTel has a learning curve. We absorb that complexity inside
the middleware so users who want simple metrics get them with one
line (`agent.use(observe.metrics())`), and users who want full
distributed tracing pipelines have all the OTel machinery available.

---

## 7. Putting it together

Typical production stack:

```typescript
agent
  .use(defaults())                    // observe.usage / tools / duration auto
  .use(observe.log({                  // structured JSON logs
    output: (e) => myLogger.info(e),
    recordContent: process.env.DEBUG === "true",
  }))
  .use(observe.metrics({              // OTel metrics with GenAI conventions
    genAi: true,
    custom: [
      { stateKey: "search:file:sources", metric: "rag_chunks_total", type: "counter",
        extract: (v) => ({ value: (v as unknown[]).length }) },
    ],
  }))
  .use(observe.traces({               // OTel traces with GenAI span names
    otel: true,
    recordContent: false,
  }))
  .use(guard.budget({ limit: 10.0 }))
```

Every important agent.run produces:
- 1 trace span tree visible in your APM
- Standard metrics in your Prometheus/OTLP backend
- Structured JSON log lines in your log shipper
- All correlated by `traceId` so you can jump between them

For dev, swap `observe.log` for `dev.console` (the terminal-friendly
trace) and skip the OTel exporters.

---

## 8. Reading the code

- [`src/middleware/observe/usage.ts`](../../src/middleware/observe/usage.ts) — `state["observe:usage"]` reducer
- [`src/middleware/observe/tools.ts`](../../src/middleware/observe/tools.ts) — `state["observe:tools"]` accumulator
- [`src/middleware/observe/duration.ts`](../../src/middleware/observe/duration.ts) — `state["observe:duration"]` timing
- [`src/middleware/observe/log.ts`](../../src/middleware/observe/log.ts) — JSON-line structured logs
- [`src/middleware/observe/metrics.ts`](../../src/middleware/observe/metrics.ts) — OTel Meter API + standalone callback
- [`src/middleware/observe/traces.ts`](../../src/middleware/observe/traces.ts) — OTel Tracer API + standalone callback
- [`src/middleware/observe/otel-api.ts`](../../src/middleware/observe/otel-api.ts) — runtime OTel-API detection helper
- [`src/middleware/dev/console.ts`](../../src/middleware/dev/console.ts) — terminal-friendly dev trace (alternative to `observe.log` for local development)

**Sibling design documents**:
- [`agent-loop.md`](agent-loop.md) § 5 — the hooks reference table
  (`turn`, `model`, `tool`) that every observability middleware plugs
  into
- [`middleware-interface.md`](middleware-interface.md) — the `(ctx, next)`
  contract these middlewares share with every other middleware
- [`event-log.md`](event-log.md) § 17.5 — why state-based observability
  exists alongside the typed event log (the choice between observe.* in
  state and middleware-declared event types)
- [`testing.md`](testing.md) § 5 — `capture` is the test-side analogue
  of `observe.tools()`: same hook, different consumer

**External references**:
- OpenTelemetry semantic conventions for GenAI:
  <https://opentelemetry.io/docs/specs/semconv/gen-ai/>
- OpenTelemetry general docs: <https://opentelemetry.io/docs/>
- W3C Trace Context (the propagation format):
  <https://www.w3.org/TR/trace-context/>
