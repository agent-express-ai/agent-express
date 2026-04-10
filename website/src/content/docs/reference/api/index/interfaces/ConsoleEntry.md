---
editUrl: false
next: false
prev: false
title: "ConsoleEntry"
---

A single entry in the console output, representing one lifecycle event.

## Properties

### data?

> `optional` **data?**: `Record`\<`string`, `unknown`\>

Event-specific data.

***

### depth

> **depth**: `number`

Indentation depth (0=session, 1=turn, 2=model/tool).

***

### summary

> **summary**: `string`

Human-readable summary line.

***

### type

> **type**: `string`

Event type: "session:start", "turn:start", "model:call", "tool:call", etc.
