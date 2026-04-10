---
editUrl: false
next: false
prev: false
title: "ToolDeniedError"
---

Thrown when `ctx.deny(reason)` is called in a `tool` hook.

This is a soft failure — the tool is not executed, and the LLM receives
an error message so it can try a different approach. Does not unwind the stack.

## Extends

- [`AgentExpressError`](/reference/api/index/classes/agentexpresserror/)

## Constructors

### Constructor

> **new ToolDeniedError**(`toolName`, `reason`): `ToolDeniedError`

#### Parameters

##### toolName

`string`

##### reason

`string`

#### Returns

`ToolDeniedError`

#### Overrides

[`AgentExpressError`](/reference/api/index/classes/agentexpresserror/).[`constructor`](/reference/api/index/classes/agentexpresserror/#constructor)

## Properties

### cause?

> `readonly` `optional` **cause?**: `Error`

Original error that caused this one, if any.

#### Inherited from

[`AgentExpressError`](/reference/api/index/classes/agentexpresserror/).[`cause`](/reference/api/index/classes/agentexpresserror/#cause)

***

### code

> **code**: `string`

Machine-readable error code (e.g., "ABORT", "RATE_LIMIT", "TOOL_DENIED").

#### Inherited from

[`AgentExpressError`](/reference/api/index/classes/agentexpresserror/).[`code`](/reference/api/index/classes/agentexpresserror/#code)

***

### retryable

> `readonly` **retryable**: `boolean`

Whether this error can be retried by retry middleware.

#### Inherited from

[`AgentExpressError`](/reference/api/index/classes/agentexpresserror/).[`retryable`](/reference/api/index/classes/agentexpresserror/#retryable)

***

### toolName

> `readonly` **toolName**: `string`

Name of the tool that was denied.
