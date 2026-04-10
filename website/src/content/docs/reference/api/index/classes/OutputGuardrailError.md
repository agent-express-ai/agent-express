---
editUrl: false
next: false
prev: false
title: "OutputGuardrailError"
---

Thrown when guard.output() blocks a response (if `onBlock: "error"`).

## Extends

- [`AgentExpressError`](/reference/api/index/classes/agentexpresserror/)

## Constructors

### Constructor

> **new OutputGuardrailError**(`reason`): `OutputGuardrailError`

#### Parameters

##### reason

`string`

#### Returns

`OutputGuardrailError`

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

### reason

> `readonly` **reason**: `string`

Reason the response was blocked.

***

### retryable

> `readonly` **retryable**: `boolean`

Whether this error can be retried by retry middleware.

#### Inherited from

[`AgentExpressError`](/reference/api/index/classes/agentexpresserror/).[`retryable`](/reference/api/index/classes/agentexpresserror/#retryable)
