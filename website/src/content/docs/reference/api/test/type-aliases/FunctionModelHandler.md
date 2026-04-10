---
editUrl: false
next: false
prev: false
title: "FunctionModelHandler"
---

> **FunctionModelHandler** = (`messages`, `info`) => [`ModelResponse`](/reference/api/index/interfaces/modelresponse/) \| `Promise`\<[`ModelResponse`](/reference/api/index/interfaces/modelresponse/)\>

Handler function for FunctionModel.
Receives conversation context and returns a model response.

## Parameters

### messages

[`Message`](/reference/api/index/interfaces/message/)[]

### info

#### callIndex

`number`

#### tools

[`FunctionModelToolDef`](/reference/api/test/interfaces/functionmodeltooldef/)[]

## Returns

[`ModelResponse`](/reference/api/index/interfaces/modelresponse/) \| `Promise`\<[`ModelResponse`](/reference/api/index/interfaces/modelresponse/)\>
