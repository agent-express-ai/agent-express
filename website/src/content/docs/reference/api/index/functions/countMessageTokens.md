---
editUrl: false
next: false
prev: false
title: "countMessageTokens"
---

> **countMessageTokens**(`messages`, `counter?`): `number`

Estimates total token count for an array of messages.

## Parameters

### messages

`object`[]

Messages to count

### counter?

[`TokenCounter`](/reference/api/index/type-aliases/tokencounter/) = `defaultTokenCounter`

Token counter function (default: chars/4)

## Returns

`number`

Total estimated tokens
