---
editUrl: false
next: false
prev: false
title: "TokenCounter"
---

> **TokenCounter** = (`text`) => `number`

Pluggable token counting interface.

Used by `memory.compaction()` and `model.router()` to estimate token counts.
The default implementation uses a `chars / 4` heuristic (~85% accuracy).
Users can plug in `tokenx` (~95%) or `js-tiktoken` (100%) for better accuracy.

## Parameters

### text

`string`

## Returns

`number`

## Example

```typescript
// Default (built-in, zero deps):
memory.compaction({ maxTokens: 8192 })

// Better estimation (user installs tokenx):
import { estimateTokenCount } from "tokenx"
memory.compaction({ maxTokens: 8192, tokenCounter: (text) => estimateTokenCount(text) })

// Exact counting (user installs js-tiktoken):
import { encodingForModel } from "js-tiktoken"
const enc = encodingForModel("gpt-4o")
memory.compaction({ maxTokens: 8192, tokenCounter: (text) => enc.encode(text).length })
```
