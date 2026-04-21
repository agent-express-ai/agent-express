---
editUrl: false
next: false
prev: false
title: "SearchFileConfig"
---

Configuration for the `search.file()` middleware.

## Properties

### mode?

> `optional` **mode?**: `"tool"` \| `"auto"`

Retrieval mode.
- `"tool"` (default): registers a `search_knowledge` tool, model decides when to search.
- `"auto"`: retrieves every turn using the latest user message.

***

### retrieve

> **retrieve**: (`query`) => `Promise`\<[`Chunk`](/reference/api/index/interfaces/chunk/)[]\>

Retriever function — returns relevant chunks for a query.

#### Parameters

##### query

`string`

#### Returns

`Promise`\<[`Chunk`](/reference/api/index/interfaces/chunk/)[]\>

***

### rewriteQuery?

> `optional` **rewriteQuery?**: (`message`, `history`) => `string`

Custom query rewrite function (auto mode only).

#### Parameters

##### message

`string`

##### history

[`Message`](/reference/api/index/interfaces/message/)[]

#### Returns

`string`

***

### topK?

> `optional` **topK?**: `number`

Maximum chunks to inject into context. Default: 5.
