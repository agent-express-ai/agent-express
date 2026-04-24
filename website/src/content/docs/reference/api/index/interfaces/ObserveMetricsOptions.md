---
editUrl: false
next: false
prev: false
title: "ObserveMetricsOptions"
---

## Properties

### custom?

> `optional` **custom?**: `CustomMetricMapping`[]

Custom state-to-metric mappings for middleware-specific metrics.

***

### meter?

> `optional` **meter?**: `Meter`

Custom OTel Meter instance. Overrides global MeterProvider.

***

### otel?

> `optional` **otel?**: `boolean`

Emit OTel GenAI standard metrics alongside agent_express_* metrics. Default: false.

***

### output?

> `optional` **output?**: (`event`) => `void`

Custom output callback for standalone mode (when @opentelemetry/api is not installed).

#### Parameters

##### event

[`MetricEvent`](/reference/api/index/interfaces/metricevent/)

#### Returns

`void`
