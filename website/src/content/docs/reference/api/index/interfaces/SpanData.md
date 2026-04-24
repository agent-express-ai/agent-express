---
editUrl: false
next: false
prev: false
title: "SpanData"
---

Standalone span representation for observe.traces() middleware.
Used when `@opentelemetry/api` is not installed.

## Properties

### attributes

> **attributes**: `Record`\<`string`, `string` \| `number` \| `boolean` \| `string`[]\>

Span attributes (framework + GenAI).

***

### endTime

> **endTime**: `number`

End timestamp (epoch ms).

***

### error?

> `optional` **error?**: `object`

Error details (when status is "error").

#### message

> **message**: `string`

#### type

> **type**: `string`

***

### name

> **name**: `string`

Span name (framework or OTel convention depending on mode).

***

### parentId?

> `optional` **parentId?**: `string`

Parent span ID (undefined for root spans).

***

### spanId

> **spanId**: `string`

16-char hex span identifier.

***

### startTime

> **startTime**: `number`

Start timestamp (epoch ms).

***

### status

> **status**: `"error"` \| `"ok"`

Span completion status.

***

### traceId

> **traceId**: `string`

32-char hex trace identifier.
