---
editUrl: false
next: false
prev: false
title: "ApprovalFunction"
---

> **ApprovalFunction** = (`toolName`, `args`, `ctx`) => [`ApprovalDecision`](/reference/api/index/type-aliases/approvaldecision/) \| `Promise`\<[`ApprovalDecision`](/reference/api/index/type-aliases/approvaldecision/)\>

Approval function — receives tool details, returns a decision.
Supports sync and async (Promise) return values.

## Parameters

### toolName

`string`

### args

`Record`\<`string`, `unknown`\>

### ctx

[`ToolContext`](/reference/api/index/interfaces/toolcontext/)

## Returns

[`ApprovalDecision`](/reference/api/index/type-aliases/approvaldecision/) \| `Promise`\<[`ApprovalDecision`](/reference/api/index/type-aliases/approvaldecision/)\>
