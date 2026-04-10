---
editUrl: false
next: false
prev: false
title: "resolveModel"
---

> **resolveModel**(`modelId`): `Promise`\<`LanguageModelV3`\>

Resolves a model identifier string to a `LanguageModelV3` instance.

Parses the `"provider/model-name"` format and dynamically imports the
corresponding AI SDK provider package. Provider packages (`@ai-sdk/anthropic`,
`@ai-sdk/openai`) are peer dependencies that the user installs.

## Parameters

### modelId

`string`

Model string like `"anthropic/claude-sonnet-4-6"` or `"openai/gpt-4o"`

## Returns

`Promise`\<`LanguageModelV3`\>

Resolved LanguageModelV3 instance

## Throws

Error if format is invalid, provider is unknown, or package is not installed

## Example

```typescript
const model = await resolveModel("anthropic/claude-sonnet-4-6")
const result = await model.doGenerate({ prompt: [...] })
```
