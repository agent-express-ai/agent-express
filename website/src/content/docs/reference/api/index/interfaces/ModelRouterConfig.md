---
editUrl: false
next: false
prev: false
title: "ModelRouterConfig"
---

Configuration for the `model.router()` middleware.

## Properties

### classify?

> `optional` **classify?**: (`ctx`) => [`ComplexityTier`](/reference/api/index/type-aliases/complexitytier/)

Custom classifier function. Overrides the default heuristic.

#### Parameters

##### ctx

[`ModelContext`](/reference/api/index/interfaces/modelcontext/)

#### Returns

[`ComplexityTier`](/reference/api/index/type-aliases/complexitytier/)

***

### routes

> **routes**: `Record`\<[`ComplexityTier`](/reference/api/index/type-aliases/complexitytier/), `string`\>

Model ID mapping for each complexity tier.

***

### tokenCounter?

> `optional` **tokenCounter?**: [`TokenCounter`](/reference/api/index/type-aliases/tokencounter/)

Token counter for input complexity estimation. Default: chars/4.
