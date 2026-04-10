---
editUrl: false
next: false
prev: false
title: "testAgent"
---

> **testAgent**(`agent`, `opts`): `Promise`\<[`TestResult`](/reference/api/test/interfaces/testresult/)\>

Declarative test helper for Agent Express agents.

Supports single-turn (string input) and multi-turn (string[] input).
For multi-turn, creates a session and runs each input as a turn.

## Parameters

### agent

[`Agent`](/reference/api/index/classes/agent/)

The Agent instance to test

### opts

[`TestOptions`](/reference/api/test/interfaces/testoptions/)

Input and optional assertions

## Returns

`Promise`\<[`TestResult`](/reference/api/test/interfaces/testresult/)\>

TestResult with pass/fail and details

## Example

```typescript
// Single turn
const result = await testAgent(agent, {
  input: "Hello",
  expect: { outputContains: "Hi" },
})

// Multi-turn
const result = await testAgent(agent, {
  input: ["Hello", "What did I say?"],
  expect: { outputContains: "Hello" },
})
```
