---
editUrl: false
next: false
prev: false
title: "TurnCapture"
---

A single captured model call within a turn.

## Properties

### callIndex

> **callIndex**: `number`

Which model call in this turn (0-based).

***

### input

> **input**: [`Message`](/reference/api/index/interfaces/message/)[]

Messages sent to the model (snapshot taken before the call).

***

### response

> **response**: [`ModelResponse`](/reference/api/index/interfaces/modelresponse/)

Model response returned after the call.
