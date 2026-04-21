---
editUrl: false
next: false
prev: false
title: "PiiMapping"
---

Per-session PII redaction mapping for restore mechanism.
Maintained by `guard.piiRedact()` — tools get original values.

## Properties

### original

> **original**: `string`

Original PII value (e.g., "john@example.com").

***

### placeholder

> **placeholder**: `string`

Placeholder used in redacted text (e.g., "[EMAIL_1]").

***

### type

> **type**: [`PiiType`](/reference/api/index/type-aliases/piitype/) \| `string` & `object`

PII type — built-in ("email", "phone", etc.) or custom pattern name.
