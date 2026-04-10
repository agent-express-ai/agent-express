---
editUrl: false
next: false
prev: false
title: "defaultTokenCounter"
---

> `const` **defaultTokenCounter**: [`TokenCounter`](/reference/api/index/type-aliases/tokencounter/)

Default token counter: `chars / 4` heuristic.

~85% accurate for English text. The 80% default context limit in
`memory.compaction()` provides a safety margin for this inaccuracy.

## Param

Text to estimate token count for

## Returns

Estimated token count
