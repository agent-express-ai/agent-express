---
editUrl: false
next: false
prev: false
title: "toAiSdkTools"
---

> **toAiSdkTools**(`toolDefs`): `LanguageModelV3FunctionTool`[] \| `undefined`

Converts Agent Express tool definitions to AI SDK V3 `LanguageModelV3FunctionTool[]`.

## Parameters

### toolDefs

`object`[]

Tool definitions from `ModelContext.toolDefs`

## Returns

`LanguageModelV3FunctionTool`[] \| `undefined`

AI SDK formatted function tools, or undefined if no tools
