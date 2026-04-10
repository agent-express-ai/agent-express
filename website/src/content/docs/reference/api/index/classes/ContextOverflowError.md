---
editUrl: false
next: false
prev: false
title: "ContextOverflowError"
---

The prompt exceeded the model's context window. Retryable after truncation.

## Extends

- [`ModelError`](/reference/api/index/classes/modelerror/)

## Constructors

### Constructor

> **new ContextOverflowError**(`provider`, `cause?`): `ContextOverflowError`

#### Parameters

##### provider

`string`

##### cause?

`Error`

#### Returns

`ContextOverflowError`

#### Overrides

[`ModelError`](/reference/api/index/classes/modelerror/).[`constructor`](/reference/api/index/classes/modelerror/#constructor)

## Properties

### cause?

> `readonly` `optional` **cause?**: `Error`

Original error that caused this one, if any.

#### Inherited from

[`ModelError`](/reference/api/index/classes/modelerror/).[`cause`](/reference/api/index/classes/modelerror/#cause)

***

### code

> **code**: `string`

Machine-readable error code (e.g., "ABORT", "RATE_LIMIT", "TOOL_DENIED").

#### Inherited from

[`ModelError`](/reference/api/index/classes/modelerror/).[`code`](/reference/api/index/classes/modelerror/#code)

***

### provider

> `readonly` **provider**: `string`

Provider name (e.g., "anthropic", "openai").

#### Inherited from

[`ModelError`](/reference/api/index/classes/modelerror/).[`provider`](/reference/api/index/classes/modelerror/#provider)

***

### retryable

> `readonly` **retryable**: `boolean`

Whether this error can be retried by retry middleware.

#### Inherited from

[`ModelError`](/reference/api/index/classes/modelerror/).[`retryable`](/reference/api/index/classes/modelerror/#retryable)

***

### statusCode?

> `readonly` `optional` **statusCode?**: `number`

HTTP status code from the provider API, if available.

#### Inherited from

[`ModelError`](/reference/api/index/classes/modelerror/).[`statusCode`](/reference/api/index/classes/modelerror/#statuscode)
