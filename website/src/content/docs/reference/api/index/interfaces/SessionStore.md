---
editUrl: false
next: false
prev: false
title: "SessionStore"
---

Interface for session persistence backends.
Implement this to store sessions in any storage system.
Built-in adapters: `@agent-express/session-sqlite`, `session-redis`, `session-postgres`.

## Methods

### add()

> **add**(`sessionId`, `message`): `Promise`\<`void`\>

Append a single message without rewriting the full history.

#### Parameters

##### sessionId

`string`

##### message

[`Message`](/reference/api/index/interfaces/message/)

#### Returns

`Promise`\<`void`\>

***

### delete()

> **delete**(`sessionId`): `Promise`\<`void`\>

Delete session.

#### Parameters

##### sessionId

`string`

#### Returns

`Promise`\<`void`\>

***

### list()

> **list**(`sessionId`, `opts?`): `Promise`\<[`Message`](/reference/api/index/interfaces/message/)[]\>

Get messages with pagination.

#### Parameters

##### sessionId

`string`

##### opts?

###### limit?

`number`

Max messages to return.

###### offset?

`number`

Skip first N messages.

###### order?

`"asc"` \| `"desc"`

Sort order. Default: "desc" (newest first).

#### Returns

`Promise`\<[`Message`](/reference/api/index/interfaces/message/)[]\>

***

### load()

> **load**(`sessionId`): `Promise`\<[`SessionData`](/reference/api/index/interfaces/sessiondata/) \| `null`\>

Load full session (state + history). Returns null if not found.

#### Parameters

##### sessionId

`string`

#### Returns

`Promise`\<[`SessionData`](/reference/api/index/interfaces/sessiondata/) \| `null`\>

***

### save()

> **save**(`sessionId`, `data`): `Promise`\<`void`\>

Save full session (state + history).

#### Parameters

##### sessionId

`string`

##### data

[`SessionData`](/reference/api/index/interfaces/sessiondata/)

#### Returns

`Promise`\<`void`\>
