---
editUrl: false
next: false
prev: false
title: "PiiRedactConfig"
---

Configuration for the `guard.piiRedact()` middleware.

## Properties

### custom?

> `optional` **custom?**: `object`[]

Custom patterns with placeholder text.

#### pattern

> **pattern**: `RegExp`

#### placeholder

> **placeholder**: `string`

***

### types?

> `optional` **types?**: [`PiiType`](/reference/api/index/type-aliases/piitype/)[]

Which PII types to detect. Default: all types.
