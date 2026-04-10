---
editUrl: false
next: false
prev: false
title: "serializeForSnapshot"
---

> **serializeForSnapshot**(`result`, `options?`): `Record`\<`string`, `unknown`\>

Creates a deterministic serializable form of a RunResult for snapshot comparison.

Sorts state keys alphabetically, excludes specified keys, and produces
a plain object suitable for Vitest's built-in snapshot matching.

## Parameters

### result

`Pick`\<[`RunResult`](/reference/api/index/interfaces/runresult/), `"text"` \| `"state"`\> & `object`

The run result (or any object with text, state, data)

### options?

[`SnapshotOptions`](/reference/api/test/interfaces/snapshotoptions/)

Optional exclusion list for state keys

## Returns

`Record`\<`string`, `unknown`\>

Deterministic plain object
