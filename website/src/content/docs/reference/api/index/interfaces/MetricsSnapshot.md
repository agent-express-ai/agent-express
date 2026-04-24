---
editUrl: false
next: false
prev: false
title: "MetricsSnapshot"
---

Session-scoped metrics snapshot written to `state['observe:metrics']`.
Simple JS object for programmatic access — independent of OTel.

## Properties

### duration

> **duration**: `object`

Durations in milliseconds.

#### models

> **models**: `number`[]

#### session

> **session**: `number`

#### tools

> **tools**: `number`[]

#### turns

> **turns**: `number`[]

***

### errors

> **errors**: `number`

Number of errors in this session.

***

### modelCalls

> **modelCalls**: `number`

Number of model calls in this session.

***

### tokens

> **tokens**: `object`

Token usage in this session.

#### input

> **input**: `number`

#### output

> **output**: `number`

***

### toolCalls

> **toolCalls**: `number`

Number of tool calls in this session.

***

### turns

> **turns**: `number`

Number of turns in this session.
