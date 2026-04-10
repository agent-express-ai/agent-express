---
editUrl: false
next: false
prev: false
title: "ReplayModel"
---

Replay model that serves pre-recorded responses from a cassette.

Does not make any network calls. Returns recorded responses in order.
Throws when all recorded interactions have been exhausted.

## Example

```typescript
const replay = await ReplayModel.fromFile("./fixtures/my-test.cassette.json")
const agent = new Agent({ name: "test", model: replay, instructions: "test", defaults: false })
const { text } = await agent.run("Hello").result
```

## Implements

- `LanguageModelV3`

## Properties

### modelId

> `readonly` **modelId**: `string`

Provider-specific model ID.

#### Implementation of

`LanguageModelV3.modelId`

***

### provider

> `readonly` **provider**: `"replay"` = `"replay"`

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

> **doGenerate**(`_options`): `Promise`\<`LanguageModelV3GenerateResult`\>

Returns the next recorded response. Throws if all responses are exhausted.

#### Parameters

##### \_options

`LanguageModelV3CallOptions`

AI SDK call options (ignored — responses are pre-recorded)

#### Returns

`Promise`\<`LanguageModelV3GenerateResult`\>

Pre-recorded generate result

#### Throws

When all recorded interactions have been consumed

#### Implementation of

`LanguageModelV3.doGenerate`

***

### doStream()

> **doStream**(): `Promise`\<`never`\>

#### Returns

`Promise`\<`never`\>

#### Throws

Always throws — streaming is not supported for replay.

#### Implementation of

`LanguageModelV3.doStream`

***

### fromFile()

> `static` **fromFile**(`path`): `Promise`\<`ReplayModel`\>

Creates a ReplayModel from a cassette JSON file.

#### Parameters

##### path

`string`

Path to the cassette JSON file

#### Returns

`Promise`\<`ReplayModel`\>

ReplayModel ready to serve recorded responses

***

### fromJSON()

> `static` **fromJSON**(`data`): `ReplayModel`

Creates a ReplayModel from parsed cassette JSON data.

#### Parameters

##### data

`any`

Parsed cassette object

#### Returns

`ReplayModel`

ReplayModel ready to serve recorded responses
