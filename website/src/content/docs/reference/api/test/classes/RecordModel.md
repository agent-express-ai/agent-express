---
editUrl: false
next: false
prev: false
title: "RecordModel"
---

Recording model that wraps a real LanguageModelV3, forwarding all calls
while capturing request/response pairs for later replay.

Use `saveCassette(path)` to write the recorded interactions to a JSON file.
API key patterns are automatically scrubbed from the output.

## Example

```typescript
const real = resolveModel("anthropic/claude-sonnet-4-6")
const recorder = new RecordModel(real)
// ... use recorder as the model in an Agent ...
await recorder.saveCassette("./fixtures/my-test.cassette.json")
```

## Implements

- `LanguageModelV3`

## Constructors

### Constructor

> **new RecordModel**(`inner`): `RecordModel`

#### Parameters

##### inner

`LanguageModelV3`

#### Returns

`RecordModel`

## Properties

### modelId

> `readonly` **modelId**: `string`

Provider-specific model ID.

#### Implementation of

`LanguageModelV3.modelId`

***

### provider

> `readonly` **provider**: `string`

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

Forwards the call to the inner model and records the interaction.

#### Parameters

##### options

`LanguageModelV3CallOptions`

AI SDK V3 call options

#### Returns

`Promise`\<`LanguageModelV3GenerateResult`\>

The inner model's generate result

#### Implementation of

`LanguageModelV3.doGenerate`

***

### doStream()

> **doStream**(): `Promise`\<`never`\>

#### Returns

`Promise`\<`never`\>

#### Throws

Always throws — streaming is not supported for recording.

#### Implementation of

`LanguageModelV3.doStream`

***

### saveCassette()

> **saveCassette**(`path`): `Promise`\<`void`\>

Writes all recorded interactions to a JSON cassette file.
Automatically scrubs common API key patterns from the output.

#### Parameters

##### path

`string`

File path to write the cassette JSON

#### Returns

`Promise`\<`void`\>
