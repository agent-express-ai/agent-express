# Agent Express API Reference

Agent Express is a minimalist middleware framework for building AI agents in TypeScript.
Two concepts: `Agent` and `Middleware`.

## Core API

### Agent

```typescript
import { Agent } from "agent-express"

const agent = new Agent({
  name: "my-agent",
  model: "anthropic/claude-sonnet-4-6",
  instructions: "System prompt here.",
  // defaults: true (auto-applies retry, usage tracking, etc.)
  // defaults: false (bare minimum, for testing)
})

// Add middleware
agent.use(middleware)

// Run (one-liner)
const { text } = await agent.run("Hello").result

// Multi-turn session
await agent.init()
const session = agent.session()
const r1 = await session.run("Hello").result
const r2 = await session.run("Follow up").result
await session.close()
await agent.dispose()
```

### Middleware Interface

All middleware implements the same interface with 5 onion hooks:

```typescript
interface Middleware {
  name: string
  agent?(ctx: AgentContext, next: () => Promise<void>): Promise<void>
  session?(ctx: SessionContext, next: () => Promise<void>): Promise<void>
  turn?(ctx: TurnContext, next: () => Promise<void>): Promise<void>
  model?(ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse>
  tool?(ctx: ToolContext, next: () => Promise<ToolResult>): Promise<ToolResult>
}
```

Context hierarchy: `AgentContext -> SessionContext -> TurnContext -> ModelContext / ToolContext`

## Built-in Middleware

### tools.function() -- Register tools

```typescript
import { tools } from "agent-express"
import { z } from "zod"

agent.use(tools.function({
  name: "get_weather",
  description: "Get weather for a city",
  schema: z.object({ city: z.string() }),
  execute: async ({ city }) => `Sunny in ${city}`,
}))
```

### guard.budget() -- Cost cap

```typescript
import { guard } from "agent-express"
agent.use(guard.budget({ limit: 1.0 }))
```

### guard.input() -- Input validation

```typescript
agent.use(guard.input(async (ctx) => {
  // return { ok: true } or { ok: false, reason: "..." }
}))
```

### guard.output() -- Output validation

```typescript
agent.use(guard.output(async (response, ctx) => {
  // return { ok: true } or { ok: true, output: "redacted" } or { blocked: true, reason: "..." }
}))
```

### guard.approve() -- Tool approval (HITL)

```typescript
import { guard, approve, deny, modify } from "agent-express"

agent.use(guard.approve({
  approve: async (toolName, args, ctx) => {
    if (toolName === "dangerous_tool") return deny("Not allowed")
    return approve()
  },
}))
```

### guard.timeout() -- Time limits

```typescript
agent.use(guard.timeout({ turn: 30_000, model: 10_000 }))
```

### model.router() -- Complexity routing

```typescript
import { model } from "agent-express"
agent.use(model.router({
  routes: {
    simple: "anthropic/claude-haiku-3-5",
    medium: "anthropic/claude-sonnet-4-6",
    complex: "anthropic/claude-opus-4-6",
  },
}))
```

### memory.compaction() -- Context window management

```typescript
import { memory } from "agent-express"
agent.use(memory.compaction({ maxTokens: 8192, strategy: "truncate" }))
```

### observe.log() -- Structured logging

```typescript
import { observe } from "agent-express"
agent.use(observe.log())
```

### dev.console() -- Terminal trace

```typescript
import { dev } from "agent-express"
agent.use(dev.console())
```

## Testing

```typescript
import { TestModel, FunctionModel, testAgent } from "agent-express/test"

// TestModel: auto-calls all tools, then returns "test response"
const agent = new Agent({
  name: "test",
  model: new TestModel(),
  instructions: "...",
  defaults: false,
})

// FunctionModel: callback-based, full control
const agent = new Agent({
  name: "test",
  model: new FunctionModel((messages, { tools, callIndex }) => {
    if (callIndex === 0) return { toolCalls: [...], usage: { inputTokens: 0, outputTokens: 0 }, finishReason: "tool-calls" }
    return { text: "Done!", usage: { inputTokens: 0, outputTokens: 0 }, finishReason: "stop" }
  }),
  instructions: "...",
  defaults: false,
})

// testAgent: declarative assertions
const result = await testAgent(agent, {
  input: "Hello",
  expect: { outputContains: "test response", toolsCalled: ["get_weather"] },
})
```

## Project Structure

```
src/agent.ts        -- Agent definition with middleware
tests/*.test.ts     -- Tests using TestModel / FunctionModel
package.json        -- Scripts: dev, test
.env                -- API keys (never commit)
```
