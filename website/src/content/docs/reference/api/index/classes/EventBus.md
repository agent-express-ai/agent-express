---
editUrl: false
next: false
prev: false
title: "EventBus"
---

Internal event bus that buffers `StreamEvent`s and exposes them
as an `AsyncIterable`.

Used by `AgentRun` to bridge between the synchronous agent loop
(which emits events) and the asynchronous consumer (which iterates).

Events are buffered in memory. If a consumer is already waiting,
it is unblocked immediately. When `close()` is called, the iterator
drains remaining buffered events and then returns.

**Single-consumer only.** Each AgentRun has its own bus, designed for one
async iterator consumer at a time. Multiple consumers will miss events.

## Constructors

### Constructor

> **new EventBus**(): `EventBus`

#### Returns

`EventBus`

## Methods

### \[asyncIterator\]()

> **\[asyncIterator\]**(): `AsyncIterator`\<[`StreamEvent`](/reference/api/index/type-aliases/streamevent/)\>

Async iterator that yields buffered events as they arrive.
Waits when the buffer is empty and the bus is still open.
Returns when the bus is closed and all events have been yielded.

Consumed events are cleared from the buffer to prevent
unbounded memory growth in long-running sessions.

#### Returns

`AsyncIterator`\<[`StreamEvent`](/reference/api/index/type-aliases/streamevent/)\>

***

### close()

> **close**(): `void`

Signal that no more events will be emitted.
The async iterator will drain any remaining buffered events and then finish.

#### Returns

`void`

***

### emit()

> **emit**(`event`): `void`

Emit an event. If a consumer is waiting, unblock it immediately.
Events emitted after `close()` are silently ignored.

#### Parameters

##### event

[`StreamEvent`](/reference/api/index/type-aliases/streamevent/)

#### Returns

`void`
