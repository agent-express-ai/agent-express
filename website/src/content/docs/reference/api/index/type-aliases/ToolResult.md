---
editUrl: false
next: false
prev: false
title: "ToolResult"
---

> **ToolResult** = `object`

Result of a tool execution, fed back to the LLM.

## Properties

### callId

> **callId**: `string`

Tool call ID this result corresponds to.

***

### isError?

> `optional` **isError?**: `boolean`

Whether this result represents an error (tool failed or was denied).

***

### result

> **result**: `unknown`

The tool's output value.
