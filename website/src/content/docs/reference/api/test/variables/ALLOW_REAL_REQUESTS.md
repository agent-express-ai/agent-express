---
editUrl: false
next: false
prev: false
title: "ALLOW_REAL_REQUESTS"
---

> **ALLOW\_REAL\_REQUESTS**: `boolean` = `true`

Global flag controlling whether real LLM API calls are allowed.

When `false`, `resolveModel()` throws before making any network call
for string-based model identifiers (e.g., "anthropic/claude-sonnet-4-6").
Does NOT affect LanguageModelV3 objects passed directly (TestModel, FunctionModel, etc.).

Set to `false` in test setup to prevent accidental real API calls:
```typescript
import { setAllowRealRequests } from "agent-express/test"
setAllowRealRequests(false)
```

## Default

```ts
true
```
