---
editUrl: false
next: false
prev: false
title: "HandlerOptions"
---

Options for the HTTP handler.

## Properties

### maxInputLength?

> `optional` **maxInputLength?**: `number`

Maximum input string length in characters. Default: 100000.

***

### maxSessions?

> `optional` **maxSessions?**: `number`

Maximum number of concurrent sessions. New sessions are rejected when limit is reached. Default: 10000.

***

### sessionIdHeader?

> `optional` **sessionIdHeader?**: `string`

Header name for session ID. Default: `"x-session-id"`.

***

### sessionTtlMs?

> `optional` **sessionTtlMs?**: `number`

Session TTL in milliseconds. Sessions are evicted after this period of inactivity. Default: 1800000 (30 min).
