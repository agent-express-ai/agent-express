---
editUrl: false
next: false
prev: false
title: "MessagePart"
---

A structured part of a message (text, tool call, or tool result).

## Properties

### args?

> `optional` **args?**: `Record`\<`string`, `unknown`\>

Arguments passed to the tool (for "tool-call" parts).

***

### result?

> `optional` **result?**: `unknown`

Result returned by the tool (for "tool-result" parts).

***

### text?

> `optional` **text?**: `string`

Text content (for "text" parts).

***

### toolCallId?

> `optional` **toolCallId?**: `string`

Tool call ID linking a call to its result.

***

### toolName?

> `optional` **toolName?**: `string`

Name of the tool being called or that produced the result.

***

### type

> **type**: `"text"` \| `"tool-call"` \| `"tool-result"`
