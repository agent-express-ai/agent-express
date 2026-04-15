# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-04-16

### Added

- Universal provider resolver — any `@ai-sdk/*` provider works via `"provider/model"` string (Google, Mistral, Groq, DeepSeek, Amazon Bedrock, Azure, xAI, Cohere, and more)
- `observe.metrics()` — OpenTelemetry Meter API metrics with 10 `agent_express_*` counters and histograms, AI-tuned bucket boundaries, optional `gen_ai.*` standard metrics
- `observe.traces()` — OpenTelemetry distributed tracing with two span naming modes (framework and OTel GenAI conventions), `gen_ai.*` attributes, per-session traceId
- `observe.log()` enhancements — `level`, `durationMs`, `error`, `agentName`, `turnId`, `recordContent`, `traceId`/`spanId` trace correlation
- `@opentelemetry/api` as optional peer dependency (shared by metrics and traces)
- Three export modes for metrics and traces: global OTel provider, custom instance, standalone callback
- `SpanData`, `MetricEvent`, `MetricsSnapshot` types exported from `agent-express`
- Observability production guide in docs

### Changed

- Provider resolver no longer hardcodes Anthropic/OpenAI — dynamically imports any `@ai-sdk/*` package
- `LogEvent` extended with optional fields (backward-compatible)

### Security

- Provider name validation (`/^[a-z][a-z0-9-]*$/`) prevents path traversal in dynamic imports
- `Object.hasOwn()` for provider factory lookup prevents prototype property access
- Tool error messages redacted when `recordContent: false`

## [0.1.0] - 2026-04-06

### Added

- Core engine: `Agent` class with `.use()` chainable middleware, explicit `init()`/`dispose()` lifecycle
- First-class `Session` for multi-turn conversations with state management
- 5 onion middleware hooks: `agent`, `session`, `turn`, `model`, `tool` — all with `(ctx, next)` pattern
- `AgentRun` dual interface: `AsyncIterable<StreamEvent>` + `.result` Promise
- Proxy-based session state with reducer semantics
- Sensible defaults auto-applied via `defaults()` (retry, usage, tools, duration, maxIterations)
- Structured output via `RunOptions.output` with Zod schema validation
- Middleware namespaces:
  - `model.retry()` — exponential backoff for transient LLM failures
  - `model.router()` — complexity-based model routing
  - `observe.usage()` — token tracking
  - `observe.tools()` — tool call recording
  - `observe.duration()` — turn timing
  - `observe.log()` — structured JSON logging
  - `guard.budget()` — USD cost cap per session
  - `guard.input()` — input validation before each LLM call
  - `guard.output()` — output validation after each LLM response
  - `guard.maxIterations()` — loop iteration limit
  - `guard.timeout()` — turn/model timeouts
  - `guard.approve()` — human-in-the-loop tool approval
  - `memory.compaction()` — context window management (5 strategies)
  - `dev.console()` — full lifecycle terminal trace
- `tools.function()` — TypeScript function tools with Zod schemas
- `tools.mcp()` — MCP server connection
- `agent-express/http` — `createHandler()` SSE adapter
- `agent-express/test` — TestModel, FunctionModel, capture, record/replay cassettes, snapshot testing, `testAgent()` helper
- CLI: `agent-express dev` (terminal chat + hot reload), `agent-express test` (test runner with API call blocking)
- `create-agent-express` scaffolder with 4 templates (default, coding, research, support-bot)
