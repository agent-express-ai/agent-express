---
editUrl: false
next: false
prev: false
title: "CompactionConfig"
---

Configuration for the `memory.compaction()` middleware.

## Properties

### keepLast?

> `optional` **keepLast?**: `number`

For "window": keep last N messages.

***

### keepLastToolResults?

> `optional` **keepLastToolResults?**: `number`

For "clear-tool-results": keep last N tool results verbatim. Default: 3.

***

### keepRecentMessages?

> `optional` **keepRecentMessages?**: `number`

For "summarize"/"hybrid": keep last N messages verbatim.

***

### maxTokens?

> `optional` **maxTokens?**: `number`

Maximum tokens for the context window. Default: 8192.

***

### strategy?

> `optional` **strategy?**: [`CompactionStrategy`](/reference/api/index/type-aliases/compactionstrategy/)

Compaction strategy. Default: "truncate".

***

### summaryModel?

> `optional` **summaryModel?**: `string` \| `LanguageModelV3`

For "summarize"/"hybrid": model for summaries. Default: agent's own model.

***

### tokenCounter?

> `optional` **tokenCounter?**: [`TokenCounter`](/reference/api/index/type-aliases/tokencounter/)

Token counter function. Default: chars/4 heuristic.
