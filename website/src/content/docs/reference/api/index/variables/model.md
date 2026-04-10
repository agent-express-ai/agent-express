---
editUrl: false
next: false
prev: false
title: "model"
---

> `const` **model**: `object`

## Type Declaration

### retry

> **retry**: (`config?`) => [`Middleware`](/reference/api/index/interfaces/middleware/) = `modelRetry`

Exponential backoff retry for transient LLM failures.

Creates a `model.retry()` middleware that wraps LLM calls with exponential backoff.

On transient failures (rate limits, network errors, retryable model errors),
retries up to `maxRetries` times with exponential backoff starting at
`initialDelayMs` (doubling each attempt). Non-retryable errors propagate
immediately without retry.

Uses the same retry classification as the core `withRetry()` utility:
`RateLimitError` and `NetworkError` are retryable, `AuthenticationError`
and `ContentFilterError` are not.

#### Parameters

##### config?

[`RetryConfig`](/reference/api/index/interfaces/retryconfig/)

Retry configuration. Defaults to 2 retries with 1000ms initial delay.

#### Returns

[`Middleware`](/reference/api/index/interfaces/middleware/)

Middleware that retries failed model calls with exponential backoff

#### Example

```typescript
// Default: 2 retries, 1s initial delay
agent.use(model.retry())

// Custom: 3 retries, 500ms initial delay
agent.use(model.retry({ maxRetries: 3, initialDelayMs: 500 }))
```

### router

> **router**: (`config`) => [`Middleware`](/reference/api/index/interfaces/middleware/) = `modelRouter`

Route model calls by complexity.

Creates a `model.router()` middleware that routes model calls by complexity.

Classifies each model call as simple, medium, or complex, then overrides
the model to the configured route target. Saves 60-90% on LLM costs for
mixed-complexity workloads.

#### Parameters

##### config

[`ModelRouterConfig`](/reference/api/index/interfaces/modelrouterconfig/)

Routes mapping and optional custom classifier

#### Returns

[`Middleware`](/reference/api/index/interfaces/middleware/)

Middleware that routes model calls by complexity

#### Example

```typescript
agent.use(model.router({
  routes: {
    simple: "anthropic/claude-haiku-4-5",
    medium: "anthropic/claude-sonnet-4-6",
    complex: "anthropic/claude-opus-4-6",
  },
}))
```
