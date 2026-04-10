---
editUrl: false
next: false
prev: false
title: "toExpressHandler"
---

> **toExpressHandler**(`handler`): (`req`, `res`) => `Promise`\<`void`\>

Wraps a Web-standard handler into an Express.js route handler.

Converts Express `req`/`res` to Web `Request`/`Response` and streams the SSE response back.

## Parameters

### handler

(`req`) => `Response`

## Returns

(`req`, `res`) => `Promise`\<`void`\>

## Example

```typescript
import { createHandler, toExpressHandler } from "agent-express/http"
const handler = createHandler(agent)
app.post("/api/agent", toExpressHandler(handler))
```
