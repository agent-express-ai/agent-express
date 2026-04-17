# Agent Express

Minimalist middleware framework for building AI agents in TypeScript.
Three concepts: `Agent`, `Session`, and `Middleware`. That's the entire framework.

## Quick Reference

- **Build**: `npm run build` (tsup → dist/)
- **Test**: `npm test` (vitest, 247 tests)
- **Typecheck**: `npm run typecheck` (tsc --noEmit)
- **Lint**: `npx eslint .`

## Architecture

**Core:** Minimal agent loop (model→tool→model cycle only). `Agent` class with `.use()` chainable middleware, explicit `init()`/`dispose()` lifecycle, first-class `Session` for multi-turn, `.run()` convenience shorthand. Single `Middleware` interface with 5 onion hooks: `agent`, `session`, `turn`, `model`, `tool` — all with the same `(ctx, next)` pattern.

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
- `memory.compaction()` — context window management (5 strategies)
- `tools.function()` — TypeScript function tools with Zod schemas
- `tools.mcp()` — MCP server connection
- `dev.console()` — full lifecycle terminal trace

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
- Vitest for testing (TDD per constitution)
- All middleware uses the same `Middleware` interface
- `agent.use(fn)` shorthand: plain function = turn hook
- `agent.use("model", fn)` scope-specific shorthand for any hook
- `agent.use([...])` accepts middleware arrays (for defaults)
- 5 onion hooks: `agent` (init/dispose), `session` (multi-turn), `turn`, `model`, `tool`
- Tools registered via `ctx.registerTool()` in the `agent` hook
- Defaults auto-applied unless `defaults: false`
- TSDoc comments on ALL public APIs
- Model specified as string: `"anthropic/claude-sonnet-4-6"` (provider/model format)

## Naming Conventions

- **Namespaces**: `guard.budget()`, `guard.approve()`, `tools.mcp()`, `model.router()`, `observe.usage()`, `observe.metrics()`, `observe.traces()`, `memory.compaction()`, `dev.console()`
- **State keys**: `ctx.state['guard:budget:totalCost']`, `ctx.state['observe:usage']` (namespace:field)
- **Error classes**: `AbortError`, `ModelError`, `SessionClosedError`, `SessionBusyError`, etc.
- **Context types**: `AgentContext`, `SessionContext`, `TurnContext`, `ModelContext`, `ToolContext`

## Project Structure

```
src/
├── agent.ts              # Agent class: init(), session(), run(), dispose(), use()
├── session.ts            # Session class: run(), close(), history, state
├── session-store.ts      # SessionStore (internal): state management, history
├── context.ts            # Context type definitions
├── defaults.ts           # defaults() function — standard middleware preset
├── middleware.ts          # Middleware interface, 5 context types, hook types
├── types.ts              # AgentDef, RunResult, RunOptions, SessionOptions, etc.
├── executor.ts           # composeHooks() onion executor
├── loop.ts               # Minimal agent loop: model → tool → model cycle
├── run.ts                # AgentRun: AsyncIterable<StreamEvent> + .result Promise
├── state.ts              # SessionState with Proxy-based reducers
├── events.ts             # EventBus async iterator
├── errors.ts             # Error classes (Abort, Model, Session, Tool errors)
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
│   │   └── pricing.ts    # Model pricing table
│   ├── memory/
│   │   └── compaction.ts # memory.compaction() — 5 compaction strategies
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

packages/create-agent-express/
├── src/
│   ├── index.ts           # CLI entry point
│   ├── ai-scaffold.ts    # AI scaffold (disabled, kept for future use)
│   ├── template-scaffold.ts  # Static template scaffold
│   ├── browser-auth.ts   # Browser-based auth
│   └── prompts.ts        # Interactive prompts
└── templates/             # 4 project templates
    ├── default/           # Minimal agent starter
    ├── coding/            # Coding assistant
    ├── research/          # Research agent
    └── support-bot/       # Support bot with tools
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
- TypeScript strict mode, ESM only, Node.js 20+ + `@ai-sdk/provider` (v3), `@opentelemetry/api` (optional peer dep), Zod, tsup (009-providers-observability)
- N/A (metrics are in-memory, reset on restart) (009-providers-observability)
- TypeScript strict mode, ESM only, Node.js 20+ + `agent-express` (core), `llamaindex` (RAG via adapter), `@opentelemetry/api` (existing peer dep) (010-support-bot-preset)
- SQLite/Redis/Postgres for session persistence (via adapter packages) (010-support-bot-preset)
