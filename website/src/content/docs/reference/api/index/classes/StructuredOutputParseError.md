---
editUrl: false
next: false
prev: false
title: "StructuredOutputParseError"
---

Thrown when the model returns text that is not valid JSON for structured output.

## Extends

- [`AgentExpressError`](/reference/api/index/classes/agentexpresserror/)

## Constructors

### Constructor

> **new StructuredOutputParseError**(`rawText`): `StructuredOutputParseError`

#### Parameters

##### rawText

`string`

#### Returns

`StructuredOutputParseError`

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

### rawText

> `readonly` **rawText**: `string`

The raw text the model returned.

***

### retryable

> `readonly` **retryable**: `boolean`

Whether this error can be retried by retry middleware.

#### Inherited from

[`AgentExpressError`](/reference/api/index/classes/agentexpresserror/).[`retryable`](/reference/api/index/classes/agentexpresserror/#retryable)
