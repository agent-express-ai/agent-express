---
editUrl: false
next: false
prev: false
title: "injectionDetector"
---

> **injectionDetector**(`config?`): (`ctx`) => [`InputValidationResult`](/reference/api/index/interfaces/inputvalidationresult/) \| `Promise`\<[`InputValidationResult`](/reference/api/index/interfaces/inputvalidationresult/)\>

Creates an `injectionDetector()` validator for use with `guard.input()`.

Dual mode: regex (fast, default) + optional enhanced heuristics.
Returns an `InputValidator` function compatible with the existing `guard.input()` API.

## Parameters

### config?

[`InjectionDetectorConfig`](/reference/api/index/interfaces/injectiondetectorconfig/)

Detection mode options

## Returns

InputValidator function

(`ctx`) => [`InputValidationResult`](/reference/api/index/interfaces/inputvalidationresult/) \| `Promise`\<[`InputValidationResult`](/reference/api/index/interfaces/inputvalidationresult/)\>

## Example

```typescript
import { guard, injectionDetector } from "agent-express"

// Regex only (fast, default)
agent.use(guard.input(injectionDetector()))

// Regex + enhanced heuristics (production-recommended)
agent.use(guard.input(injectionDetector({ enhanced: true })))
```
