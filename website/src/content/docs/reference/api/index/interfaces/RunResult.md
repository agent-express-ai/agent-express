---
editUrl: false
next: false
prev: false
title: "RunResult"
---

Minimal result of a completed turn.

All metadata (usage, tools, duration) lives in `state` under well-known keys
written by middleware (e.g., `observe:usage`, `observe:tools`, `observe:duration`).

Accessible via `await session.run("msg").result` or `await agent.run("msg").result`.

## Properties

### data?

> `optional` **data?**: `unknown`

Validated structured data when RunOptions.output was set. Undefined for text-only runs.

***

### state

> **state**: `Record`\<`string`, `unknown`\>

Session state snapshot at turn end. All metadata accessible via well-known keys.

***

### text

> **text**: `string`

Assistant text response for this turn.
