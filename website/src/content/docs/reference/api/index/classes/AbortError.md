---
editUrl: false
next: false
prev: false
title: "AbortError"
---

Thrown when `ctx.abort(reason)` is called in any middleware hook.

This is a hard stop — it unwinds the entire onion stack up to the session level
and rejects the `AgentRun.result` promise. No LLM call is made after abort.

## Example

```typescript
// In a middleware:
turn: async (ctx, next) => {
  if (ctx.state.totalCost > 1.00) ctx.abort("Budget exceeded")
  await next()
}
```

## Extends

- [`AgentExpressError`](/reference/api/index/classes/agentexpresserror/)

## Constructors

### Constructor

> **new AbortError**(`reason`): `AbortError`

#### Parameters

##### reason

`string`

#### Returns

`AbortError`

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

The reason passed to `ctx.abort()`.

***

### retryable

> `readonly` **retryable**: `boolean`

Whether this error can be retried by retry middleware.

#### Inherited from

[`AgentExpressError`](/reference/api/index/classes/agentexpresserror/).[`retryable`](/reference/api/index/classes/agentexpresserror/#retryable)
