---
title: Adapters
status: shipped
ships-with: v0.2.0+
last-revised: 2026-05-07
audience: contributors
---

# Adapters

> Adapter packages — what they are, what makes one a good citizen, and why
> they ship as separate npm packages instead of being part of the core. The
> contract for SessionStore (event-log persistence), embed (vector
> embeddings), and search (knowledge-base / web retrieval) adapters.

The framework's design line: **the core is opinion-free about
infrastructure**. Storage, embeddings, search backends, model providers
— all behind interfaces, all opt-in via npm packages, all replaceable
without code changes to the agent.

For the framework's overall positioning that this design serves, see
[`agent-express-concept.md`](agent-express-concept.md). For where in the
runtime the adapter contracts plug in, see [`agent-loop.md`](agent-loop.md).
For the durability and idempotency guarantees specific to SessionStore,
see [`event-log.md`](event-log.md) § 9.

---

## 1. Why adapters, not direct deps

Three things go wrong when a framework hard-codes a backend:

1. **Bloat.** A user who wants SQLite shouldn't have Postgres pulled into
   their bundle. A user who wants Brave search shouldn't transitively
   install Tavily, Exa, and Qdrant clients.
2. **Lock-in.** Once the framework imports `pg` directly, every user's
   `node_modules` contains it. Switching to a custom backend means
   either forking or living with dead code.
3. **Version drift.** The framework pins `pg@^8.13`. A user whose other
   code needs `pg@^9` either upgrades the framework or downgrades their
   app. Peer-dep adapters dodge this entirely.

The pattern: framework defines the **interface** (TypeScript shape of the
contract), an adapter package implements the interface using a specific
backend, the user opt-in installs the adapter package they want.

```
agent-express              ← framework (defines SessionStore, etc.)
  ↑
  │ peer-imports the framework
  │
@agent-express/session-sqlite     ← adapter (implements SessionStore via better-sqlite3)
@agent-express/session-redis      ← adapter (implements SessionStore via ioredis)
@agent-express/session-postgres   ← adapter (implements SessionStore via pg)
```

User code:

```typescript
import { Agent, memory } from "agent-express"
import { sqliteStore } from "@agent-express/session-sqlite"

agent.use(memory.store({ backend: sqliteStore({ path: "./sessions.db" }) }))
```

The framework knows nothing about `better-sqlite3`. The adapter knows
about it. The user installs both.

---

## 2. The three adapter families

### 2.1 Session storage

Implements `SessionStore` (defined in `src/types.ts`). Persists the
event log per session. See [`event-log.md`](event-log.md) for the
contract details and per-adapter storage layouts.

| Package | Backend | Use case |
|---|---|---|
| [`@agent-express/session-sqlite`](../../packages/session-sqlite/) | `better-sqlite3` (embedded file) | Dev, single-process, no infra |
| [`@agent-express/session-redis`](../../packages/session-redis/) | `ioredis` | Multi-process, low-latency, ephemeral OK |
| [`@agent-express/session-postgres`](../../packages/session-postgres/) | `pg` | Production, multi-process, durable, queryable |

All three implement the same `SessionStore` interface. Same agent code
runs against any of them — swap at config time.

### 2.2 Embedding

Implements an `Embed` function that turns text into vectors. Used by
RAG middleware (`search.file()`).

| Package | Backend | Model |
|---|---|---|
| [`@agent-express/embed-openai`](../../packages/embed-openai/) | OpenAI Embeddings API | `text-embedding-3-small` (default) or any OpenAI embedding model |
| [`@agent-express/embed-cohere`](../../packages/embed-cohere/) | Cohere Embed API | `embed-v3` |

Future embed adapters (Voyage, Mistral, local sentence-transformers)
are external contributions; the contract is small (`(text: string) =>
Promise<number[]>`).

### 2.3 Search / retrieval

Two sub-families: knowledge-base search (vector DBs) and web search.

**Knowledge-base** — implements `Retrieve` for `search.file()`:

| Package | Backend | Notes |
|---|---|---|
| [`@agent-express/search-llamaindex`](../../packages/search-llamaindex/) | LlamaIndex.TS | 160+ data loaders (PDF, HTML, Markdown, Notion, Confluence...), multiple vector DBs (Qdrant, Pinecone, pgvector, Chroma, LanceDB...), full RAG pipeline |
| [`@agent-express/search-qdrant`](../../packages/search-qdrant/) | Qdrant | Thin retrieval-only adapter (no ingestion) |
| [`@agent-express/search-pinecone`](../../packages/search-pinecone/) | Pinecone | Same shape |
| [`@agent-express/search-pgvector`](../../packages/search-pgvector/) | PostgreSQL pgvector | Same shape |

