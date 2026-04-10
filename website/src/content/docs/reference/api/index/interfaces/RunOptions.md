---
editUrl: false
next: false
prev: false
title: "RunOptions"
---

Options passed to `session.run()` or `agent.run()` as second argument.

## Properties

### output?

> `optional` **output?**: `ZodType`\<`any`, `ZodTypeDef`, `any`\>

Zod schema for structured output. When set, RunResult.data contains validated typed object.
