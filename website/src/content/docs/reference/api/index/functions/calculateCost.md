---
editUrl: false
next: false
prev: false
title: "calculateCost"
---

> **calculateCost**(`modelId`, `usage`, `customPricing?`, `fallback?`): `number`

Calculates the USD cost for a model call based on token usage and pricing.

## Parameters

### modelId

`string`

Model identifier (e.g., "anthropic/claude-sonnet-4-6")

### usage

[`Usage`](/reference/api/index/interfaces/usage/)

Token counts from the model response

### customPricing?

`Record`\<`string`, [`ModelPricing`](/reference/api/index/interfaces/modelpricing/)\>

User-provided pricing overrides

### fallback?

[`ModelPricing`](/reference/api/index/interfaces/modelpricing/) = `DEFAULT_FALLBACK_PRICING`

Fallback pricing for unknown models

## Returns

`number`

Cost in USD

## Example

```typescript
const cost = calculateCost("anthropic/claude-sonnet-4-6", { inputTokens: 1000, outputTokens: 500 })
// cost ≈ 0.0105 ($3/1M * 1000 + $15/1M * 500)
```