**Web search** — implements `WebSearch` for `search.web()`:

| Package | Backend |
|---|---|
| [`@agent-express/search-brave`](../../packages/search-brave/) | Brave Search API |
| [`@agent-express/search-tavily`](../../packages/search-tavily/) | Tavily |
| [`@agent-express/search-exa`](../../packages/search-exa/) | Exa (semantic search) |

A custom retriever is always an option:
`search.file({ retrieve: async (query) => Chunk[] })`. The thin
adapters exist for the convenience of "I just want Pinecone, no
LlamaIndex"; the LlamaIndex adapter is the right choice when you want
the full ingestion + retrieval pipeline.

---

## 3. The SessionStore contract

This is the most-used adapter family. The interface, in
[`src/types.ts`](../../src/types.ts):

```typescript
interface SessionStore {
  load(sessionId: string): Promise<SessionData | null>
  save(sessionId: string, data: SessionData): Promise<void>
  delete(sessionId: string): Promise<void>
  appendEvent(sessionId: string, envelope: EventEnvelope): Promise<void>
  listEvents(sessionId: string, opts?: {
    limit?: number; offset?: number; order?: "asc" | "desc"
  }): Promise<EventEnvelope[]>
}
```

What an implementer must guarantee:

1. **`(sessionId, eventId)` uniqueness for `appendEvent`.** Re-emitting
   the same event ID is a no-op write — no error, no duplicate row.
   This is the load-bearing invariant; the framework's writer queue
   relies on it.
2. **`listEvents` order** is by per-session monotonic `ord` (carried
   in the envelope). `asc` is oldest-first; `delete` removes session
   metadata + all its events atomically.
3. **`save` is bulk** — replaces or upserts the whole session. Used
   for whole-session materialization (debugging, manual snapshots).
   The framework calls it indirectly via memory.store.
4. **Unknown event types preserved verbatim** — payload stored as
   opaque JSON / `jsonb`, type as TEXT. An adapter must NOT filter or
   transform event types it doesn't recognize. (See
   [`event-log.md`](event-log.md) § 13 — middleware-extensibility
   relies on adapters being type-agnostic.)

What the framework guarantees in return:

- The framework's `Writer` queue feeds `appendEvent` in `ord` order.
- Caller-supplied `ord` stays monotonic across replay/resume — the
  adapter never has to compute or re-sequence.
- `EventEnvelope.payload` has already been Zod-validated and
  JSON-stringify-checked at emit time.

Symmetry across adapters means the same agent code runs against any
SessionStore. The framework's
`tests/integration/durable-persistence.test.ts` exercises this
end-to-end against SQLite; the same test pattern applies to
Redis/Postgres adapters with their own test doubles.

---

## 4. The embed contract

```typescript
type Embed = (text: string) => Promise<number[]>
```

That's it. One function, takes text, returns a vector. The size of
the vector depends on the model (1536 for `text-embedding-3-small`,
1024 for Cohere v3, etc.). Consumers (vector DB adapters) need to
know the size to size their index, but the embed function itself
doesn't expose it.

Adapter implementations:

```typescript
// packages/embed-openai/src/index.ts
export function openaiEmbed(opts?: { model?: string; apiKey?: string }): Embed {
  const model = opts?.model ?? "text-embedding-3-small"
  const apiKey = opts?.apiKey ?? process.env["OPENAI_API_KEY"]
  return async (text) => {
    // call OpenAI API
    return embeddingVector
  }
}
```

`config > process.env > error/default` is the convention for adapter
configuration — see § 6.

---

## 5. The search/retrieval contracts

### 5.1 Knowledge-base retrieval

```typescript
type Retrieve = (query: string, opts?: { topK?: number }) => Promise<Chunk[]>

interface Chunk {
  text: string
  score?: number
  source?: { title?: string; url?: string; section?: string }
}
```

`search.file({ retrieve })` middleware uses this in two modes:

- **Tool mode** (default) — exposes a `search_knowledge` tool to the
  model; the model decides when to query
- **Auto mode** — runs retrieval every turn, injects results into the
  model context

