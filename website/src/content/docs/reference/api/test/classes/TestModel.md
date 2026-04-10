---
editUrl: false
next: false
prev: false
title: "TestModel"
---

Deterministic mock model for testing. Implements LanguageModelV3.

Three modes:
1. **No config**: Auto-calls all available tools on first call, returns defaultText on second.
2. **responses[]**: Returns pre-configured responses in order. Throws when exhausted.
3. **defaultText**: Always returns the specified text (no tool calls).

Zero cost, zero latency, no network calls.

## Example

```typescript
const agent = new Agent({
  name: "test",
  model: new TestModel({ defaultText: "Hello!" }),
  instructions: "test",
  defaults: false,
})
const { text } = await agent.run("Hi").result  // "Hello!"
```

## Implements

- `LanguageModelV3`

## Constructors

### Constructor

> **new TestModel**(`opts?`): `TestModel`

#### Parameters

##### opts?

[`TestModelOptions`](/reference/api/test/interfaces/testmodeloptions/)

#### Returns

`TestModel`

## Properties

### modelId

> `readonly` **modelId**: `"test-model"` = `"test-model"`

Provider-specific model ID.

#### Implementation of

`LanguageModelV3.modelId`

***

### provider

> `readonly` **provider**: `"test"` = `"test"`

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
