---
editUrl: false
next: false
prev: false
title: "defaults"
---

> **defaults**(`opts?`): [`Middleware`](/reference/api/index/interfaces/middleware/)[]

Returns the standard set of default middleware for common use cases.

Included in every Agent automatically unless `defaults: false` is set.
Can also be called directly for advanced composition.

Includes:
- `model.retry()` — exponential backoff for transient LLM failures
- `observe.usage()` — token tracking → `state['observe:usage']`
- `observe.tools()` — tool call recording → `state['observe:tools']`
- `observe.duration()` — turn timing → `state['observe:duration']`
- `guard.maxIterations()` — loop iteration limit (default 25)

## Parameters

### opts?

[`DefaultsOptions`](/reference/api/index/interfaces/defaultsoptions/)

Optional customization of default middleware behavior

## Returns

[`Middleware`](/reference/api/index/interfaces/middleware/)[]

Array of middleware to pass to `agent.use()`
