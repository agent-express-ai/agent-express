---
editUrl: false
next: false
prev: false
title: "SessionData"
---

Persisted session data.
`state` contains both middleware data and developer custom data.

## Properties

### createdAt

> **createdAt**: `number`

Creation timestamp (epoch ms).

***

### history

> **history**: [`Message`](/reference/api/index/interfaces/message/)[]

Conversation message history.

***

### state

> **state**: `Record`\<`string`, `unknown`\>

Session state — middleware keys + developer data.

***

### updatedAt

> **updatedAt**: `number`

Last update timestamp (epoch ms).
