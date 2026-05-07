# Agent Express

Minimalist middleware framework for building AI agents in TypeScript.
Three concepts: `Agent`, `Session`, and `Middleware`. That's the entire framework.

## Quick Reference

- **Build**: `npm run build` (tsup → dist/)
- **Test**: `npm test` (vitest, 629 tests, 76 files)
- **Test with coverage**: `npm run test:coverage` (vitest + @vitest/coverage-v8)
- **Typecheck**: `npm run typecheck` (tsc --noEmit)
- **Lint**: `npx eslint .`

## Architecture

**Core:** Minimal agent loop (model→tool→model cycle only). `Agent` class with `.use()` chainable middleware, explicit `init()`/`dispose()` lifecycle, first-class `Session` for multi-turn, `.run()` convenience shorthand. Single `Middleware` interface with 5 onion hooks: `agent`, `session`, `turn`, `model`, `tool` — all with the same `(ctx, next)` pattern.

**Event log (v0.4):** `Session.events` is the canonical append-only typed event log per session; `Session.history` is a derived `Message[]` view. `ctx.emit({ type, payload })` validates the type+payload against a merged Zod event-type map (core schemas + `Middleware.events` declarations), generates UUIDv7 + ts + schemaVersion, appends in-memory (read-your-writes), and queues durable writes to the configured `SessionStore.appendEvent`. Same `Event` objects (same ids) flow through `session.events`, the `for await ... of agentRun` iterator, and the storage adapter. `memory.store(...)` middleware advertises its backend via the `SESSION_STORE_PROVIDER` symbol; the framework picks it up at `agent.init()`. `turn:end.status` distinguishes `completed` / `interrupted` / `failed`.

**Defaults:** Sensible middleware auto-applied via `defaults()` (retry, usage, tools, duration, maxIterations). Opt-out with `defaults: false`.

**Middleware Namespaces:**
- `model.retry()` — exponential backoff for transient LLM failures
- `model.router()` — complexity-based model routing
- `observe.usage()` — token tracking → `state['observe:usage']`
- `observe.tools()` — tool call recording → `state['observe:tools']`
- `observe.duration()` — turn timing → `state['observe:duration']`
- `observe.log()` — structured JSON logging (level, duration, errors, trace correlation)
- `observe.metrics()` — OpenTelemetry Meter API metrics (Prometheus/OTLP via user-configured exporter)
- `observe.traces()` — OpenTelemetry distributed tracing (framework or GenAI span names)
- `guard.budget()` — USD cost cap per session
- `guard.input()` — input validation before each LLM call
- `guard.output()` — output validation after each LLM response
- `guard.maxIterations()` — loop iteration limit
- `guard.timeout()` — turn/model timeouts
- `guard.approve()` — human-in-the-loop tool approval (`approve`, `deny`, `modify` helpers)
- `guard.piiRedact()` — PII detection and masking with restore for tools (state-based propagation)
- `guard.rateLimit()` — per-session/IP rate limiting with configurable strategies
- `search.file()` — document/knowledge base search (RAG) with tool/auto modes
- `search.web()` — web search tool (Brave, Tavily, Exa adapters)
- `memory.compaction()` — context window management (5 strategies)
- `memory.store()` — session persistence (SQLite, Redis, Postgres, custom)
- `tools.function()` — TypeScript function tools with Zod schemas
- `tools.mcp()` — MCP server connection
- `dev.console()` — full lifecycle terminal trace

**Presets** (separate packages, `@agent-express/*`):
- `@agent-express/preset-support` — `supportBot()` with budget, timeout, PII, tone, escalation, rate limiting

**Adapter packages** (`@agent-express/*`):
- Embed: `embed-openai`, `embed-cohere`
- Search: `search-brave`, `search-tavily`, `search-exa`, `search-qdrant`, `search-pinecone`, `search-pgvector`, `search-llamaindex`
- Session: `session-sqlite`, `session-redis`, `session-postgres`

**RunResult:** Minimal — `{ text, state, data? }`. All metadata in state via middleware.

**Structured Output:** `RunOptions.output` accepts Zod schema → `RunResult.data` returns validated typed object.

## Package Entry Points

```
agent-express       → Agent, Session, defaults, middleware namespaces, errors
agent-express/http  → createHandler() SSE adapter
agent-express/test  → testAgent() declarative test helper
```

## Conventions

- TypeScript strict mode, ESM only
- Node.js 20+
- Vitest for testing
- All middleware uses the same `Middleware` interface
- `agent.use(fn)` shorthand: plain function = turn hook
- `agent.use("model", fn)` scope-specific shorthand for any hook
- `agent.use([...])` accepts middleware arrays (for defaults)
- 5 onion hooks: `agent` (init/dispose), `session` (multi-turn), `turn`, `model`, `tool`
- Tools registered via `ctx.registerTool()` in the `agent` hook
- Defaults auto-applied unless `defaults: false`
- TSDoc comments on ALL public APIs
- Model specified as string: `"anthropic/claude-sonnet-4-6"` (provider/model format)
- All adapters support env var fallback: `config > process.env > error/default`

