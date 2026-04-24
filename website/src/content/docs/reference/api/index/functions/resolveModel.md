---
editUrl: false
next: false
prev: false
title: "resolveModel"
---

> **resolveModel**(`modelId`): `Promise`\<`LanguageModelV3`\>

Resolves a model identifier string to a `LanguageModelV3` instance.

Dynamically imports the corresponding `@ai-sdk/{provider}` package for any
provider. Provider packages are optional peer dependencies — users install
only what they need.

## Parameters

### modelId

`string`

Model string like `"anthropic/claude-sonnet-4-6"`, `"google/gemini-2.0-flash"`, or `"openai/gpt-4o"`

## Returns

`Promise`\<`LanguageModelV3`\>

Resolved LanguageModelV3 instance

## Throws

Error if format is invalid, provider package is not installed, or provider export is incompatible

## Example

```typescript
const model = await resolveModel("google/gemini-2.0-flash")
const result = await model.doGenerate({ prompt: [...] })
```
