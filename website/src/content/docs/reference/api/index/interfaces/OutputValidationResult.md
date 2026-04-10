---
editUrl: false
next: false
prev: false
title: "OutputValidationResult"
---

Result of an output validation function.

## Properties

### ok

> **ok**: `boolean`

Whether the output passed validation. `false` blocks the response.

***

### output?

> `optional` **output?**: `string`

Modified output text (redaction, transformation). Only used when `ok` is `true`.

***

### reason?

> `optional` **reason?**: `string`

Reason for blocking (when `ok` is `false`).
