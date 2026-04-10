---
editUrl: false
next: false
prev: false
title: "AgentRun"
---

The return value of `agent.run()`. Dual interface inspired by `fetch()`:

- **Streaming**: iterate with `for await (const event of run) { ... }`
- **Await result**: `const result = await run.result`

Both can be used on the same `AgentRun` instance. The `.result` promise
resolves when the session completes (after all events have been emitted).

## Example

```typescript
// Streaming
for await (const event of agent.run({ input: "Hello" })) {
  if (event.type === "model:chunk") process.stdout.write(event.text)
}

// Await result
const { output, cost } = await agent.run({ input: "Hello" }).result
```

## Implements

- `AsyncIterable`\<[`StreamEvent`](/reference/api/index/type-aliases/streamevent/)\>

## Constructors

### Constructor

> **new AgentRun**(`sessionId`): `AgentRun`

#### Parameters

##### sessionId

`string`

#### Returns

`AgentRun`

## Properties

### result

> `readonly` **result**: `Promise`\<[`RunResult`](/reference/api/index/interfaces/runresult/)\>

Promise that resolves to the final `RunResult` when the session completes.
Rejects if the session fails with an unhandled error.

## Methods

### \[asyncIterator\]()

> **\[asyncIterator\]**(): `AsyncIterator`\<[`StreamEvent`](/reference/api/index/type-aliases/streamevent/)\>

Async iterator — yields `StreamEvent`s as they arrive during execution.

#### Returns

`AsyncIterator`\<[`StreamEvent`](/reference/api/index/type-aliases/streamevent/)\>

#### Implementation of

`AsyncIterable.[asyncIterator]`

***

### complete()

> **complete**(`result`): `void`

Signal successful completion. Emits `session:end`, closes the stream,
and resolves the `.result` promise.

#### Parameters

##### result

[`RunResult`](/reference/api/index/interfaces/runresult/)

#### Returns

`void`

***

### emit()

> **emit**(`event`): `void`

Emit a stream event to all iterating consumers. Called by the agent loop.

#### Parameters

##### event

[`StreamEvent`](/reference/api/index/type-aliases/streamevent/)

#### Returns

`void`

***

### fail()

> **fail**(`error`): `void`

Signal failure. Emits an `error` event, closes the stream,
and rejects the `.result` promise.

#### Parameters

##### error

`Error`

#### Returns

`void`
