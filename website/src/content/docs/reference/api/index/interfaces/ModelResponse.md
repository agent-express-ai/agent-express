---
editUrl: false
next: false
prev: false
title: "ModelResponse"
---

Normalized response from an LLM call (provider-agnostic).

## Properties

### finishReason

> **finishReason**: `string`

Why the model stopped: "stop", "tool-calls", "length", "content-filter", "error", "other".

***

### text?

> `optional` **text?**: `string`

Generated text (present when the model returns a text response).

***

### toolCalls?

> `optional` **toolCalls?**: [`ModelToolCall`](/reference/api/index/interfaces/modeltoolcall/)[]

Tool calls requested by the model (present when the model wants to use tools).

***

### usage

> **usage**: [`Usage`](/reference/api/index/interfaces/usage/)

Token usage for this call.
