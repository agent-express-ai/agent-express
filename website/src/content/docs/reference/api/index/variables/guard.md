---
editUrl: false
next: false
prev: false
title: "guard"
---

> `const` **guard**: `object`

## Type Declaration

### approve

> **approve**: (`config`) => [`Middleware`](/reference/api/index/interfaces/middleware/) = `guardApprove`

Human-in-the-loop tool approval.

Creates a `guard.approve()` middleware for human-in-the-loop tool approval.

Intercepts tool calls before execution for tools with `requireApproval` set.
Delegates to the developer-supplied approval function which can approve, deny,
or modify the tool call.

#### Parameters

##### config

[`ApproveConfig`](/reference/api/index/interfaces/approveconfig/)

Approval configuration with the handler function

#### Returns

[`Middleware`](/reference/api/index/interfaces/middleware/)

Middleware with a tool hook

#### Example

```typescript
import { approve, deny, modify } from "agent-express"

agent.use(guard.approve({
  approve: async (toolName, args) => {
    if (toolName === "delete_all") return deny("Blocked")
    return approve()
  },
}))
```

### budget

> **budget**: (`config`) => [`Middleware`](/reference/api/index/interfaces/middleware/) = `budgetGuard`

USD cost cap per session.

Creates a `guard.budget()` middleware that enforces a per-session USD cost limit.

Tracks accumulated cost across all model calls using token counts from LLM
responses multiplied by per-model pricing (USD per 1M tokens).

#### Parameters

##### config

[`BudgetConfig`](/reference/api/index/interfaces/budgetconfig/)

Budget configuration with USD limit and optional pricing overrides

#### Returns

[`Middleware`](/reference/api/index/interfaces/middleware/)

Middleware that enforces cost limits

#### Example

```typescript
// Default: throws BudgetExceededError
agent.use(guard.budget({ limit: 0.50 }))

// Graceful stop: turn ends with empty text
agent.use(guard.budget({ limit: 0.50, onLimit: "stop" }))

// Custom handler:
agent.use(guard.budget({
  limit: 1.00,
  onLimit: (ctx, cost) => "Sorry, I've reached my budget limit.",
}))
```

### input

> **input**: (`validator`) => [`Middleware`](/reference/api/index/interfaces/middleware/) = `inputGuard`

Validate input before each LLM call.

Creates a `guard.input()` middleware that validates input before each LLM call.

Runs in the `model` hook before `next()`. If the validator returns `{ ok: false }`,
throws `InputGuardrailError`. If it returns modified messages, those replace
the originals for this model call.

#### Parameters

##### validator

[`InputValidator`](/reference/api/index/type-aliases/inputvalidator/)

Async or sync validation function receiving ModelContext

#### Returns

[`Middleware`](/reference/api/index/interfaces/middleware/)

Middleware that validates input before each LLM call

#### Example

```typescript
agent.use(guard.input(async (ctx) => {
  if (ctx.messages.some(m => typeof m.content === "string" && m.content.includes("ignore previous"))) {
    return { ok: false, reason: "Potential prompt injection" }
  }
  return { ok: true }
}))
```

### maxIterations

> **maxIterations**: (`max`) => [`Middleware`](/reference/api/index/interfaces/middleware/) = `guardMaxIterations`

Limit model→tool→model iterations per turn.

Creates a `guard.maxIterations()` middleware that limits the number of
model calls per turn.

Prevents runaway agent loops where the model repeatedly calls tools without
converging. Uses a closure-based counter (not session state) that resets at
the start of each turn.

When the limit is reached, the middleware strips tool calls from the last
response so no unnecessary tool executions happen. If the model produced no
text, the turn completes with an empty string.

#### Parameters

##### max?

`number` = `25`

Maximum model calls allowed per turn. Default: 25.

#### Returns

[`Middleware`](/reference/api/index/interfaces/middleware/)

Middleware that enforces per-turn iteration limits

#### Example

```typescript
agent.use(guard.maxIterations())    // default: 25
agent.use(guard.maxIterations(10))  // custom limit
```

### output

> **output**: (`validatorOrConfig`) => [`Middleware`](/reference/api/index/interfaces/middleware/) = `outputGuard`

Validate output after each LLM response.

Creates a `guard.output()` middleware that validates each model response
BEFORE tool calls are executed.

Accepts either a validator function (shorthand) or a config object (full control).

#### Parameters

##### validatorOrConfig

[`OutputGuardConfig`](/reference/api/index/interfaces/outputguardconfig/) \| [`OutputValidator`](/reference/api/index/type-aliases/outputvalidator/)

#### Returns

[`Middleware`](/reference/api/index/interfaces/middleware/)

#### Example

```typescript
// Shorthand — blocked responses are replaced by default
agent.use(guard.output(async (response, ctx) => {
  if (response.toolCalls?.some(tc => tc.toolName === "delete_all")) {
    return { ok: false, reason: "Dangerous tool call blocked" }
  }
  return { ok: true }
}))

// Full config — throw on block
agent.use(guard.output({
  validate: myValidator,
  onBlock: "error",
}))
```

### timeout

> **timeout**: (`config`) => [`Middleware`](/reference/api/index/interfaces/middleware/) = `guardTimeout`

Turn and model call timeouts.

Creates a `guard.timeout()` middleware that enforces time limits on turns
and individual model calls.

Throws `TurnTimeoutError` when a limit is exceeded. Timeouts are cleaned up
via `try/finally` to prevent resource leaks.

#### Parameters

##### config?

[`TimeoutConfig`](/reference/api/index/interfaces/timeoutconfig/) = `{}`

Timeout configuration. Defaults: turn 120s, model 60s.

#### Returns

[`Middleware`](/reference/api/index/interfaces/middleware/)

Middleware that enforces time limits

#### Example

```typescript
agent.use(guard.timeout())                              // defaults: turn 2min, model 1min
agent.use(guard.timeout({ turn: 30_000 }))              // custom turn, default model
agent.use(guard.timeout({ turn: 30_000, model: 10_000 })) // both custom
```
