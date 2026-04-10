---
editUrl: false
next: false
prev: false
title: "TurnContext"
---

Context available during the `turn` hook.

Extends `SessionContext` with turn-specific data: input messages,
output, turn ID, and the `abort()` method for hard-stopping.

## Extends

- [`SessionContext`](/reference/api/index/interfaces/sessioncontext/)

## Extended by

- [`ModelContext`](/reference/api/index/interfaces/modelcontext/)
- [`ToolContext`](/reference/api/index/interfaces/toolcontext/)

## Properties

### agent

> **agent**: `object`

Agent definition: name, model, instructions.

#### instructions

> **instructions**: `string`

#### model

> **model**: `string`

#### name

> **name**: `string`

#### Inherited from

[`SessionContext`](/reference/api/index/interfaces/sessioncontext/).[`agent`](/reference/api/index/interfaces/sessioncontext/#agent)

***

### config

> **config**: `Record`\<`string`, `unknown`\>

Middleware-specific configuration from the agent definition.

#### Inherited from

[`SessionContext`](/reference/api/index/interfaces/sessioncontext/).[`config`](/reference/api/index/interfaces/sessioncontext/#config)

***

### history

> **history**: [`Message`](/reference/api/index/interfaces/message/)[]

Canonical conversation history (append-only).

#### Inherited from

[`SessionContext`](/reference/api/index/interfaces/sessioncontext/).[`history`](/reference/api/index/interfaces/sessioncontext/#history)

***

### input

> **input**: [`Message`](/reference/api/index/interfaces/message/)[]

Input messages for this turn.

***

### output

> **output**: `string` \| `null`

Assistant's final text output for this turn. `null` until the turn completes.

***

### sessionId

> **sessionId**: `string`

Unique session identifier.

#### Inherited from

[`SessionContext`](/reference/api/index/interfaces/sessioncontext/).[`sessionId`](/reference/api/index/interfaces/sessioncontext/#sessionid)

***

### startedAt

> **startedAt**: `number`

Timestamp when this turn started.

***

### state

> **state**: `Record`\<`string`, `unknown`\>

Session state — typed fields with optional reducers, shared across all turns.

#### Inherited from

[`SessionContext`](/reference/api/index/interfaces/sessioncontext/).[`state`](/reference/api/index/interfaces/sessioncontext/#state)

***

### turnId

> **turnId**: `string`

Unique turn identifier.

***

### turnIndex

> **turnIndex**: `number`

Turn number within this session (0-based).

## Methods

### abort()

> **abort**(`reason`): `never`

Hard-stop the turn. Throws `AbortError` that unwinds the entire onion stack.

#### Parameters

##### reason

`string`

#### Returns

`never`

#### Throws

***

### emit()

> **emit**(`event`): `void`

Emit a stream event to the consumer.

#### Parameters

##### event

[`StreamEvent`](/reference/api/index/type-aliases/streamevent/)

#### Returns

`void`

#### Inherited from

[`SessionContext`](/reference/api/index/interfaces/sessioncontext/).[`emit`](/reference/api/index/interfaces/sessioncontext/#emit)

***

### registerTool()

> **registerTool**(`tool`): `void`

Register a tool on the agent. Call in the `agent` hook before `next()`.

#### Parameters

##### tool

[`Tool`](/reference/api/index/interfaces/tool/)

#### Returns

`void`

#### Inherited from

[`SessionContext`](/reference/api/index/interfaces/sessioncontext/).[`registerTool`](/reference/api/index/interfaces/sessioncontext/#registertool)
