---
editUrl: false
next: false
prev: false
title: "StreamEvent"
---

> **StreamEvent** = \{ `sessionId`: `string`; `type`: `"session:start"`; \} \| \{ `result`: [`RunResult`](/reference/api/index/interfaces/runresult/); `sessionId`: `string`; `type`: `"session:end"`; \} \| \{ `turnId`: `string`; `turnIndex`: `number`; `type`: `"turn:start"`; \} \| \{ `text`: `string`; `turnId`: `string`; `turnIndex`: `number`; `type`: `"turn:end"`; \} \| \{ `callIndex`: `number`; `model`: `string`; `type`: `"model:start"`; \} \| \{ `callIndex`: `number`; `text`: `string`; `type`: `"model:chunk"`; \} \| \{ `callIndex`: `number`; `finishReason`: `string`; `type`: `"model:end"`; \} \| \{ `args`: `Record`\<`string`, `unknown`\>; `callId`: `string`; `tool`: `string`; `type`: `"tool:start"`; \} \| \{ `callId`: `string`; `result`: `unknown`; `tool`: `string`; `type`: `"tool:end"`; \} \| \{ `error`: `Error`; `type`: `"error"`; \}

Discriminated union of all events emitted during agent execution.

Events follow the lifecycle nesting: session → turn → model/tool.
Consumers iterate over these via `for await (const event of agent.run(...))`.
