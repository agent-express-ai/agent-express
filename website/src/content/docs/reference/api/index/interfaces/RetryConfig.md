---
editUrl: false
next: false
prev: false
title: "RetryConfig"
---

Retry configuration for transient LLM failures.
Uses exponential backoff: initialDelayMs doubles each retry (1s, 2s, 4s...).

## Properties

### initialDelayMs?

> `optional` **initialDelayMs?**: `number`

Initial delay in ms before first retry. Doubles each attempt. Default: 1000.

***

### maxRetries?

> `optional` **maxRetries?**: `number`

Maximum retry attempts. Default: 2.
