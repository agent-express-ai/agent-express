---
editUrl: false
next: false
prev: false
title: "OutputGuardConfig"
---

Configuration for `guard.output()`.

## Properties

### onBlock?

> `optional` **onBlock?**: `"error"` \| `"replace"`

What to do when the validator blocks a response (`ok: false`).
- `"replace"` (default): strip tool calls, return reason as text
- `"error"`: throw `OutputGuardrailError`

***

### validate

> **validate**: [`OutputValidator`](/reference/api/index/type-aliases/outputvalidator/)

Validation function.
