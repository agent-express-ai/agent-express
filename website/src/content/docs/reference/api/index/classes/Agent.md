---
editUrl: false
next: false
prev: false
title: "Agent"
---

The core entry point of Agent Express.

An Agent wraps a language model with middleware-based lifecycle hooks.
Create an agent, add middleware with `.use()`, and run it with `.run()`.

## Example

```typescript
const agent = new Agent({
  name: "assistant",
  model: "anthropic/claude-sonnet-4-6",
  instructions: "You are a helpful assistant.",
})

// Multi-turn
await agent.init()
const session = agent.session()
const r = await session.run("Hello!").result
await session.close()
await agent.dispose()

// Convenience one-liner
const { text } = await agent.run("Hello!").result
```

## Constructors

### Constructor

> **new Agent**(`def`): `Agent`

#### Parameters

##### def

[`AgentDef`](/reference/api/index/interfaces/agentdef/)

#### Returns

`Agent`

## Properties

### name

> `readonly` **name**: `string`

Agent name used for debugging and tracing.

## Methods

### \[asyncDispose\]()

> **\[asyncDispose\]**(): `Promise`\<`void`\>

Alias for dispose() — enables `await using agent = new Agent(...)`.

#### Returns

`Promise`\<`void`\>

***

### dispose()

> **dispose**(): `Promise`\<`void`\>

Dispose the agent: auto-closes open sessions, then unwinds the agent
onion triggering cleanup in all middleware (reverse registration order).
Idempotent — safe to call on an uninitialized agent.

#### Returns

`Promise`\<`void`\>

***

### init()

> **init**(): `Promise`\<`void`\>

Explicitly initialize the agent: resolve model, run agent middleware
(connect MCP servers, register tools, etc.). Idempotent.

#### Returns

`Promise`\<`void`\>

#### Example

```typescript
await agent.init()  // MCP servers connect, tools register
```

***

### run()

> **run**(`input`, `opts?`): [`AgentRun`](/reference/api/index/classes/agentrun/)

Convenience: auto-init + create session + single turn + close session.

#### Parameters

##### input

`string`

User message text

##### opts?

[`RunOptions`](/reference/api/index/interfaces/runoptions/)

Optional run options (output schema)

#### Returns

[`AgentRun`](/reference/api/index/classes/agentrun/)

AgentRun (dual interface: streaming + result promise)

#### Example

```typescript
const { text } = await agent.run("Hello!").result
```

***

### session()

> **session**(`opts?`): [`Session`](/reference/api/index/classes/session/)

Create a new session for multi-turn conversation.
Auto-initializes the agent if not already initialized.

#### Parameters

##### opts?

[`SessionOptions`](/reference/api/index/interfaces/sessionoptions/)

Optional session configuration (custom ID for persistence)

#### Returns

[`Session`](/reference/api/index/classes/session/)

A Session object for executing turns

***

### use()

#### Call Signature

> **use**(`middleware`): `this`

Register middleware on this agent. Chainable.

Accepts a `Middleware` object, an array of middleware, a plain function
(treated as a `turn` hook), or a scope + function pair.

##### Parameters

###### middleware

[`Middleware`](/reference/api/index/interfaces/middleware/)

##### Returns

`this`

this agent (for chaining)

#### Call Signature

> **use**(`middlewares`): `this`

Register middleware on this agent. Chainable.

Accepts a `Middleware` object, an array of middleware, a plain function
(treated as a `turn` hook), or a scope + function pair.

##### Parameters

###### middlewares

[`Middleware`](/reference/api/index/interfaces/middleware/)[]

##### Returns

`this`

this agent (for chaining)

#### Call Signature

> **use**(`fn`): `this`

Register middleware on this agent. Chainable.

Accepts a `Middleware` object, an array of middleware, a plain function
(treated as a `turn` hook), or a scope + function pair.

##### Parameters

###### fn

[`TurnHookFn`](/reference/api/index/type-aliases/turnhookfn/)

##### Returns

`this`

this agent (for chaining)

#### Call Signature

> **use**\<`S`\>(`scope`, `fn`): `this`

Register middleware on this agent. Chainable.

Accepts a `Middleware` object, an array of middleware, a plain function
(treated as a `turn` hook), or a scope + function pair.

##### Type Parameters

###### S

`S` *extends* [`HookScope`](/reference/api/index/type-aliases/hookscope/)

##### Parameters

###### scope

`S`

###### fn

`ScopeHookFn`\[`S`\]

##### Returns

`this`

this agent (for chaining)
