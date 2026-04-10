---
editUrl: false
next: false
prev: false
title: "McpServerConfig"
---

> **McpServerConfig** = `object` & \{ `args?`: `string`[]; `command`: `string`; `env?`: `Record`\<`string`, `string`\>; `transport`: `"stdio"`; \} \| \{ `headers?`: `Record`\<`string`, `string`\>; `timeout?`: `number`; `transport`: `"sse"`; `url`: `string`; \} \| \{ `headers?`: `Record`\<`string`, `string`\>; `timeout?`: `number`; `transport`: `"http"`; `url`: `string`; \}

MCP server transport configuration.

## Type Declaration

### name

> **name**: `string`

Server identifier for debugging and tool name disambiguation.

### requireApproval?

> `optional` **requireApproval?**: `boolean` \| `string`[] \| ((`toolName`, `args`) => `boolean` \| `Promise`\<`boolean`\>)

Which tools from this server require human approval.
- `true`: all tools
- `string[]`: tool names matching glob patterns (e.g., `["delete_*", "drop_*"]`)
- `function(toolName, args)`: conditional by name and runtime arguments