Two kinds of adapters:
- **Embedded adapters** (LanceDB, Chroma via LlamaIndex) — handle
  ingestion + retrieval. User points at a directory of docs; adapter
  scans, chunks, embeds, indexes, retrieves.
- **Hosted adapters** (Qdrant, Pinecone, pgvector) — retrieval only.
  User runs ingestion via the vector DB's own tools; adapter just
  queries.

A custom retriever is always an option (`search.file({ retrieve:
myFn })`) — useful when you have an existing retrieval system you
want to plug in.

### 5.2 Web search

```typescript
type WebSearch = (query: string, opts?: { maxResults?: number }) => Promise<SearchResult[]>

interface SearchResult {
  title: string
  url: string
  snippet: string
}
```

`search.web({ search })` exposes a `search_web` tool to the model.
Adapters wrap Brave / Tavily / Exa APIs.

---

## 6. Adapter conventions

Five conventions every adapter package follows. New contributors
implementing a custom adapter should match these.

### 6.1 Configuration cascade

`config > process.env > error/default`. Try the explicit config
parameter first, fall back to environment variable, throw a clear
error if neither is set (or use a sensible default for things that
have one):

```typescript
const apiKey = config?.apiKey ?? process.env["BRAVE_API_KEY"]
if (!apiKey) {
  throw new Error("Brave API key required. Pass via config or set BRAVE_API_KEY.")
}
```

This makes adapters work in three modes:
- Hard-coded for local dev (config)
- 12-factor for production (env var)
- Fail-fast when misconfigured (error)

### 6.2 Lazy imports of heavy peers

Adapter packages declare their backend SDK as a peer dependency, and
import it lazily on first use:

```typescript
// packages/session-sqlite/src/index.ts
let db: Database | null = null

function getDb() {
  if (!db) {
    const Database = require("better-sqlite3")  // lazy
    db = new Database(dbPath)
  }
  return db
}
```

Why lazy: `import` at top would fail at module-load time if the peer
is missing. With lazy import, the failure happens when the user
*actually uses* the adapter — and the error message can point at the
specific adapter and the missing package. Better UX, smaller cold
start when the adapter exists in code but isn't called.

### 6.3 Same TypeScript public surface

Every adapter's public export is a factory function with the same
shape:

```typescript
export function {adapter}(config?: {AdapterConfig}): {AdapterInterface}
```

Users always know what to expect: import, call as a function, pass to
the relevant `agent-express` middleware factory. No constructors, no
classes-with-state, no async-init — just functions returning
implementations.

### 6.4 Self-contained tests with mocks

Each adapter package has its own test suite. Network/disk-backed
adapters use vi.mock() doubles so CI never depends on real Postgres,
real Redis, real OpenAI:

- `session-sqlite/tests/` uses `:memory:`
- `session-redis/tests/` uses an in-memory ioredis double
- `session-postgres/tests/` uses an in-memory pg double
- `embed-openai/tests/` uses `vi.stubGlobal("fetch", mock)` for HTTP

This makes the test suite deterministic and free to run.

### 6.5 ESM-only, strict TypeScript, no DOM

Same constraints as the core (`package.json` `"type": "module"`, TS
strict mode, ESM-only, Node.js 20+, no DOM lib). Adapters are
node/edge-portable — no DOM types, no browser APIs.

---

## 7. Writing a custom adapter

Concrete walk-through — implementing a hypothetical `session-mongodb`
adapter:

