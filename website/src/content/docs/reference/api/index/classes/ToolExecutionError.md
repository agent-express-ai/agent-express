---
editUrl: false
next: false
prev: false
title: "ToolExecutionError"
---

A tool's `execute()` function threw an error. Wrapped with the tool name for context.

## Extends

- [`AgentExpressError`](/reference/api/index/classes/agentexpresserror/)

## Constructors

### Constructor

> **new ToolExecutionError**(`toolName`, `cause`): `ToolExecutionError`

#### Parameters

##### toolName

`string`

##### cause

`Error`

#### Returns

`ToolExecutionError`

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

Name of the tool that failed.
