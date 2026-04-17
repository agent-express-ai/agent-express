---
editUrl: false
next: false
prev: false
title: "MetricEvent"
---

Standalone metric event for observe.metrics() middleware.
Used when `@opentelemetry/api` is not installed.

## Properties

### attributes

> **attributes**: `Record`\<`string`, `string`\>

Attribute key-value pairs.

***

### name

> **name**: `string`

Metric name (e.g., "agent_express_model_calls_total").

***

### type

> **type**: `"counter"` \| `"histogram"`

Metric type.

***

### value

> **value**: `number`

Value (increment for counter, observation for histogram).