## Testing Requirements

- **Coverage target**: 85%+ statements for all new code. Current: 89% overall.
- **Per-package tests**: every `packages/*/` must have its own `tests/` directory with tests
- **Mock external APIs**: use `vi.stubGlobal("fetch", mockFetch)` for HTTP, `vi.mock()` for modules (pg, ioredis)
- **No real API calls in tests**: vitest setup blocks outbound requests
- **Test patterns**: use `FunctionModel` for mocking LLM, `Agent` with `defaults: false` for isolation
- **Middleware must be self-contained**: no cross-namespace state reads (e.g., don't read `observe:tools` from a guard middleware). Use own hooks + state for tracking.

## Naming Conventions

- **Namespaces**: `guard.budget()`, `guard.approve()`, `tools.mcp()`, `model.router()`, `observe.usage()`, `observe.metrics()`, `observe.traces()`, `memory.compaction()`, `dev.console()`
- **State keys**: `ctx.state['guard:budget:totalCost']`, `ctx.state['observe:usage']` (namespace:field)
- **Error classes**: `AbortError`, `ModelError`, `SessionClosedError`, `SessionBusyError`, `UserRateLimitError`, etc.
- **Context types**: `AgentContext`, `SessionContext`, `TurnContext`, `ModelContext`, `ToolContext`
- **Internal class**: `SessionState` (runtime in-memory session state, NOT the public `SessionStore` interface)

## Shared Types (src/types.ts)

- `Source` — citation metadata (`title?`, `url?`, `section?`), used by `Chunk.source`
- `Chunk` — retrieved document fragment (`text`, `score?`, `source?: Source`)
- `SearchResult` — web search result (`title`, `url`, `snippet`), independent from Source
- `Event<TType, TPayload>` — typed entry in the event log (`id` UUIDv7, `ts`, `type`, `schemaVersion`, `payload`)
- `EventEnvelope` — on-the-wire shape stored by adapters (adds `sessionId`, `eventId`, `ord` for storage ordering)
- `EventTypeSchema<T>` — declaration of one event type: Zod schema + version
- `EventTypeMap` — record of name → `EventTypeSchema`; declared on `Middleware.events`, merged at agent init
- `SessionStore` — public interface for persistence adapters (`load`, `save`, `delete`, `appendEvent`, `listEvents`)
- `SessionData` — persisted session (`state`, `events: EventEnvelope[]`, `createdAt`, `updatedAt`)
- `PiiMapping` — redaction mapping (`placeholder`, `original`, `type: PiiType | string`)
- `PiiType` — built-in PII types: `"email" | "phone" | "creditCard" | "ssn" | "ip"`

## Project Structure

```
src/
├── agent.ts              # Agent class: init(), session(), run(), dispose(), use()
├── session.ts            # Session class: run(), close(), events, history (derived), state
├── session-store.ts      # SessionState (internal): runtime EventLog + state + lifecycle
├── context.ts            # Context factory functions; emit closure with validation + writer queueing
├── defaults.ts           # defaults() function — standard middleware preset
├── middleware.ts          # Middleware interface, 5 context types, hook types, events field
├── types.ts              # Event, EventEnvelope, EventTypeSchema, EventTypeMap, SessionStore, etc.
├── executor.ts           # composeHooks() onion executor
├── loop.ts               # Minimal agent loop: model → tool → model cycle (emits typed events)
├── run.ts                # AgentRun: AsyncIterable<Event> + .result Promise
├── state.ts              # SessionState with Proxy-based reducers
├── event-log/
│   ├── event-log.ts      # EventLog class + SESSION_STORE_PROVIDER symbol
│   ├── events.ts         # CORE_EVENT_TYPE_MAP — emitted, reserved-emitted, reserved-only
│   ├── id.ts             # nextEventId() — UUIDv7 wrapper
│   ├── validate.ts       # mergeEventTypeMaps + validateEmit (Zod + JSON-replacer guard)
│   ├── derive-history.ts # Pure projection: events[] → Message[] for Session.history
│   ├── writer.ts         # Per-session bounded queue → SessionStore.appendEvent
│   ├── typed-events.ts   # typedEvents() helper — narrowing for read sites
│   └── index.ts          # Public re-exports
├── errors.ts             # Error classes (Abort, Model, Session, Tool, Event* errors)
├── retry.ts              # Shared retry utility
├── token-count.ts        # TokenCounter interface + chars/4 default
├── cli/
│   ├── index.ts          # CLI entry point (commander)
│   ├── dev.ts            # `agent-express dev` — terminal chat + hot reload
│   ├── test.ts           # `agent-express test` — test runner
│   └── vitest-agent-setup.ts  # Vitest setup: blocks real API calls
├── providers/
│   ├── resolve.ts        # "provider/model" string → LanguageModelV3
│   └── adapter.ts        # AI SDK V3 format bridge
├── tools/
│   ├── function.ts       # tools.function() factory
│   └── zod-to-json.ts    # Zod → JSON Schema converter
├── middleware/
│   ├── observe/
│   │   ├── usage.ts      # observe.usage() — token tracking
│   │   ├── tools.ts      # observe.tools() — tool call recording
│   │   ├── duration.ts   # observe.duration() — turn timing
│   │   ├── log.ts        # observe.log() — structured JSON logging
│   │   ├── metrics.ts    # observe.metrics() — OTel Meter API metrics
│   │   ├── traces.ts     # observe.traces() — OTel distributed tracing
│   │   └── otel-api.ts   # OTel API detection helper (shared)
│   ├── model/
│   │   ├── router.ts     # model.router() — complexity routing
│   │   └── retry.ts      # model.retry() — exponential backoff
│   ├── guard/
│   │   ├── budget.ts     # guard.budget() — USD cost tracking
│   │   ├── input.ts      # guard.input() — input validation
│   │   ├── output.ts     # guard.output() — output validation
│   │   ├── max-iterations.ts  # guard.maxIterations() — loop limit
│   │   ├── timeout.ts    # guard.timeout() — turn/model timeouts
│   │   ├── approve.ts    # guard.approve() — HITL tool approval
│   │   ├── pii-redact.ts # guard.piiRedact() — PII masking + restore
│   │   ├── rate-limit.ts # guard.rateLimit() — sliding window
│   │   ├── injection-detector.ts  # injectionDetector() — prompt injection heuristics
│   │   └── pricing.ts    # Model pricing table
│   ├── memory/
│   │   ├── compaction.ts # memory.compaction() — 5 compaction strategies
│   │   └── store.ts      # memory.store() — session persistence
│   ├── search/
│   │   ├── file.ts       # search.file() — document RAG (tool/auto modes)
│   │   └── web.ts        # search.web() — web search tool
│   ├── tools/
│   │   └── mcp.ts        # tools.mcp() — MCP server connection
│   └── dev/
│       └── console.ts    # dev.console() — lifecycle terminal trace
├── http/
│   └── handler.ts        # createHandler() SSE adapter
├── test/
│   ├── index.ts          # Public exports from agent-express/test
│   ├── test-agent.ts     # testAgent() declarative helper
│   ├── test-model.ts     # TestModel for mocking LLM calls
│   ├── function-model.ts # FunctionModel — programmatic model responses
│   ├── capture.ts        # Tool call capture utilities
│   ├── recorder.ts       # Record/replay cassette system
│   ├── snapshot.ts       # Snapshot testing helpers
│   ├── model-utils.ts    # Shared test model utilities
│   └── allow-real-requests.ts  # ALLOW_REAL_REQUESTS flag
└── index.ts              # Public exports + namespace objects

packages/
├── create-agent-express/  # CLI scaffold tool
├── preset-support/        # @agent-express/preset-support (tone, escalation, supportBot)
├── embed-openai/          # OpenAI text-embedding-3-small
├── embed-cohere/          # Cohere embed-v3
├── search-brave/          # Brave Search API
├── search-tavily/         # Tavily Search API
├── search-exa/            # Exa semantic search
├── search-qdrant/         # Qdrant vector DB
├── search-pinecone/       # Pinecone vector DB
├── search-pgvector/       # PostgreSQL pgvector
├── search-llamaindex/     # LlamaIndex.TS file ingestion
├── session-sqlite/        # SQLite via better-sqlite3
├── session-redis/         # Redis via ioredis
└── session-postgres/      # PostgreSQL via pg (Pool + transactions)
```

## CLI Commands

```
npx create-agent-express                         # interactive wizard
npx create-agent-express --template support-bot  # template scaffold
npx create-agent-express --default               # default template, zero prompts
npx agent-express dev [entry]                    # terminal chat + hot reload
npx agent-express test                           # agent test runner (blocks real API calls)
npx agent-express test --ci                      # JUnit XML output for CI
```

## Active Technologies

- TypeScript strict mode, ESM only, Node.js 20+
- `@ai-sdk/provider` (v3) for model abstraction
- `@opentelemetry/api` (optional peer dep) for metrics + traces
- Zod for schema validation
- tsup for building
- Vitest + @vitest/coverage-v8 for testing (89% coverage)
- npm workspaces for monorepo
- better-sqlite3, ioredis, pg as peer deps in adapter packages
