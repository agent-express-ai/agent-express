---
editUrl: false
next: false
prev: false
title: "Middleware"
---

The middleware interface — the single extension mechanism for Agent Express.

A middleware can implement any subset of 5 onion hooks, all with the same
`(ctx, next)` pattern. Code before `await next()` runs on the way in;
code after runs on the way out.

- **`agent`**: wraps the agent lifetime (init → ... → dispose)
- **`session`**: wraps one `run()` call
- **`turn`**: wraps one user → assistant cycle
- **`model`**: wraps one LLM call
- **`tool`**: wraps one tool execution

Plus 1 declarative property:
- `state`: session state field declarations with defaults and optional reducers

## Example

```typescript
const costTracker: Middleware = {
  name: "cost-tracker",
  state: { totalCost: { default: 0, reducer: (prev, delta) => prev + delta } },
  model: async (ctx, next) => {
    const response = await next()
    ctx.state.totalCost = response.usage.inputTokens * 0.001
    return response
  },
}
```

## Properties

### name

> **name**: `string`

Middleware name for debugging and tracing.

***

### state?

> `optional` **state?**: [`StateSchema`](/reference/api/index/type-aliases/stateschema/)

Session state field declarations with defaults and optional reducers.

## Methods

### agent()?

> `optional` **agent**(`ctx`, `next`): `Promise`\<`void`\>

Wraps the agent lifetime. Code before `next()` = init; code after = dispose.
Register tools via `ctx.registerTool()` before calling `next()`.
Use `try { await next() } finally { cleanup }` for guaranteed resource cleanup.

#### Parameters

##### ctx

[`AgentContext`](/reference/api/index/interfaces/agentcontext/)

##### next

() => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

***

### model()?

> `optional` **model**(`ctx`, `next`): `Promise`\<[`ModelResponse`](/reference/api/index/interfaces/modelresponse/)\>

Wraps a single LLM call. Can modify messages, change model, skip call, or transform response.

#### Parameters

##### ctx

[`ModelContext`](/reference/api/index/interfaces/modelcontext/)

##### next

() => `Promise`\<[`ModelResponse`](/reference/api/index/interfaces/modelresponse/)\>

#### Returns

`Promise`\<[`ModelResponse`](/reference/api/index/interfaces/modelresponse/)\>

***

### session()?

> `optional` **session**(`ctx`, `next`): `Promise`\<`void`\>

Wraps a session (one `run()` call). Code before `next()` = session start; after = session end.

#### Parameters

##### ctx

[`SessionContext`](/reference/api/index/interfaces/sessioncontext/)

##### next

() => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

***

### tool()?

> `optional` **tool**(`ctx`, `next`): `Promise`\<[`ToolResult`](/reference/api/index/type-aliases/toolresult/)\>

Wraps a single tool execution. Can modify args, deny, skip, or transform result.

#### Parameters

##### ctx

[`ToolContext`](/reference/api/index/interfaces/toolcontext/)

##### next

() => `Promise`\<[`ToolResult`](/reference/api/index/type-aliases/toolresult/)\>

#### Returns

`Promise`\<[`ToolResult`](/reference/api/index/type-aliases/toolresult/)\>

***

### turn()?

> `optional` **turn**(`ctx`, `next`): `Promise`\<`void`\>

Wraps a turn (one user message → assistant response cycle).

#### Parameters

##### ctx

[`TurnContext`](/reference/api/index/interfaces/turncontext/)

##### next

() => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>
