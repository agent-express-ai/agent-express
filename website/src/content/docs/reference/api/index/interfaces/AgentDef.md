---
editUrl: false
next: false
prev: false
title: "AgentDef"
---

Configuration passed to `new Agent(def)`.

## Example

```typescript
const agent = new Agent({
  name: "support",
  model: "anthropic/claude-sonnet-4-6",
  instructions: "You are a customer support agent.",
})
```

## Properties

### defaults?

> `optional` **defaults?**: `boolean` \| [`DefaultsOptions`](/reference/api/index/interfaces/defaultsoptions/)

Auto-apply sensible default middleware (retry, usage, tools, duration, maxIterations).
- `true` or omitted: defaults applied
- `{ ... }`: defaults applied with custom options
- `false`: bare minimum, no defaults

***

### instructions

> **instructions**: `string`

System prompt injected into every model call.

***

### model

> **model**: `string` \| `LanguageModelV3`

Model identifier string ("provider/model") or a LanguageModelV3 object.

***

### name

> **name**: `string`

Agent name for debugging and tracing.
