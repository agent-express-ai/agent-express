---
editUrl: false
next: false
prev: false
title: "DefaultsOptions"
---

Options for the auto-applied defaults middleware set.
Passed to `defaults()` when `AgentDef.defaults` is an object.

## Properties

### maxIterations?

> `optional` **maxIterations?**: `number`

Maximum model→tool→model iterations per turn. Default: 25.

***

### retry?

> `optional` **retry?**: `false` \| [`RetryConfig`](/reference/api/index/interfaces/retryconfig/)

Retry config. Default: { maxRetries: 2, initialDelayMs: 1000 }. Set false to disable.
