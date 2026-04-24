---
editUrl: false
next: false
prev: false
title: "MemoryStoreConfig"
---

Configuration for the `memory.store()` middleware.

## Properties

### backend

> **backend**: [`SessionStore`](/reference/api/index/interfaces/sessionstore/)

Session store backend implementing SessionStore interface.

***

### ttl?

> `optional` **ttl?**: `number`

Session TTL in seconds. Backends that support expiration will auto-cleanup.
