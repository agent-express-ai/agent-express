---
editUrl: false
next: false
prev: false
title: "observe"
---

> `const` **observe**: `object`

## Type Declaration

### duration

> **duration**: () => [`Middleware`](/reference/api/index/interfaces/middleware/) = `observeDuration`

Turn duration timing → state['observe:duration'].

Creates an `observe.duration()` middleware that measures the wall-clock
duration of each turn in milliseconds.

Uses last-write-wins semantics (no reducer), so `ctx.state['observe:duration']`
always reflects the duration of the most recently completed turn.

#### Returns

[`Middleware`](/reference/api/index/interfaces/middleware/)

Middleware that tracks turn duration

#### Example

```typescript
agent.use(observe.duration())

const result = await agent.run("Hello").result
const ms = result.state['observe:duration'] as number
console.log(`Turn took ${ms}ms`)
```

### log

> **log**: (`opts?`) => [`Middleware`](/reference/api/index/interfaces/middleware/) = `observeLog`

Structured JSON logging.

Creates an `observe.log()` middleware that emits structured JSON log events
for every lifecycle phase.

Logs session, turn, model, and tool start/end events as `LogEvent` objects.
By default, writes JSON lines to stderr — suitable for structured logging
pipelines (Datadog, Grafana, ELK, etc.).

Enhanced with: `level`, `agentName`, `turnId`, `durationMs`, `error`,
`traceId`/`spanId` correlation, and opt-in `recordContent`.

#### Parameters

##### opts?

[`ObserveLogOptions`](/reference/api/index/interfaces/observelogoptions/)

Optional configuration

#### Returns

[`Middleware`](/reference/api/index/interfaces/middleware/)

Middleware that logs all lifecycle events

#### Example

```typescript
// Default: JSON lines to stderr
agent.use(observe.log())

// Custom output with level-based routing:
agent.use(observe.log({
  output: (event) => {
    if (event.level === "error") pino.error(event)
    else pino.info(event)
  }
}))

// With content recording (prompts/responses at debug level):
agent.use(observe.log({ recordContent: true }))
```

### metrics

> **metrics**: (`opts?`) => [`Middleware`](/reference/api/index/interfaces/middleware/) = `observeMetrics`

Prometheus/OpenMetrics metrics via OTel Meter API.

Creates an `observe.metrics()` middleware that tracks agent performance metrics
via the `@opentelemetry/api` Meter API.

Two modes:
- With `@opentelemetry/api` installed: creates counters/histograms via the Meter API.
  User configures their own MeterProvider and exporter (Prometheus, OTLP, etc.).
- Without: emits MetricEvent objects via `output()` callback.

Session-scoped snapshots are written to `state['observe:metrics']`.
Memory management and export format are the OTel SDK's responsibility, not ours.

#### Parameters

##### opts?

[`ObserveMetricsOptions`](/reference/api/index/interfaces/observemetricsoptions/)

Configuration options

#### Returns

[`Middleware`](/reference/api/index/interfaces/middleware/)

Middleware

### tools

> **tools**: () => [`Middleware`](/reference/api/index/interfaces/middleware/) = `observeTools`

Tool call recording → state['observe:tools'].

Creates an `observe.tools()` middleware that records every tool execution
in the session, including arguments, results, duration, and errors.

Each tool call is appended to the `observe:tools` state array via a
reducer. The full history of tool calls is available in
`ctx.state['observe:tools']` at any point during the session.

#### Returns

[`Middleware`](/reference/api/index/interfaces/middleware/)

Middleware that records tool call history

#### Example

```typescript
agent.use(observe.tools())

const result = await agent.run("Search for cats").result
const calls = result.state['observe:tools'] as ToolCallRecord[]
for (const call of calls) {
  console.log(`${call.name}: ${call.duration}ms`)
}
```

### traces

> **traces**: (`opts?`) => [`Middleware`](/reference/api/index/interfaces/middleware/) = `observeTraces`

OpenTelemetry-compatible distributed tracing.

Creates an `observe.traces()` middleware that emits OpenTelemetry-compatible spans.

Two modes:
- With `@opentelemetry/api` installed: writes to global TracerProvider
- Without: emits SpanData objects via `output()` callback

Span names use framework terminology by default. Set `otel: true` for
OTel GenAI convention names. GenAI attributes (`gen_ai.*`) are always present
regardless of naming mode.

#### Parameters

##### opts?

[`ObserveTracesOptions`](/reference/api/index/interfaces/observetracesoptions/)

Configuration options

#### Returns

[`Middleware`](/reference/api/index/interfaces/middleware/)

Middleware

### usage

> **usage**: () => [`Middleware`](/reference/api/index/interfaces/middleware/) = `observeUsage`

Token usage tracking → state['observe:usage'].

Creates an `observe.usage()` middleware that accumulates token usage
across all model calls in a session.

Tracks `inputTokens` and `outputTokens` via a reducer that sums deltas
from each model response. The accumulated totals are available in
`ctx.state['observe:usage']` at any point during the session.

#### Returns

[`Middleware`](/reference/api/index/interfaces/middleware/)

Middleware that tracks cumulative token usage

#### Example

```typescript
agent.use(observe.usage())

const result = await agent.run("Hello").result
const usage = result.state['observe:usage'] as Usage
console.log(`Tokens: ${usage.inputTokens} in, ${usage.outputTokens} out`)
```
