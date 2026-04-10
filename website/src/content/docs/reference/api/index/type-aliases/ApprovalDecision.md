---
editUrl: false
next: false
prev: false
title: "ApprovalDecision"
---

> **ApprovalDecision** = \{ `action`: `"approve"`; `remember?`: `boolean`; \} \| \{ `action`: `"deny"`; `reason`: `string`; \} \| \{ `action`: `"modify"`; `args`: `Record`\<`string`, `unknown`\>; \}

Approval decision returned by the approval function.
Use `approve()`, `deny()`, `modify()` helpers to construct.
