# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — v0.4.0 (Event Log Foundation)

> Spec: `specs/011-event-log-foundation/`. Driven by Feature 010 from the v0.4 roadmap.

### BREAKING CHANGES

- **Removed `@agent-express/session-openai`.** The OpenAI Conversation API stores messages, not events, and is fundamentally incompatible with the v0.4 event-log session model. Migrate to `@agent-express/session-sqlite`, `session-redis`, or `session-postgres`. Existing v0.3 on-disk session data is not expected to load on v0.4.
- **`Session.history` is now a derived view.** The framework no longer maintains a separate authoritative `Message[]` array. The `Session.history` getter returns the same `{ role, content }[]` shape as v0.3, computed from the new `Session.events` log on read. Code that read `session.history` keeps working unchanged. Code that mutated internal `SessionState.history` directly will break — read via the public `Session.events` / `Session.history` surface instead.

### Added

- `Session.events` — canonical append-only typed event log per session.
- `Middleware.events` field — middleware authors declare event-type schemas (Zod) parallel to the existing `state` field. Schemas merge at agent construction; collisions throw `EventTypeCollisionError`.
- Core event vocabulary with Zod-validated payloads: `user:input`, `model:start/chunk/end/response`, `tool:call/result`, `turn:start`, `turn:end` (with three-way `status: "completed" | "interrupted" | "failed"` enum), `error`. Plus reserved-emitted `tool:progress` and reserved-only types for upcoming features (`compaction:applied`, `agent:handoff/delegate`, `permission:approved/denied/modified`, `turn:diff`, `turn:plan`, `model:reasoning:chunk/end`).
- `typedEvents(events, schema, type)` helper for narrowing reads to a specific event type.
- `expectEventTypes(events, types)`, `expectEventPayload(events, type)`, `countEvents(events, type)` test helpers in `agent-express/test`.
- `SESSION_STORE_PROVIDER` symbol — middlewares advertise a `SessionStore` to the framework via this symbol; `memory.store(...)` sets it automatically.
- `EventLog.replay(events)` — idempotent rehydration helper used by `memory.store(...)` to replay prior events into a session on resume.
- New error classes: `EventOutsideSessionError`, `EventTypeCollisionError`, `EventValidationError`, `EventSerializationError`, `UnknownEventTypeError`, `EventStoreWriteError`.

### Changed

- `SessionStore` interface adds `appendEvent(sessionId, envelope)` and `listEvents(sessionId, opts?)` for events-aware persistence; `(session_id, event_id)` uniqueness is the load-bearing invariant. `SessionData` carries `events: EventEnvelope[]` instead of `history: Message[]`.
- `session-sqlite`, `session-redis`, `session-postgres` adapters store events in their respective backends with idempotent re-emit (re-write of the same event ID is a no-op).
- Durability: best-effort within the turn boundary (Codex-pattern). Events reach the storage adapter via buffered I/O before `turn:end` is acknowledged. No `fsync` per event. SQLite WAL=NORMAL, Postgres default `synchronous_commit`, Redis AOF=everysec.

### Cross-references

- Anthropic Managed Agents architectural alignment: `docs/research/anthropic-managed-agents-architecture.md`
- OpenAI Codex `thread-store` cross-validation: `docs/research/codex-architecture-research.md` and `specs/011-event-log-foundation/spec.md` Appendix A
- Event vocabulary comparison vs Codex `app-server`: `specs/011-event-log-foundation/spec.md` Appendix A.7

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
