---
editUrl: false
next: false
prev: false
title: "ToolDef"
---

Configuration for a single function tool.

## Example

```typescript
const weatherTool: ToolDef = {
  name: "get_weather",
  description: "Get current weather for a city",
  schema: z.object({ city: z.string() }),
  execute: async ({ city }) => `Sunny in ${city}`,
}
```

## Properties

### description

> **description**: `string`

Description the LLM uses to decide when to call this tool.

***

### execute

> **execute**: (`args`, `ctx`) => `Promise`\<`unknown`\>

Execution function called when the LLM invokes this tool.

#### Parameters

##### args

`Record`\<`string`, `unknown`\>

##### ctx

`unknown`

#### Returns

`Promise`\<`unknown`\>

***

### name

> **name**: `string`

Unique tool name sent to the LLM.

***

### requireApproval?

> `optional` **requireApproval?**: `boolean` \| ((`args`) => `boolean` \| `Promise`\<`boolean`\>)

Whether this tool requires human approval before execution.

***

### schema

> **schema**: `ZodType`

Zod schema for input validation and JSON Schema generation.

***

### timeout?

> `optional` **timeout?**: `number`

Maximum execution time in ms. Default: 30000.
