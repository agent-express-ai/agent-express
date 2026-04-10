---
editUrl: false
next: false
prev: false
title: "toMatchAgentSnapshot"
---

> **toMatchAgentSnapshot**(`this`, `received`, `options?`): `object`

Vitest custom matcher that compares a RunResult against a stored snapshot.

Uses deterministic serialization (sorted state keys, excluded keys removed)
and delegates to Vitest's built-in `toMatchSnapshot()` for the actual
snapshot file management.

Register with `expect.extend({ toMatchAgentSnapshot })` and use as:
```typescript
expect(result).toMatchAgentSnapshot({ exclude: ['observe:duration'] })
```

## Parameters

### this

`any`

Vitest matcher context

### received

`Pick`\<[`RunResult`](/reference/api/index/interfaces/runresult/), `"text"` \| `"state"`\> & `object`

The RunResult to snapshot

### options?

[`SnapshotOptions`](/reference/api/test/interfaces/snapshotoptions/)

Optional snapshot options (exclude keys, etc.)

## Returns

`object`

Matcher result with pass/fail and message

### message

> **message**: () => `string`

#### Returns

`string`

### pass

> **pass**: `boolean`
