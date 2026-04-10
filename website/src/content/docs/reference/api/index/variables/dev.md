---
editUrl: false
next: false
prev: false
title: "dev"
---

> `const` **dev**: `object`

## Type Declaration

### console

> **console**: (`config?`) => [`Middleware`](/reference/api/index/interfaces/middleware/) = `devConsole`

Full agent lifecycle terminal trace for development.

Creates a `dev.console()` middleware that prints the full agent lifecycle
to stderr in a human-readable format.

Shows: session start/end, turns, model calls (model, tokens, cost, duration),
tool executions (name, args, duration), guard results, and errors.

#### Parameters

##### config?

[`DevConsoleConfig`](/reference/api/index/interfaces/devconsoleconfig/)

Optional configuration with custom formatter

#### Returns

[`Middleware`](/reference/api/index/interfaces/middleware/)

Middleware that prints lifecycle to terminal

#### Example

```typescript
agent.use(dev.console())
// Output:
// ┌ session s-abc123
// │  → turn #0
// │  │  → model.call  sonnet  tokens: 150→85  $0.003  847ms
// │  │  → tool.exec   search  234ms
// │  │  → model.call  sonnet  tokens: 320→120 $0.005  612ms
// │  → turn #0 done  $0.008  1693ms
// └ session done  $0.008  1 turn
```
