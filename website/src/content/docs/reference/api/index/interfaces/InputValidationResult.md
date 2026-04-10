---
editUrl: false
next: false
prev: false
title: "InputValidationResult"
---

Result of an input validation function.

## Properties

### messages?

> `optional` **messages?**: [`Message`](/reference/api/index/interfaces/message/)[]

Modified messages to use instead of originals (when ok + messages provided).

***

### ok

> **ok**: `boolean`

Whether the input passed validation.

***

### reason?

> `optional` **reason?**: `string`

Reason for rejection (when !ok).
