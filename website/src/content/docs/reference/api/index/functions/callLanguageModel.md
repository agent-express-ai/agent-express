---
editUrl: false
next: false
prev: false
title: "callLanguageModel"
---

> **callLanguageModel**(`model`, `ctx`, `responseFormat?`): `Promise`\<[`ModelResponse`](/reference/api/index/interfaces/modelresponse/)\>

Calls a `LanguageModelV3` instance with the messages and tools from a `ModelContext`.

This is the core bridge function: converts Agent Express format → AI SDK V3 format,
calls `model.doGenerate()`, and converts the result back.

## Parameters

### model

`LanguageModelV3`

Resolved LanguageModelV3 instance

### ctx

[`ModelContext`](/reference/api/index/interfaces/modelcontext/)

ModelContext with messages and tool definitions

### responseFormat?

#### description?

`string`

#### name?

`string`

#### schema

`Record`\<`string`, `unknown`\>

#### type

`"json"`

## Returns

`Promise`\<[`ModelResponse`](/reference/api/index/interfaces/modelresponse/)\>

Normalized ModelResponse
