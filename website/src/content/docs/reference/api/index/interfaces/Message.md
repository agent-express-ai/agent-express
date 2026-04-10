---
editUrl: false
next: false
prev: false
title: "Message"
---

A message in the conversation history.

## Properties

### content

> **content**: `string` \| [`MessagePart`](/reference/api/index/interfaces/messagepart/)[]

String for text-only messages, or array of parts for tool calls/results.

***

### role

> **role**: `"system"` \| `"user"` \| `"assistant"` \| `"tool"`
