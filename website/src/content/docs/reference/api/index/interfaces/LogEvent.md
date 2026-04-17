---
editUrl: false
next: false
prev: false
title: "LogEvent"
---

Structured log event emitted by observe.log() middleware.
Consumable by Datadog, Grafana, ELK, etc.

## Properties

### agentName?

> `optional` **agentName?**: `string`

Agent name for multi-agent filtering. Added in 009-providers-observability.

***

### data

> **data**: `Record`\<`string`, `unknown`\>

Event-specific data (model, tokens, cost, tool name, duration, error).

***

### durationMs?

> `optional` **durationMs?**: `number`

Duration in milliseconds (present on end events).

***

### error?

> `optional` **error?**: `object`

Error details (present on failure events).

#### message

> **message**: `string`

#### type

> **type**: `string`

***

### level?

> `optional` **level?**: `"debug"` \| `"info"` \| `"warn"` \| `"error"`

Log severity level. Added in 009-providers-observability.

***

### sessionId

> **sessionId**: `string`

Session identifier.

***

### spanId?

> `optional` **spanId?**: `string`

OpenTelemetry span ID (present when OTel span context is active).

***

### timestamp

> **timestamp**: `string`

ISO 8601 timestamp.

***

### traceId?

> `optional` **traceId?**: `string`

OpenTelemetry trace ID (present when OTel span context is active).

***

### turnId?

> `optional` **turnId?**: `string`

Turn identifier (present on turn/model/tool events).

***

### turnIndex

> **turnIndex**: `number`

Turn number within this session.

***

### type

> **type**: `string`

Event type: "model:call", "model:response", "tool:start", "tool:end", etc.
