---
editUrl: false
next: false
prev: false
title: "createHandler"
---

> **createHandler**(`agent`, `options?`): (`req`) => `Response`

Creates a Web-standard `Request → Response` handler for an agent.

The handler parses a JSON request body (`{ input: string }`),
runs one turn in a session, and streams `StreamEvent` objects back
as Server-Sent Events.

Sessions are kept in memory keyed by session ID with automatic TTL eviction.
If no session ID is provided, a new ephemeral session is created and closed
after the request. If a session ID is provided, the session persists across
requests — conversation history and state are maintained until TTL expires.

Security:
- Input length is capped (default 100K chars)
- Session count is capped (default 10K) to prevent memory exhaustion
- Idle sessions are evicted after TTL (default 30 min)
- Session IDs are validated against a strict format
- Error messages sent to clients are generic (no internal details)
- Authentication/authorization is the caller's responsibility

## Parameters

### agent

[`Agent`](/reference/api/index/classes/agent/)

The Agent instance to handle requests for

### options?

[`HandlerOptions`](/reference/api/http/handler/interfaces/handleroptions/)

Optional handler configuration

## Returns

A function that takes a `Request` and returns a `Response`

(`req`) => `Response`
