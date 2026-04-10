---
editUrl: false
next: false
prev: false
title: "toFastifyHandler"
---

> **toFastifyHandler**(`handler`): (`request`, `reply`) => `Promise`\<`void`\>

Wraps a Web-standard handler into a Fastify route handler.

Converts Fastify request/reply to Web `Request`/`Response` and streams the SSE response back.

## Parameters

### handler

(`req`) => `Response`

## Returns

(`request`, `reply`) => `Promise`\<`void`\>

## Example

```typescript
import { createHandler, toFastifyHandler } from "agent-express/http"
const handler = createHandler(agent)
fastify.post("/api/agent", toFastifyHandler(handler))
```
