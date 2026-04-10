---
editUrl: false
next: false
prev: false
title: "ToolContext"
---

Context available during the `tool` hook (wraps one tool execution).

Extends `TurnContext` with tool-specific data and control flow methods:
`deny()` for soft-blocking, `skipCall()` for mocking, `modifyArgs()` for
argument transformation.

## Extends

- [`TurnContext`](/reference/api/index/interfaces/turncontext/)

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

[`TurnContext`](/reference/api/index/interfaces/turncontext/).[`agent`](/reference/api/index/interfaces/turncontext/#agent)

***

### args

> **args**: `Record`\<`string`, `unknown`\>

Arguments from the LLM. Middleware can modify via `modifyArgs()`.

***

### callId

> **callId**: `string`

Tool call ID from the model response.

***

### callIndex

> **callIndex**: `number`

Which tool call within this model response (0-based).

***

### config

> **config**: `Record`\<`string`, `unknown`\>

Middleware-specific configuration from the agent definition.

#### Inherited from

[`TurnContext`](/reference/api/index/interfaces/turncontext/).[`config`](/reference/api/index/interfaces/turncontext/#config)

***

### history

> **history**: [`Message`](/reference/api/index/interfaces/message/)[]

Canonical conversation history (append-only).

#### Inherited from

[`TurnContext`](/reference/api/index/interfaces/turncontext/).[`history`](/reference/api/index/interfaces/turncontext/#history)

***

### input

> **input**: [`Message`](/reference/api/index/interfaces/message/)[]

Input messages for this turn.

#### Inherited from

[`TurnContext`](/reference/api/index/interfaces/turncontext/).[`input`](/reference/api/index/interfaces/turncontext/#input)

***

### output

> **output**: `string` \| `null`

Assistant's final text output for this turn. `null` until the turn completes.

#### Inherited from

[`TurnContext`](/reference/api/index/interfaces/turncontext/).[`output`](/reference/api/index/interfaces/turncontext/#output)

***

### sessionId

> **sessionId**: `string`

Unique session identifier.

#### Inherited from

[`TurnContext`](/reference/api/index/interfaces/turncontext/).[`sessionId`](/reference/api/index/interfaces/turncontext/#sessionid)

***

### startedAt

> **startedAt**: `number`

Timestamp when this turn started.

#### Inherited from

[`TurnContext`](/reference/api/index/interfaces/turncontext/).[`startedAt`](/reference/api/index/interfaces/turncontext/#startedat)

***

### state

> **state**: `Record`\<`string`, `unknown`\>

Session state — typed fields with optional reducers, shared across all turns.

#### Inherited from

[`TurnContext`](/reference/api/index/interfaces/turncontext/).[`state`](/reference/api/index/interfaces/turncontext/#state)

***

### tool

> **tool**: `object`

Tool definition (name, description, schema, approval flag).

#### description

> **description**: `string`

#### jsonSchema

> **jsonSchema**: `Record`\<`string`, `unknown`\>

#### name

> **name**: `string`

#### requireApproval?

> `optional` **requireApproval?**: `boolean` \| ((`args`) => `boolean` \| `Promise`\<`boolean`\>)

***

### turnId

> **turnId**: `string`

Unique turn identifier.

#### Inherited from

[`TurnContext`](/reference/api/index/interfaces/turncontext/).[`turnId`](/reference/api/index/interfaces/turncontext/#turnid)

***

### turnIndex

> **turnIndex**: `number`

Turn number within this session (0-based).

#### Inherited from

[`TurnContext`](/reference/api/index/interfaces/turncontext/).[`turnIndex`](/reference/api/index/interfaces/turncontext/#turnindex)

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

#### Inherited from

[`TurnContext`](/reference/api/index/interfaces/turncontext/).[`abort`](/reference/api/index/interfaces/turncontext/#abort)

***

### approve()

> **approve**(): `void`

Explicitly approve the tool call (reserved for future HITL flows).

#### Returns

`void`

***

### deny()

> **deny**(`reason`): `void`

Deny the tool call. Returns an error message to the LLM so it can adapt.
Does NOT throw — this is a soft failure.

#### Parameters

##### reason

`string`

#### Returns

`void`

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

[`TurnContext`](/reference/api/index/interfaces/turncontext/).[`emit`](/reference/api/index/interfaces/turncontext/#emit)

***

### modifyArgs()

> **modifyArgs**(`newArgs`): `void`

Replace or merge tool call arguments.

#### Parameters

##### newArgs

`Record`\<`string`, `unknown`\>

#### Returns

`void`

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

[`TurnContext`](/reference/api/index/interfaces/turncontext/).[`registerTool`](/reference/api/index/interfaces/turncontext/#registertool)

***

### skipCall()

> **skipCall**(`result`): `void`

Skip tool execution and return a synthetic result (for mocking/testing).

#### Parameters

##### result

[`ToolResult`](/reference/api/index/type-aliases/toolresult/)

#### Returns

`void`
