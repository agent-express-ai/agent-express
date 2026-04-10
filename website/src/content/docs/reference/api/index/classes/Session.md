---
editUrl: false
next: false
prev: false
title: "Session"
---

A first-class conversation session.

Created by `agent.session()`. Holds conversation history and state
that persist across multiple turns. Turns execute sequentially.

## Example

```typescript
const session = agent.session()
const r1 = await session.run("Hello").result
const r2 = await session.run("Follow up").result
await session.close()
```

## Properties

### history

> `readonly` **history**: [`Message`](/reference/api/index/interfaces/message/)[]

Flat chronological conversation history, auto-accumulates across turns.

***

### id

> `readonly` **id**: `string`

Unique session identifier.

***

### state

> `readonly` **state**: `Record`\<`string`, `unknown`\>

Session state — read-only for client code. Middleware writes via ctx.state.

## Methods

### \[asyncDispose\]()

> **\[asyncDispose\]**(): `Promise`\<`void`\>

Alias for close() — enables `await using session = agent.session()`.

#### Returns

`Promise`\<`void`\>

***

### close()

> **close**(): `Promise`\<`void`\>

Close the session, triggering session-level middleware cleanup.
Idempotent — safe to call multiple times.

#### Returns

`Promise`\<`void`\>

***

### run()

> **run**(`input`, `opts?`): [`AgentRun`](/reference/api/index/classes/agentrun/)

Execute a single conversational turn.

Returns an `AgentRun` with dual interface: async iterable for streaming,
`.result` Promise for the final `RunResult`.

#### Parameters

##### input

`string`

User message text

##### opts?

[`RunOptions`](/reference/api/index/interfaces/runoptions/)

Optional run options (e.g., output schema)

#### Returns

[`AgentRun`](/reference/api/index/classes/agentrun/)

#### Throws

If the session has been closed

#### Throws

If a turn is already in progress
