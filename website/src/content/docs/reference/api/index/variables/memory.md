---
editUrl: false
next: false
prev: false
title: "memory"
---

> `const` **memory**: `object`

## Type Declaration

### compaction

> **compaction**: (`config?`) => [`Middleware`](/reference/api/index/interfaces/middleware/) = `memoryCompaction`

Context window management with compaction strategies.

Creates a `memory.compaction()` middleware that manages the context window.

Automatically compacts messages before each LLM call when the token count
exceeds the configured limit. Only modifies `ModelContext.messages` —
`SessionContext.history` is never touched.

Five strategies from gentlest to most aggressive:
- `clear-tool-results`: Replace old tool results with placeholder
- `truncate` (default): Drop oldest messages
- `window`: Keep last N messages
- `summarize`: LLM summarizes old messages
- `hybrid`: Summarize old + keep recent verbatim

#### Parameters

##### config?

[`CompactionConfig`](/reference/api/index/interfaces/compactionconfig/)

Working memory configuration

#### Returns

[`Middleware`](/reference/api/index/interfaces/middleware/)

Middleware that manages context window

#### Example

```typescript
// Simple truncation (default, zero cost)
agent.use(memory.compaction({ maxTokens: 8192 }))

// Hybrid (best quality, one LLM call)
agent.use(memory.compaction({
  maxTokens: 8192,
  strategy: "hybrid",
  summaryModel: "anthropic/claude-haiku-4-5",
  keepRecentMessages: 10,
}))
```

### store

> **store**: (`config`) => [`Middleware`](/reference/api/index/interfaces/middleware/) = `memoryStore`

Session persistence to external stores.

Creates a `memory.store()` middleware for session persistence.

Loads session on creation, saves after each turn. Falls back to in-memory
on backend failure — user-facing functionality is never blocked.

#### Parameters

##### config

[`MemoryStoreConfig`](/reference/api/index/interfaces/memorystoreconfig/)

SessionStore backend and options

#### Returns

[`Middleware`](/reference/api/index/interfaces/middleware/)

Middleware

#### Example

```typescript
import { memory } from "agent-express"
import { sqliteStore } from "@agent-express/session-sqlite"

agent.use(memory.store({ backend: sqliteStore({ path: "./sessions.db" }) }))
```
