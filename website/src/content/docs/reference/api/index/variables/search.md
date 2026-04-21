---
editUrl: false
next: false
prev: false
title: "search"
---

> `const` **search**: `object`

## Type Declaration

### file

> **file**: (`config`) => [`Middleware`](/reference/api/index/interfaces/middleware/) = `searchFile`

Document/knowledge base search with RAG retrieval.

Creates a `search.file()` middleware for document/knowledge base search.

Two modes:
- `"tool"` (default): registers `search_knowledge` tool — model decides when to search.
- `"auto"`: retrieves every turn using latest user message.

Retrieved chunks are injected into the model context and tracked in
`state['search:file:sources']`.

#### Parameters

##### config

[`SearchFileConfig`](/reference/api/index/interfaces/searchfileconfig/)

Retriever function and options

#### Returns

[`Middleware`](/reference/api/index/interfaces/middleware/)

Middleware

#### Example

```typescript
import { search } from "agent-express"
import { chromaRetriever } from "@agent-express/search-llamaindex"

agent.use(search.file({
  retrieve: chromaRetriever({ sources: ["./docs"], embed: openaiEmbed() }),
}))
```

### web

> **web**: (`config`) => [`Middleware`](/reference/api/index/interfaces/middleware/) = `searchWeb`

Web search tool — model calls when needed.

Creates a `search.web()` middleware that registers a `web_search` tool.

The model calls the tool when it needs information beyond the knowledge base.
Results are written to `state['search:web:results']` for source tracking.

#### Parameters

##### config

[`SearchWebConfig`](/reference/api/index/interfaces/searchwebconfig/)

Search provider function

#### Returns

[`Middleware`](/reference/api/index/interfaces/middleware/)

Middleware

#### Example

```typescript
import { search } from "agent-express"
import { braveProvider } from "@agent-express/search-brave"

agent.use(search.web({ provider: braveProvider({ apiKey }) }))
```
