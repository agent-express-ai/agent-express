---
editUrl: false
next: false
prev: false
title: "LogEvent"
---

Structured log event emitted by observe.log() middleware.
Consumable by Datadog, Grafana, ELK, etc.

## Properties

### data

> **data**: `Record`\<`string`, `unknown`\>

Event-specific data (model, tokens, cost, tool name, duration, error).

***

### sessionId

> **sessionId**: `string`

Session identifier.

***

### timestamp

> **timestamp**: `string`

ISO 8601 timestamp.

***

### turnIndex

> **turnIndex**: `number`

Turn number within this session.

***

### type

> **type**: `string`

Event type: "model:call", "model:response", "tool:call", "tool:result", "retry", "error", etc.
