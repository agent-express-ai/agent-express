---
editUrl: false
next: false
prev: false
title: "ObserveLogOptions"
---

Configuration for the `observe.log()` middleware.

## Properties

### output?

> `optional` **output?**: (`event`) => `void`

Custom output function. Default: JSON line to stderr.

#### Parameters

##### event

[`LogEvent`](/reference/api/index/interfaces/logevent/)

#### Returns

`void`

***

### recordContent?

> `optional` **recordContent?**: `boolean`

Record prompt/response content in log events. Default: false.
