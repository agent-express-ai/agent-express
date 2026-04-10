---
editUrl: false
next: false
prev: false
title: "FunctionModel"
---

Callback-based mock model for complex test scenarios. Implements LanguageModelV3.

Delegates every model call to a user-supplied function that receives the full
message context and can return any response — text, tool calls, or errors.

## Example

```typescript
const model = new FunctionModel((messages, { callIndex }) => {
  if (callIndex === 0) return { toolCalls: [...], usage: ..., finishReason: "tool-calls" }
  return { text: "Done!", usage: ..., finishReason: "stop" }
})
```

## Implements

- `LanguageModelV3`

## Constructors

### Constructor

> **new FunctionModel**(`handler`): `FunctionModel`

#### Parameters

##### handler

[`FunctionModelHandler`](/reference/api/test/type-aliases/functionmodelhandler/)

#### Returns

`FunctionModel`

## Properties

### modelId

> `readonly` **modelId**: `"function-model"` = `"function-model"`

Provider-specific model ID.

#### Implementation of

`LanguageModelV3.modelId`

***

### provider

> `readonly` **provider**: `"function"` = `"function"`

Provider ID.

#### Implementation of

`LanguageModelV3.provider`

***

### specificationVersion

> `readonly` **specificationVersion**: `"v3"`

The language model must specify which language model interface version it implements.

#### Implementation of

`LanguageModelV3.specificationVersion`

***

### supportedUrls

> `readonly` **supportedUrls**: `object` = `{}`

Supported URL patterns by media type for the provider.

The keys are media type patterns or full media types (e.g. `*/*` for everything, `audio/*`, `video/*`, or `application/pdf`).
and the values are arrays of regular expressions that match the URL paths.

The matching should be against lower-case URLs.

Matched URLs are supported natively by the model and are not downloaded.

#### Returns

A map of supported URL patterns by media type (as a promise or a plain object).

#### Implementation of

`LanguageModelV3.supportedUrls`

## Methods

### doGenerate()

> **doGenerate**(`options`): `Promise`\<`LanguageModelV3GenerateResult`\>

Generates a language model output (non-streaming).

Naming: "do" prefix to prevent accidental direct usage of the method
by the user.

#### Parameters

##### options

`LanguageModelV3CallOptions`

#### Returns

`Promise`\<`LanguageModelV3GenerateResult`\>

#### Implementation of

`LanguageModelV3.doGenerate`

***

### doStream()

> **doStream**(): `Promise`\<`never`\>

Generates a language model output (streaming).

Naming: "do" prefix to prevent accidental direct usage of the method
by the user.

#### Returns

`Promise`\<`never`\>

A stream of higher-level language model output parts.

#### Implementation of

`LanguageModelV3.doStream`

***

### reset()

> **reset**(): `void`

Reset call index for reuse across tests.

#### Returns

`void`
