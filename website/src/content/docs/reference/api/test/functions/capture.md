---
editUrl: false
next: false
prev: false
title: "capture"
---

> **capture**(): `object`

Creates a message capture middleware that records model inputs and outputs.

The middleware installs a `model` hook that snapshots `ctx.messages` before
each LLM call and records the response after. All captures are accumulated
in `result.turns`.

## Returns

`object`

Object with `middleware` to install and `result` to inspect captures

### middleware

> **middleware**: [`Middleware`](/reference/api/index/interfaces/middleware/)

### result

> **result**: [`CaptureResult`](/reference/api/test/interfaces/captureresult/)

## Example

```typescript
const { middleware, result } = capture()
const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
  .use(middleware)

await agent.run("Hello").result
console.log(result.turns[0].input)    // messages sent to model
console.log(result.turns[0].response) // model response
```
