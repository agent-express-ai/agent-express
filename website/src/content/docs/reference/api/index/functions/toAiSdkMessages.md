---
editUrl: false
next: false
prev: false
title: "toAiSdkMessages"
---

> **toAiSdkMessages**(`messages`): `LanguageModelV3Message`[]

Converts Agent Express internal messages to AI SDK V3 `LanguageModelV3Message[]` format.

This is the bridge between Agent Express's simple `Message` type and the
AI SDK's structured prompt format with typed content parts.

## Parameters

### messages

[`Message`](/reference/api/index/interfaces/message/)[]

Agent Express messages from `ModelContext.messages`

## Returns

`LanguageModelV3Message`[]

AI SDK V3 formatted prompt
