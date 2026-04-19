# agent-express

Minimalist middleware framework for building AI agents in TypeScript.

[![npm version](https://img.shields.io/npm/v/agent-express)](https://www.npmjs.com/package/agent-express)
[![CI](https://img.shields.io/github/actions/workflow/status/agent-express-ai/agent-express/ci.yml?branch=main)](https://github.com/agent-express-ai/agent-express/actions)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

**[Documentation](https://agent-express.ai)** · **[Getting Started](https://agent-express.ai/getting-started/)** · **[API Reference](https://agent-express.ai/reference/api/readme/)**

## Why agent-express

Three concepts: `Agent`, `Session`, and `Middleware`. That's the entire framework.

Every backend developer knows `use()`. Agent Express applies the Express.js middleware pattern to AI agents. One `(ctx, next)` interface replaces the 15-20 concepts you'll find in alternatives. If you've built an Express app, you already know the mental model.

## Quick Start

```bash
npm install agent-express
```

```typescript
import { Agent, tools } from "agent-express"
import { z } from "zod"

const agent = new Agent({
  model: "anthropic/claude-sonnet-4-6",
  instructions: "You are a helpful assistant.",
})

agent.use(tools.function({
  name: "greet",
  description: "Greet someone by name",
  schema: z.object({ name: z.string() }),
  execute: async ({ name }) => `Hello, ${name}!`,
}))

const { text } = await agent.run({ input: "Greet Alice" })
console.log(text)
```

## Features

- **Middleware architecture** -- 5 onion hooks (`agent`, `session`, `turn`, `model`, `tool`), one `(ctx, next)` pattern
- **Built-in guards** -- budget caps, input/output validation, timeouts, iteration limits, HITL approval
- **Observability** -- structured logging, OpenTelemetry metrics and traces, token tracking, tool recording
- **12+ model providers** -- any AI SDK provider via `"provider/model"` string (Anthropic, OpenAI, Google, Mistral, Groq, and more)
- **Model routing** -- complexity-based model selection across providers
- **Memory management** -- context window compaction with 5 strategies
- **Testing toolkit** -- TestModel, FunctionModel, capture, record/replay, snapshots
- **MCP integration** -- connect to MCP servers as tool sources
- **HTTP adapter** -- SSE streaming out of the box
- **CLI** -- `agent-express dev` with hot reload, `agent-express test` with CI output
- **Structured output** -- Zod schema validation on model responses

## Middleware Namespaces

Compose capabilities by stacking middleware:

```typescript
import { Agent, guard, observe, model, memory, dev } from "agent-express"

const agent = new Agent({ model: "anthropic/claude-sonnet-4-6" })

agent
  .use(guard.budget({ limit: 1.00 }))
  .use(guard.approve({ approve: myApprovalFn }))
  .use(observe.usage())
  .use(model.retry())
  .use(memory.compaction({ maxTokens: 8192 }))
  .use(dev.console())
```

| Namespace | Middleware | Description |
|---|---|---|
| `guard` | `budget`, `input`, `output`, `maxIterations`, `timeout`, `approve`, `piiRedact`, `rateLimit` | Safety, cost, and compliance |
| `observe` | `usage`, `tools`, `duration`, `log`, `metrics`, `traces` | Monitoring, metrics, and tracing |
| `search` | `file`, `web` | Document search (RAG) and web search |
| `model` | `retry`, `router` | LLM call management |
| `memory` | `compaction`, `store` | Context window and session persistence |
| `tools` | `function`, `mcp` | Tool registration |
| `dev` | `console` | Development utilities |

**Presets** (separate packages):

| Package | Preset | Description |
|---|---|---|
| `@agent-express/preset-support` | `supportBot()` | Production support bot with RAG, PII, escalation, tone |

## Writing Custom Middleware

A plain function passed to `.use()` becomes a `turn` hook:

```typescript
agent.use(async (ctx, next) => {
  console.log(`Turn ${ctx.turnIndex}: ${ctx.input[0]?.content}`)
  await next()
  console.log(`Response: ${ctx.output}`)
})
```

For multiple hooks, return a `Middleware` object:

```typescript
import type { Middleware } from "agent-express"

const analytics: Middleware = {
  name: "analytics",
  state: {
    "analytics:turns": { default: 0 },
    "analytics:cost": { default: 0, reducer: (prev, delta) => prev + delta },
  },
  turn: async (ctx, next) => {
    ctx.state["analytics:turns"] = ctx.turnIndex + 1
    await next()
  },
  model: async (ctx, next) => {
    const response = await next()
    ctx.state["analytics:cost"] = response.usage.inputTokens * 0.000003
    return response
  },
}

agent.use(analytics)
```

The 5 hooks form an onion — code before `next()` runs on the way in, code after runs on the way out:

```
agent → session → turn → model → [LLM call]
                       → tool  → [tool execution]
```

See built-in middleware for real-world examples:
[guard.budget](src/middleware/guard/budget.ts),
[observe.usage](src/middleware/observe/usage.ts),
[model.retry](src/middleware/model/retry.ts),
[memory.compaction](src/middleware/memory/compaction.ts)

## Sessions and Streaming

Multi-turn conversations with session state:

```typescript
await agent.init()
const session = agent.session()

const r1 = await session.run({ input: "My name is Alice" })
const r2 = await session.run({ input: "What's my name?" })
// r2.text → "Your name is Alice"

await agent.dispose()
```

Streaming events as they happen:

```typescript
for await (const event of agent.run({ input: "Hello" })) {
  if (event.type === "model:chunk") process.stdout.write(event.text)
  if (event.type === "tool:start") console.log(`Calling ${event.tool}...`)
}
```

## Testing

Mock LLM calls in tests with `agent-express/test`:

```typescript
import { TestModel, testAgent } from "agent-express/test"

const model = new TestModel([
  { text: "Hello! How can I help?" },
])

const result = await testAgent(agent, {
  model,
  input: "Hi",
})
expect(result.text).toContain("Hello")
```

Record and replay real API calls:

```typescript
import { RecordModel, ReplayModel } from "agent-express/test"

// Record once (hits real API)
const record = new RecordModel("anthropic/claude-sonnet-4-6")
await agent.run({ input: "test", model: record })
record.save("tests/cassettes/greeting.json")

// Replay forever (no API calls)
const replay = ReplayModel.load("tests/cassettes/greeting.json")
await agent.run({ input: "test", model: replay })
```

## Comparison

| Feature | agent-express | Mastra | Vercel AI SDK | LangChain.js |
|---|---|---|---|---|
| Core concepts | 3 | 15-20 | 5-8 | 30+ |
| Extension model | Middleware `(ctx, next)` | Processors, Tools, Workflows | Hooks, Providers | Chains, Agents, Tools, Memory |
| Built-in testing | Yes | No | No | No |
| Cost control | `guard.budget()` | Manual | Manual | Manual |
| TypeScript | Strict, ESM only | TypeScript | TypeScript | TypeScript |

## Package Entry Points

```
agent-express       -- Agent, Session, middleware namespaces, errors
agent-express/http  -- createHandler() SSE adapter
agent-express/test  -- TestModel, FunctionModel, testAgent()
```

## CLI

```bash
npx create-agent-express                             # interactive wizard
npx create-agent-express --template support-bot      # template scaffold
npx agent-express dev [entry]                       # terminal chat + hot reload
npx agent-express test                              # agent test runner
npx agent-express test --ci                         # JUnit XML output for CI
```

## Links

- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
- [Security Policy](SECURITY.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [License](LICENSE)
