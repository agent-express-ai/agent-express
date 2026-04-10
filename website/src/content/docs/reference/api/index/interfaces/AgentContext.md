---
editUrl: false
next: false
prev: false
title: "AgentContext"
---

Context available during the `agent` onion hook.

Provides access to the agent definition and tool registration.
This is the shallowest context — all deeper contexts inherit from it.

## Extended by

- [`SessionContext`](/reference/api/index/interfaces/sessioncontext/)

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

***

### config

> **config**: `Record`\<`string`, `unknown`\>

Middleware-specific configuration from the agent definition.

## Methods

### registerTool()

> **registerTool**(`tool`): `void`

Register a tool on the agent. Call in the `agent` hook before `next()`.

#### Parameters

##### tool

[`Tool`](/reference/api/index/interfaces/tool/)

#### Returns

`void`
