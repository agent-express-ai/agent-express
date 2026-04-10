---
editUrl: false
next: false
prev: false
title: "BudgetConfig"
---

Configuration for the `guard.budget()` middleware.

## Properties

### fallbackPricing?

> `optional` **fallbackPricing?**: [`ModelPricing`](/reference/api/index/interfaces/modelpricing/)

Fallback pricing for models not in the default or custom table.

***

### limit

> **limit**: `number`

Maximum USD cost per session.

***

### onLimit?

> `optional` **onLimit?**: `"error"` \| `"stop"` \| ((`ctx`, `cost`) => `string` \| `void`)

What to do when the budget is exceeded.
- `"error"` (default): throw `BudgetExceededError`
- `"stop"`: graceful stop — skip LLM call, turn ends with empty text
- callback: developer decides — return string for final text, void for empty, or throw

***

### pricing?

> `optional` **pricing?**: `Record`\<`string`, [`ModelPricing`](/reference/api/index/interfaces/modelpricing/)\>

Per-model pricing override (USD per 1M tokens). Merged with built-in defaults.
