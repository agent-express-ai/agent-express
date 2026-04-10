---
editUrl: false
next: false
prev: false
title: "SessionContext"
---

Context available during the `session` hook.

Extends `AgentContext` with session-level data: session ID, state,
conversation history, and event emission.

## Extends

- [`AgentContext`](/reference/api/index/interfaces/agentcontext/)

## Extended by

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

[`AgentContext`](/reference/api/index/interfaces/agentcontext/).[`agent`](/reference/api/index/interfaces/agentcontext/#agent)

***

### config

> **config**: `Record`\<`string`, `unknown`\>

Middleware-specific configuration from the agent definition.

#### Inherited from

[`AgentContext`](/reference/api/index/interfaces/agentcontext/).[`config`](/reference/api/index/interfaces/agentcontext/#config)

***

### history

> **history**: [`Message`](/reference/api/index/interfaces/message/)[]

Canonical conversation history (append-only).

***

### sessionId

> **sessionId**: `string`

Unique session identifier.

***

### state

> **state**: `Record`\<`string`, `unknown`\>

Session state — typed fields with optional reducers, shared across all turns.

## Methods

### emit()

> **emit**(`event`): `void`

Emit a stream event to the consumer.

#### Parameters

##### event

[`StreamEvent`](/reference/api/index/type-aliases/streamevent/)

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

[`AgentContext`](/reference/api/index/interfaces/agentcontext/).[`registerTool`](/reference/api/index/interfaces/agentcontext/#registertool)
