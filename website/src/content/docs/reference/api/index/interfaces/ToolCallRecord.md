---
editUrl: false
next: false
prev: false
title: "ToolCallRecord"
---

Record of a tool call that occurred during a turn. Included in `RunResult.tools`.

## Properties

### args

> **args**: `Record`\<`string`, `unknown`\>

Arguments the model passed to the tool.

***

### callId

> **callId**: `string`

Tool call ID from the model response.

***

### duration

> **duration**: `number`

Execution time in milliseconds.

***

### error?

> `optional` **error?**: `string`

Error message if the tool execution failed.

***

### name

> **name**: `string`

Tool name.

***

### result

> **result**: `unknown`

Value returned by the tool (or null if it failed).
