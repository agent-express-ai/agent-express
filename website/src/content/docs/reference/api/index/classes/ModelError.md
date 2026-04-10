---
editUrl: false
next: false
prev: false
title: "ModelError"
---

Base class for errors originating from LLM model providers.

Subtypes cover specific failure modes: rate limits, context overflow,
content filters, authentication, and network errors. The `retryable`
flag is set per subtype to guide retry middleware.

## Extends

- [`AgentExpressError`](/reference/api/index/classes/agentexpresserror/)

## Extended by

- [`RateLimitError`](/reference/api/index/classes/ratelimiterror/)
- [`ContextOverflowError`](/reference/api/index/classes/contextoverflowerror/)
- [`ContentFilterError`](/reference/api/index/classes/contentfiltererror/)
- [`AuthenticationError`](/reference/api/index/classes/authenticationerror/)
- [`NetworkError`](/reference/api/index/classes/networkerror/)

## Constructors

### Constructor

> **new ModelError**(`message`, `provider`, `retryable`, `statusCode?`, `cause?`): `ModelError`

#### Parameters

##### message

`string`

##### provider

`string`

##### retryable

`boolean`

##### statusCode?

`number`

##### cause?

`Error`

#### Returns

`ModelError`

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

### provider

> `readonly` **provider**: `string`

Provider name (e.g., "anthropic", "openai").

***

### retryable

> `readonly` **retryable**: `boolean`

Whether this error can be retried by retry middleware.

#### Inherited from

[`AgentExpressError`](/reference/api/index/classes/agentexpresserror/).[`retryable`](/reference/api/index/classes/agentexpresserror/#retryable)

***

### statusCode?

> `readonly` `optional` **statusCode?**: `number`

HTTP status code from the provider API, if available.
