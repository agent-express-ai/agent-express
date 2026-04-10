---
editUrl: false
next: false
prev: false
title: "TestSessionResult"
---

Result of a `testSession()` call.

## Properties

### failures

> **failures**: `string`[]

List of failure descriptions.

***

### passed

> **passed**: `boolean`

Whether all assertions passed.

***

### session

> **session**: `object`

Final session state.

#### history

> **history**: [`Message`](/reference/api/index/interfaces/message/)[]

#### id

> **id**: `string`

#### state

> **state**: `Record`\<`string`, `unknown`\>

***

### turns

> **turns**: [`RunResult`](/reference/api/index/interfaces/runresult/)[]

Results from each turn.
