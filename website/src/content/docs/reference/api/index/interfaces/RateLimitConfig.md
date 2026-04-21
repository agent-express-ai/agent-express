---
editUrl: false
next: false
prev: false
title: "RateLimitConfig"
---

Configuration for the `guard.rateLimit()` middleware.

## Properties

### by?

> `optional` **by?**: `"ip"` \| `"sessionId"`

Rate limit key. Default: "sessionId".

***

### maxPerMinute?

> `optional` **maxPerMinute?**: `number`

Maximum requests per minute. Default: 60.

***

### message?

> `optional` **message?**: `string`

Custom message when onExceeded is "message".

***

### onExceeded?

> `optional` **onExceeded?**: `"message"` \| `"throw"` \| `"skip"`

Behavior when limit exceeded. Default: "message".
