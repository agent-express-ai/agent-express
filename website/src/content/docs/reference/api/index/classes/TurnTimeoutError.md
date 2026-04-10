---
editUrl: false
next: false
prev: false
title: "TurnTimeoutError"
---

Thrown when a turn or model call exceeds its time limit.

## Extends

- [`AgentExpressError`](/reference/api/index/classes/agentexpresserror/)

## Constructors

### Constructor

> **new TurnTimeoutError**(`timeoutMs`, `scope`): `TurnTimeoutError`

#### Parameters

##### timeoutMs

`number`

##### scope

`"turn"` \| `"model"`

#### Returns

`TurnTimeoutError`

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

### scope

> `readonly` **scope**: `"turn"` \| `"model"`

Whether this was a turn timeout or model call timeout.

***

### timeoutMs

> `readonly` **timeoutMs**: `number`

Timeout that was exceeded, in milliseconds.
