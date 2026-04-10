---
editUrl: false
next: false
prev: false
title: "SessionBusyError"
---

Thrown when `session.run()` is called while a turn is already in progress.

## Extends

- [`AgentExpressError`](/reference/api/index/classes/agentexpresserror/)

## Constructors

### Constructor

> **new SessionBusyError**(`sessionId`): `SessionBusyError`

#### Parameters

##### sessionId

`string`

#### Returns

`SessionBusyError`

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

### sessionId

> `readonly` **sessionId**: `string`

ID of the busy session.
