---
editUrl: false
next: false
prev: false
title: "ModelContext"
---

Context available during the `model` hook (wraps one LLM call).

Extends `TurnContext` with mutable messages, model selection,
tool definitions, and short-circuit methods.

`messages` is a **mutable copy** prepared for this specific LLM call —
middleware can truncate, inject, or reorder without affecting `SessionContext.history`.

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

### callIndex

> **callIndex**: `number`

Which model call in this turn (0-based).

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

### messages

> **messages**: [`Message`](/reference/api/index/interfaces/message/)[]

Mutable message array for this LLM call. Middleware can modify freely.

***

### model

> **model**: `string`

Model identifier. Middleware can override via `setModel()`.

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

### toolDefs

> **toolDefs**: `object`[]

Tool schemas sent to the LLM. Middleware can filter via `removeTools()`.

#### description

> **description**: `string`

#### jsonSchema

> **jsonSchema**: `Record`\<`string`, `unknown`\>

#### name

> **name**: `string`

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

### addMessage()

> **addMessage**(`msg`): `void`

Append a message to the messages array.

#### Parameters

##### msg

[`Message`](/reference/api/index/interfaces/message/)

#### Returns

`void`

***

### addSystemMessage()

> **addSystemMessage**(`text`): `void`

Prepend a system message to the messages array.

#### Parameters

##### text

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

### removeTools()

> **removeTools**(...`names`): `void`

Remove tools by name from this call's tool definitions.

#### Parameters

##### names

...`string`[]

#### Returns

`void`

***

### setModel()

> **setModel**(`model`): `void`

Override the model for this call only.

#### Parameters

##### model

`string`

#### Returns

`void`

***

### skipCall()

> **skipCall**(`response`): `void`

Skip the LLM call entirely and return a synthetic response.
Used for caching — the cached response is returned without calling the provider.

#### Parameters

##### response

[`ModelResponse`](/reference/api/index/interfaces/modelresponse/)

#### Returns

`void`
