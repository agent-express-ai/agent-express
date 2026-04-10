---
editUrl: false
next: false
prev: false
title: "Tool"
---

Internal representation of a registered tool.
Created by `tools.function()` from a `ToolDef`.

## Properties

### description

> **description**: `string`

Description the LLM uses to decide when to call this tool.

***

### execute

> **execute**: (`args`, `ctx`) => `Promise`\<`unknown`\>

Execution function. Receives validated args and a context reference.

#### Parameters

##### args

`Record`\<`string`, `unknown`\>

##### ctx

`unknown`

#### Returns

`Promise`\<`unknown`\>

***

### jsonSchema

> **jsonSchema**: `Record`\<`string`, `unknown`\>

JSON Schema representation sent to the LLM.

***

### name

> **name**: `string`

Tool name sent to the LLM.

***

### requireApproval?

> `optional` **requireApproval?**: `boolean` \| ((`args`) => `boolean` \| `Promise`\<`boolean`\>)

Whether this tool requires human approval before execution. Set by tools.function() or tools.mcp().

***

### schema?

> `optional` **schema?**: `ZodType`\<`any`, `ZodTypeDef`, `any`\>

Zod schema for runtime input validation. Optional for MCP tools (which use jsonSchema directly).

***

### timeout?

> `optional` **timeout?**: `number`

Maximum execution time in ms. Default: 30000.
