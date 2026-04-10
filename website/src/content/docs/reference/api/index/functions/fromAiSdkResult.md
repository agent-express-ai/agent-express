---
editUrl: false
next: false
prev: false
title: "fromAiSdkResult"
---

> **fromAiSdkResult**(`result`): [`ModelResponse`](/reference/api/index/interfaces/modelresponse/)

Parses the AI SDK V3 `LanguageModelV3GenerateResult` into Agent Express's
internal `ModelResponse` format.

Extracts text and tool calls from the `content` array, flattens token
usage from the nested V3 structure, and normalizes the finish reason.

## Parameters

### result

`LanguageModelV3GenerateResult`

Raw result from `model.doGenerate()`

## Returns

[`ModelResponse`](/reference/api/index/interfaces/modelresponse/)

Normalized ModelResponse
