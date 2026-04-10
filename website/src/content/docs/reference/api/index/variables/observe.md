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

#### Parameters

##### opts?

`ObserveLogOptions`

Optional configuration with custom output function

#### Returns

[`Middleware`](/reference/api/index/interfaces/middleware/)

Middleware that logs all lifecycle events

#### Example

```typescript
// Default: JSON lines to stderr
agent.use(observe.log())

// Custom output (e.g., pino):
agent.use(observe.log({ output: (event) => pino.info(event) }))
```

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
