---
editUrl: false
next: false
prev: false
title: "ObserveTracesOptions"
---

Configuration for the `observe.traces()` middleware.

## Properties

### otel?

> `optional` **otel?**: `boolean`

Use OTel GenAI convention span names. Default: false (framework names).

***

### output?

> `optional` **output?**: (`span`) => `void`

Custom span output for standalone mode (when @opentelemetry/api is not installed).

#### Parameters

##### span

[`SpanData`](/reference/api/index/interfaces/spandata/)

#### Returns

`void`

***

### recordContent?

> `optional` **recordContent?**: `boolean`

Record prompt/response content in spans. Default: false.

***

### tracer?

> `optional` **tracer?**: `Tracer`

Custom OTel Tracer instance. Overrides global TracerProvider.
