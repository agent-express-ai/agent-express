---
editUrl: false
next: false
prev: false
title: "testSession"
---

> **testSession**(`agent`, `inputs`): `Promise`\<[`TestSessionResult`](/reference/api/test/interfaces/testsessionresult/)\>

Multi-turn session test helper. Returns per-turn results and final session state.

## Parameters

### agent

[`Agent`](/reference/api/index/classes/agent/)

The Agent instance to test

### inputs

`string`[]

Array of user messages (one per turn)

## Returns

`Promise`\<[`TestSessionResult`](/reference/api/test/interfaces/testsessionresult/)\>

TestSessionResult with per-turn results and session data

## Example

```typescript
const result = await testSession(agent, ["Hello", "Follow up", "Goodbye"])
expect(result.turns).toHaveLength(3)
expect(result.session.history).toHaveLength(6)
```