```typescript
import type { SessionStore, SessionData, EventEnvelope } from "agent-express"
import { MongoClient } from "mongodb"   // peer dep, declared in package.json

export interface MongoStoreConfig {
  url?: string
  database?: string
}

export function mongoStore(config?: MongoStoreConfig): SessionStore {
  const url = config?.url ?? process.env["MONGODB_URL"]
  if (!url) throw new Error("MongoDB URL required. Pass via config or set MONGODB_URL.")
  const dbName = config?.database ?? "agent_express"

  let client: MongoClient | null = null
  async function getDb() {
    if (!client) {
      client = new MongoClient(url)
      await client.connect()
    }
    return client.db(dbName)
  }

  return {
    async load(sessionId) {
      const db = await getDb()
      const session = await db.collection("sessions").findOne({ _id: sessionId })
      if (!session) return null
      const events = await db.collection("events")
        .find({ sessionId }).sort({ ord: 1 }).toArray()
      return {
        state: session.state,
        events: events.map(toEnvelope),
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      }
    },
    async appendEvent(sessionId, envelope) {
      const db = await getDb()
      await db.collection("events").updateOne(
        { sessionId, eventId: envelope.eventId },
        { $setOnInsert: envelope },   // idempotent — DO NOTHING on conflict
        { upsert: true },
      )
      await db.collection("sessions").updateOne(
        { _id: sessionId },
        { $set: { updatedAt: Date.now() } },
        { upsert: true },
      )
    },
    async listEvents(sessionId, opts) {
      const db = await getDb()
      const sortDir = opts?.order === "desc" ? -1 : 1
      const events = await db.collection("events")
        .find({ sessionId })
        .sort({ ord: sortDir })
        .skip(opts?.offset ?? 0)
        .limit(opts?.limit ?? 1000)
        .toArray()
      return events.map(toEnvelope)
    },
    async delete(sessionId) {
      const db = await getDb()
      await db.collection("events").deleteMany({ sessionId })
      await db.collection("sessions").deleteOne({ _id: sessionId })
    },
    async save(sessionId, data) {
      const db = await getDb()
      await db.collection("sessions").replaceOne(
        { _id: sessionId },
        { _id: sessionId, ...data, events: undefined },
        { upsert: true },
      )
      for (const e of data.events) {
        await db.collection("events").updateOne(
          { sessionId, eventId: e.eventId },
          { $setOnInsert: e },
          { upsert: true },
        )
      }
    },
  }
}
```

Six methods. ~50 LOC of meaningful logic. Plug it in:

```typescript
agent.use(memory.store({ backend: mongoStore({ url: "..." }) }))
```

Same agent code that ran against SQLite now runs against MongoDB.
This is the test of whether the adapter contract is right: can a new
backend be added with no framework changes?

---

## 8. Why this layering is worth the cost

The cost: one extra package per backend. The benefits:

- **Bundle size scales with what users actually use.** Brave-only
  agents don't pull Tavily into their dist bundle.
- **Each adapter has its own version cadence.** A bug fix in
  `session-redis` doesn't require a framework release.
- **Adapter authors can ship without core changes.** A new vector DB
  becomes usable as soon as someone writes the ~200-line adapter
  package — no framework PR, no waiting on review.
- **Users can swap backends without code changes.** A team starts on
  SQLite for dev, moves to Postgres for production, swaps to a
  remote daemon adapter (v0.5) — same agent code throughout.

The cost is real (separate package management for each backend, each
with its own tests, each with its own README), but it's the cost of
not locking the ecosystem into one infra choice.

---

## 9. Reading the code

- [`packages/session-sqlite/src/index.ts`](../../packages/session-sqlite/src/index.ts) — reference SessionStore implementation
- [`packages/session-redis/src/index.ts`](../../packages/session-redis/src/index.ts) — Redis sorted-set + Lua script for atomic idempotent append
- [`packages/session-postgres/src/index.ts`](../../packages/session-postgres/src/index.ts) — Postgres jsonb + ON CONFLICT DO NOTHING
- [`packages/embed-openai/src/index.ts`](../../packages/embed-openai/src/index.ts) — embed adapter pattern
- [`packages/search-brave/src/index.ts`](../../packages/search-brave/src/index.ts) — web-search adapter pattern
- [`packages/search-llamaindex/src/index.ts`](../../packages/search-llamaindex/src/index.ts) — heavyweight RAG adapter (shows how to wrap a non-AI-SDK SDK as an adapter)
- [`src/types.ts`](../../src/types.ts) — `SessionStore`, `Chunk`, `Source`, `SearchResult` interfaces

**Sibling design documents**:
- [`event-log.md`](event-log.md) § 9 — `SessionStore` contract
  specifics (idempotency, ordering, event-type preservation)
- [`agent-express-concept.md`](agent-express-concept.md) § 3 and § 6 —
  the framework's "embeds, doesn't host" positioning that justifies
  the adapter-everything design
- [`providers.md`](providers.md) — same peer-deps + dynamic-import
  pattern, applied to AI SDK provider packages
- [`middleware-interface.md`](middleware-interface.md) — adapters are
  consumed *through* middleware (`memory.store(adapter)`,
  `search.file({embed, retrieve})`); the adapter is the data plane,
  the middleware is the integration plane
- [`agent-loop.md`](agent-loop.md) § 5 — where adapter-consuming
  middleware fires within the agent / session / turn / model / tool
  onion
