# Agent Express: Event Log Implementation (v0.4 / Feature 010)

> Engineering reference. Describes how the event log substrate is wired in the
> code as it ships in v0.4. Companion to the spec at
> `specs/011-event-log-foundation/spec.md` (the WHAT) — this document is the
> HOW. Cross-checked against Anthropic Managed Agents
> (`docs/research/anthropic-managed-agents-architecture.md`) and OpenAI Codex
> `thread-store` / `app-server` (`docs/research/codex-architecture-research.md`,
> `specs/011-event-log-foundation/spec.md` Appendix A).

---

## 1. What Changed

In v0.3 a `Session` held a mutable `Message[]` history array; the streaming
surface was a separate per-run `EventBus<StreamEvent>` with a flat shape.
Two stores, two sources of truth, neither persistent.

In v0.4 the canonical store is the **event log**: a per-session append-only
array of typed `Event` objects. The streaming iterator (`agent.run()` /
`session.run()`) yields the same `Event` objects (same `id`s) that
`session.events` exposes. A durable `Writer` queue persists each event to a
configured `SessionStore` adapter. `Session.history` becomes a derived
`Message[]` view, recomputed from events on read.

Single primitive, three surfaces — same objects through all of them.

---

## 2. Architecture at a Glance

```
                                            ┌───────────────────┐
                          subscribe(ev)     │   AgentRun        │
                       ┌──────────────────► │  (per turn)       │
                       │                    │  iterates over    │
                       │                    │  Event[] from     │
                       │                    │  cursor onward    │
┌──────────────┐       │   ┌──────────────┐ └───────────────────┘
│  ctx.emit    │       │   │  EventLog    │
│ ({type,      │ ────► │ ─►│   events[]   │            ┌─────────────────┐
│   payload})  │       │   │   subscribe  │   subscribe │   Writer        │
└──────────────┘       │   └──────────────┘ ──────────► │  per-session    │
       │               │                                │  bounded queue  │
       │ validateEmit  │                                │  (256)          │
       ▼               │                                └────────┬────────┘
┌──────────────┐       │                                         │
│ Zod safeParse│       │                                         │ appendEvent
│ + JSON guard │       │                                         ▼
└──────────────┘       │                                ┌─────────────────┐
       │               │                                │  SessionStore   │
       │ ok            │                                │   adapter       │
       ▼               │                                │  (sqlite/redis/ │
┌──────────────┐       │                                │   postgres)     │
│  build Event │       │                                └─────────────────┘
│  id=UUIDv7   │ ──────┘
│  ts=Date.now │
│  schemaVer   │
└──────────────┘
```

`ctx.emit` is the single public entry point. After validation, the event
becomes an immutable record that flows synchronously to in-memory readers
(`AgentRun` iterator, `Session.events`, `Session.history` getter) and gets
queued for async durable persistence. **Same object, same ID, three views.**

---

## 3. The Public Contract

| Symbol | Where | Role |
|---|---|---|
| `Event<TType, TPayload>` | `src/types.ts` | One observable occurrence: `id` (UUIDv7), `ts`, `type`, `schemaVersion`, `payload` |
| `EventEnvelope` | `src/types.ts` | On-the-wire shape stored by adapters: `Event` + `sessionId`, `eventId`, `ord` |
| `EventTypeSchema<T>` | `src/types.ts` | Declaration: `{ schema: ZodSchema<T>, schemaVersion: number }` |
| `EventTypeMap` | `src/types.ts` | `Record<string, EventTypeSchema>` — record of name → declaration |
| `Middleware.events` | `src/middleware.ts` | Optional `EventTypeMap` field — middleware author advertises types it emits |
| `Session.events` | `src/session.ts` | `readonly Event[]` — canonical accessor |
| `Session.history` | `src/session.ts` | `Message[]` getter — derived projection of events |
| `ctx.emit({type, payload})` | `src/middleware.ts` (SessionContext+) | Append a typed event |
| `SessionStore` | `src/types.ts` | Persistence interface (`load`, `save`, `delete`, `appendEvent`, `listEvents`) |
| `SESSION_STORE_PROVIDER` | `src/event-log/event-log.ts` | Symbol — middleware advertises a SessionStore via this property |
| `typedEvents(events, type, schema)` | `src/event-log/typed-events.ts` | Read-site narrowing helper |

All these are exported from the `agent-express` entry point.

---

## 4. Core Module Layout

```
src/event-log/
├── event-log.ts        ← EventLog class + SESSION_STORE_PROVIDER symbol
├── events.ts           ← CORE_EVENT_TYPE_MAP (emitted, reserved-emitted, reserved-only)
├── id.ts               ← nextEventId() — UUIDv7 wrapper
├── validate.ts         ← mergeEventTypeMaps + validateEmit
├── derive-history.ts   ← Pure projection events[] → Message[]
├── writer.ts           ← Per-session bounded queue → SessionStore.appendEvent
├── typed-events.ts     ← typedEvents() narrowing helper
└── index.ts            ← Public re-exports
```

Each file is small (≤180 LOC) and has a single responsibility. The code
review surface is the public contract above plus this directory.

---

## 5. The Emit Pipeline

`ctx.emit` is wired by `buildSessionEmit` in `src/context.ts`. The closure
runs four steps:

```ts
function buildSessionEmit(session, eventTypeMap, writer) {
  return (input: { type, payload }) => {
    // 1. Lifecycle guard
    if (session.eventLog.isClosed) {
      throw new EventOutsideSessionError(...)
    }

    // 2. Validate
    const validated = validateEmit(eventTypeMap, input.type, input.payload)
    //   - Unknown type → UnknownEventTypeError
    //   - Bad payload → EventValidationError (Zod safeParse)
    //   - Non-JSON-serializable → EventSerializationError (replacer guard
    //     rejects function / BigInt / Date / undefined / circular)

    // 3. Build the immutable Event
    const event = {
      id: nextEventId(),                // UUIDv7
      ts: Date.now(),
      type: input.type,
      schemaVersion: validated.schemaVersion,
      payload: validated.payload,
    }

    // 4. Append in-memory + queue durable write
    session.eventLog.append(event)
    if (writer) {
      const ord = session.eventLog.events.length - 1   // index after append
      const envelope = { sessionId, eventId, ord, ts, type, schemaVersion, payload }
      void writer.enqueue(envelope).catch(() => {
        // failure surfaces via writer.drain() at turn:end
      })
    }
  }
}
```

Two design points worth pinning down:

**`ord` comes from EventLog index, not Writer counter.** `ord = eventLog.events.length - 1` after append. This stays monotonic across replay/resume because replay populates earlier indices first; new events get the next index. A per-Writer-queue counter would collide with persisted ord values after rehydration.

**Validation is two-layer.** Zod `safeParse` accepts shapes Zod considers valid (including `BigInt`, `Date`, functions, `undefined`). The framework's JSON-replacer guard (`src/event-log/validate.ts:79-105`) then rejects values that wouldn't round-trip through `JSON.stringify`. Without this second layer we'd silently corrupt the durable log when Zod-valid-but-JSON-invalid payloads land.

---

## 6. EventLog — The Canonical Store

`src/event-log/event-log.ts`. ~80 LOC, no external deps.

```ts
class EventLog {
  events: readonly Event[]      // append-only array

  append(event: Event): void
  subscribe(sub: EventSubscriber): () => unsubscribe
  replay(events: Iterable<Event>): void   // idempotent — skips known IDs
  close(): void
  isClosed: boolean
}
```

**Synchronous append, read-your-writes**. By the time `append()` returns, the
event is in `events` AND every subscriber has been notified. A throwing
subscriber is contained — `try { sub(event) } catch { }` — so a misbehaving
subscriber cannot stall the rest of the framework or block the iterator.

**Subscribers are how the streaming iterator and the durable writer plug in.**
`AgentRun` constructor subscribes to wake its async iterator. `Writer` is wired
through the emit closure (it's queued, not subscribed — see § 5).

**`replay()`** is the rehydration path used by `memory.store()` middleware
(see § 9). It checks event IDs against the existing log and only adds new
ones, so replay after partial writes is safe.

---

## 7. AgentRun — The Streaming Iterator

`src/run.ts`. Per-turn cursor + signal flag pattern.

```ts
class AgentRun implements AsyncIterable<Event> {
  result: Promise<RunResult>

  // Internal state
  cursor: number          // captured at construction = log.events.length
  stopAt: number | null   // frozen at completion = log.events.length
  pending: boolean        // bridges events that arrive between yields
  stopped: boolean
}
```

Why this shape: `Session.eventLog` is shared across many `AgentRun` instances
(one per turn). Each `AgentRun` must yield only events from its own turn —
not history from previous turns, not events from a future turn that hasn't
started yet.

**`cursor` and `stopAt` define the exact slice.** `cursor` is the log length
at AgentRun construction (just before `executeTurn` starts emitting). `stopAt`
is the log length when `complete()` / `fail()` is called (frozen so
post-completion appends from the next turn don't leak in).

**`pending` flag bridges the race between yield and await.** Without it:

```
1. Iterator yields event N. Suspends on consumer.
2. New event N+1 lands. Subscriber tries to wake — but `wakeup` is null
   (iterator hasn't reached the await line yet). Wakeup is lost.
3. Iterator resumes from yield, increments i, exits inner while loop.
4. Iterator awaits new Promise — sets `wakeup`. But the wake signal was
   already lost in step 2. → Deadlock.
```

The `pending` flag captures the wake signal even before `wakeup` is
registered. The iterator checks `pending` before awaiting and skips the
await if a signal landed. See `src/run.ts:84-106` for the loop and the
`if (i < (this.stopAt ?? log.length)) continue` re-check that catches the
late `stopAt` set by `complete()`.

---

## 8. Writer — Durable Persistence Queue

`src/event-log/writer.ts`. Per-session bounded queue (capacity 256) drained
by a background async loop.

```ts
class Writer {
  enqueue(envelope: EventEnvelope): Promise<void>
  drain(sessionId: string): Promise<void>     // resolves when buffer empty
  forget(sessionId: string): void             // free per-session queue
}
```

**Why a queue and not direct write**: emit is synchronous from the agent loop's
perspective. `SessionStore.appendEvent` is async. Without a queue, every emit
would block the loop on disk I/O — for a turn with 30 streaming chunks, that's
30 sequential round-trips. The queue lets the loop emit at memory speed and
disk catches up in the background.

**Backpressure is signal-driven**. When the buffer is at capacity, enqueue
registers a `slotWaiter` callback. Each successful drain wakes one waiter
(FIFO). No `setImmediate` polling — the system is idle when the buffer is
full and the consumer is fast.

**Durability semantics — best-effort within turn boundary** (Codex pattern).
`Session.executeTurn` calls `writer.drain(sessionId)` after the `turn:end`
event is emitted. If drain fails, `agentRun.fail(err)` rejects the result.
No `fsync` per event — adapter defaults are SQLite WAL=NORMAL, Postgres
default `synchronous_commit`, Redis AOF=everysec. Rationale and trade-off
discussed in `specs/011-event-log-foundation/spec.md` §A.4 / FR-026a.

**Adapter throw → `EventStoreWriteError`** wraps the cause and rejects every
pending write, every drain awaiter, and every backpressure slot waiter for
that session. `queue.failed` is set so subsequent `enqueue`/`drain` calls
fail fast without retrying.

**Cleanup**: `Session.close()` calls `writer.forget(sessionId)` to release
the per-session queue.

---

## 9. SessionStore Adapter Contract

```ts
interface SessionStore {
  load(sessionId): Promise<SessionData | null>
  save(sessionId, data): Promise<void>           // bulk write (used at resume init)
  delete(sessionId): Promise<void>               // session + all events
  appendEvent(sessionId, envelope): Promise<void>      // per-emit write
  listEvents(sessionId, opts?): Promise<EventEnvelope[]>
}
```

**The load-bearing invariant: `(sessionId, eventId)` uniqueness.** Re-emitting
the same event ID is a no-op write (idempotent). This protects against:
- Duplicate writes from a transient retry layer (relevant once we add the
  v0.5 remote daemon adapter)
- Replay during resume (`memory.store()` calls `load()` then `EventLog.replay()`;
  if a write already partially committed, the duplicate is harmless)

**Three bundled adapters, three storage shapes**:

### 9.1 SQLite (`packages/session-sqlite`)

```sql
CREATE TABLE events (
  session_id TEXT NOT NULL,
  event_id   TEXT NOT NULL,
  ord        INTEGER NOT NULL,
  ts         INTEGER NOT NULL,
  type       TEXT NOT NULL,
  schema_ver INTEGER NOT NULL,
  payload    TEXT NOT NULL,         -- JSON
  PRIMARY KEY (session_id, event_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX idx_events_session_ord ON events(session_id, ord);
```

Idempotency via `INSERT OR IGNORE`. WAL=NORMAL, synchronous=NORMAL.
`appendEvent` also bumps `sessions.updated_at` for `list_threads`-style
queries (kept simple — no batching).

### 9.2 Redis (`packages/session-redis`)

Per-session keys:
- `events:{id}` — sorted set, score = `ord`, member = JSON envelope
- `event-ids:{id}` — set of seen event IDs (idempotency check)
- `{id}` (session hash) — `state`, `created_at`, `updated_at`

`appendEvent` runs an atomic Lua script that does the SISMEMBER guard, the
ZADD, and the session-hash bookkeeping in one round-trip. The script accepts
`ord` as a parameter (caller-computed from EventLog index — see § 5).

### 9.3 Postgres (`packages/session-postgres`)

```sql
CREATE TABLE agent_events (
  session_id TEXT      NOT NULL,
  event_id   TEXT      NOT NULL,
  ord        BIGINT    NOT NULL,
  ts         BIGINT    NOT NULL,
  type       TEXT      NOT NULL,
  schema_ver INTEGER   NOT NULL,
  payload    JSONB     NOT NULL,
  PRIMARY KEY (session_id, event_id)
);
CREATE INDEX idx_agent_events_session_ord ON agent_events(session_id, ord);
```

Idempotency via `ON CONFLICT (session_id, event_id) DO NOTHING`. `payload` is
`jsonb` so debug queries like `SELECT payload->>'text' FROM agent_events
WHERE type = 'user:input'` work directly.

### 9.4 Adapter symmetry

All three adapters expose the same interface, the same idempotency guarantee,
the same listEvents pagination semantics, and the same `(session_id, event_id)`
uniqueness constraint. The `tests/integration/durable-persistence.test.ts`
fixture exercises the full pipeline against SQLite; the parametrized adapter
test contract is a v0.4.x backlog item.

---

## 10. Wiring at Agent Construction

`Agent.init()` (in `src/agent.ts`) does three things relevant to the event log:

```ts
async init() {
  this.applyDefaults()

  // 1. Merge core + middleware-declared event-type maps. Throws on collision.
  this.eventTypeMap = mergeEventTypeMaps(this.middlewares)

  // 2. Find a SessionStore advertised by middleware. Currently
  //    memory.store() sets the SESSION_STORE_PROVIDER symbol on its
  //    returned middleware; the framework picks the first match.
  const store = this.findSessionStore()
  this.writer = store ? new Writer(store) : null

  // 3. Run the agent onion (middleware init).
  ...
}

private findSessionStore(): SessionStore | null {
  for (const mw of this.middlewares) {
    const candidate = (mw as { [SESSION_STORE_PROVIDER]?: SessionStore })[SESSION_STORE_PROVIDER]
    if (candidate) return candidate
  }
  return null
}
```

`memoryStore()` (`src/middleware/memory/store.ts`):

```ts
return {
  name: "memory:store",
  [SESSION_STORE_PROVIDER]: backend,    // ← this is what agent.init() reads

  async session(ctx, next) {
    const data = await backend.load(ctx.sessionId)
    if (data) {
      // Restore state
      for (const [k, v] of Object.entries(data.state)) ctx.state[k] = v
      // Replay events into the session's in-memory log
      ctx._session.eventLog.replay(data.events.map(toEvent))
    }
    await next()
    // No end-of-session save — events persisted per-emit during the turn.
  }
}
```

The framework provides the wiring; the user just `agent.use(memory.store({ backend: sqliteStore(...) }))`.

---

## 11. Lifecycle: Multi-Turn Session with Persistence

```
                                        EventLog        SessionStore (sqlite)
agent.init()            mergeEventTypeMaps()
                        Writer = new Writer(sqliteStore)

agent.session({id:"s1"})
                        new Session
                          new SessionState
                            new EventLog ─────┐
                                              │
                        memoryStore.session()
                          await backend.load("s1")
                          (first time → returns null, no replay)

session.run("hello")
                        new AgentRun(eventLog)
                          cursor = 0
                          subscribe(...)         ────► AgentRun's subscriber

  ctx.emit("turn:start", {turnIndex:0,...}) ──► append(event[0])  ────► Writer.enqueue
                                                                           │
                                                                           ├─► async appendEvent (sqlite INSERT)
  ctx.emit("user:input", {text:"hello"}) ───► append(event[1])  ────► Writer.enqueue
                                                                           │
                                                                           ├─► async appendEvent
  ... model call ...
  ctx.emit("model:start", {...}) ────────────► append(event[2])
  ctx.emit("model:end", {...})  ────────────► append(event[3])
  ctx.emit("model:response", {...}) ────────► append(event[4])
  ctx.emit("turn:end", {status:"completed"}) ► append(event[5])
                                                                           │
                        await writer.drain("s1") ◄───────────────────────┘
                          (blocks until queue empty — durability boundary)

                        agentRun.complete(result)
                          stopAt = 6
                          stopped = true

                                                                           ▼
                                                                  events table:
                                                                  [s1, e1, ord=0, turn:start]
                                                                  [s1, e2, ord=1, user:input]
                                                                  [s1, e3, ord=2, model:start]
                                                                  [s1, e4, ord=3, model:end]
                                                                  [s1, e5, ord=4, model:response]
                                                                  [s1, e6, ord=5, turn:end]

session.close()
                        eventLog.close()
                        writer.forget("s1")     ◄── per-session queue freed
```

For a **second turn on the same session id** (resume), `memoryStore.session()`
calls `backend.load("s1")` and gets back all 6 events. `eventLog.replay(events)`
populates the in-memory log with these events. `Session.history` getter
(via `deriveHistory`) projects them into the v0.3-shape `Message[]`. The
next `session.run("...")` builds a model context that includes this history.

---

## 12. The Core Event Vocabulary

Defined in `src/event-log/events.ts`. Three categories.

**Emitted in v0.4** (framework code emits these):

| Type | Payload (high level) | Emitter |
|---|---|---|
| `user:input` | `{ text }` | `Session.executeTurn` start |
| `model:start` | `{ model, callIndex }` | `loop.ts` per LLM call |
| `model:chunk` | `{ callIndex, text }` | streaming hook (reserved — emitted by streaming-aware adapter) |
| `model:end` | `{ callIndex, text, finishReason, usage? }` | `loop.ts` after each LLM call |
| `model:response` | `{ text, usage? }` | `executeTurn` rolled-up final text |
| `tool:call` | `{ tool, args, callId }` | `loop.ts` per tool invocation |
| `tool:result` | `{ tool, callId, result, error? }` | `loop.ts` after tool execution |
| `turn:start` | `{ turnIndex, turnId }` | `executeTurn` |
| `turn:end` | `{ turnIndex, turnId, text, status }` | `executeTurn` (status: `completed`/`interrupted`/`failed`) |
| `error` | `{ kind, message }` | on caught exception in `executeTurn` |

**Reserved-emitted in v0.4** (declared in core, not core-emitted; tools or
adapters MAY emit):

| Type | Payload | Notes |
|---|---|---|
| `tool:progress` | `{ tool, callId, delta }` | for streaming tool output (stdout/stderr, MCP progress) |

**Reserved-only** (declared, not emitted; framework owns the names so user
middleware can't claim them — full list in `src/event-log/events.ts`):

`compaction:applied`, `agent:handoff`, `agent:delegate`, `permission:approved`,
`permission:denied`, `permission:modified`, `turn:diff`, `turn:plan`,
`model:reasoning:chunk`, `model:reasoning:end`.

---

## 13. Extension Point: User-Defined Event Types

A middleware author declares their event types alongside their `state`:

```ts
import { z } from "zod"
import type { Middleware } from "agent-express"

const InboundSchema = z.object({ channel: z.string(), text: z.string() })

export function slackChannel(): Middleware {
  return {
    name: "slack-channel",
    events: {
      "channel:slack:inbound": { schema: InboundSchema, schemaVersion: 1 },
    },
    session: async (ctx, next) => {
      ctx.emit({
        type: "channel:slack:inbound",
        payload: { channel: "C123", text: "hi" },
      })
      await next()
    },
  }
}
```

`agent.use(slackChannel())` registers the schemas at `agent.init()` — they
merge with core schemas into one event-type map. Collisions throw
`EventTypeCollisionError`. The framework validates payloads against the
declared Zod schema on every emit. At read site, callers narrow with the
`typedEvents` helper:

```ts
for (const e of typedEvents(session.events, "channel:slack:inbound", InboundSchema)) {
  console.log(e.payload.channel)   // typed as string — no `as` cast
}
```

This is the "harness customization framework" wedge — vocabulary is part of
what the user customizes, not a closed enum the framework owns. Anthropic
SDK and Codex `app-server` both ship closed enums; this is where v0.4
deliberately diverges. Cross-comparison: `specs/011-event-log-foundation/spec.md`
Appendix A.7.

---

## 14. Derived View: Session.history

`Session.history` is a getter, not a stored field:

```ts
get history(): Message[] {
  return deriveHistory(this.eventLog.events, this.maxHistory)
}
```

`deriveHistory(events, maxHistory?)` (in `src/event-log/derive-history.ts`)
walks the event log in order and projects:

- `user:input` → `{ role: "user", content: text }`
- `model:response` → `{ role: "assistant", content: text }` (preferred)
- `model:end` → `{ role: "assistant", content: text }` (fallback when no
  `model:response` present)
- everything else (tool calls, results, chunks, errors, custom events) → ignored

**Tool calls and results are intentionally omitted from the derived history.**
Within a single turn, `loop.ts` builds the model's message array dynamically
(tool calls and results inserted between model calls per the function-calling
protocol). Across turns, the next turn's context reconstructs from
`{user, assistant}` pairs only — same as v0.3 behavior. Workflows that need
verbatim tool history across turns can write a custom `deriveFullHistory`
projection over `session.events` (the raw log preserves everything).

`maxHistory` trims the projected `Message[]` (not the underlying events) so
context windows stay bounded.

---

## 15. Streaming Iterator vs Persistent Log: Same Objects

A subtle but important property: the `for await ... of agentRun` consumer
sees the **exact same `Event` objects** (referential equality, same `id`s)
that `session.events` exposes that `SessionStore.listEvents` will return.

```ts
for await (const event of agent.run("hello")) {
  // After the run ends, the same event objects are findable via:
  const sameOne = session.events.find(e => e.id === event.id)
  // sameOne === event  (referential equality)
}
```

This is the unification that v0.3's `EventBus` + `StreamEvent` separation
broke. Streaming consumers can correlate to persisted events by `id`;
audit consumers see the same payload that streamed; storage adapters store
the same envelope shape that streams.

---

## 16. Cross-References

**Spec & contracts**:
- `specs/011-event-log-foundation/spec.md` — feature specification (the WHAT)
- `specs/011-event-log-foundation/research.md` — implementation decisions
  (UUIDv7, Zod, vocab merging, adapter shapes, backpressure, lifecycle scoping)
- `specs/011-event-log-foundation/data-model.md` — entities, validation rules,
  state transitions
- `specs/011-event-log-foundation/contracts/` — type-level contracts

**Reference architectures**:
- `docs/research/anthropic-managed-agents-architecture.md` — Brain/Hands/Session
  decomposition, 6 procedural methods, credential proxy patterns
- `docs/research/codex-architecture-research.md` — `RolloutItem` JSONL,
  `ThreadStore::Local|Remote|InMemory`, recovery via replay

**Vocabulary comparison**:
- `specs/011-event-log-foundation/spec.md` §A.7 — agent-express vs Codex
  `app-server` event-type comparison, what we borrowed and what we deliberately
  did not

**Roadmap context**:
- `docs/roadmap.md` Feature 010 — three-phase v0.4 plan; Feature 011 (`wake`)
  builds on this substrate; Feature 012 (`ContextAssembler`) consumes events
  for compaction; Feature 015 (multi-agent) uses `agent:handoff` reserved type

---

## 17. Open Questions / Future Work

These are documented in the spec or roadmap but worth flagging here for
implementers:

1. **`tool:progress` is reserved-emitted but no built-in tool emits it.**
   The shape exists; expect it to light up in v0.6+ when streaming-aware tools
   land (e.g., `tools.shell` for the codingAgent preset).
2. **Multi-process resume (`agent.wake(sessionId)`) is Feature 011.** This
   substrate makes it possible (events are fully recoverable from any adapter)
   but the wake primitive itself, advisory locking, and the three-surface
   `RunState`/`sessionState`/`snapshot` resolution order are out of scope here.
3. **Strict-durability adapter mode** (`fsync`-per-event) — recorded in
   `docs/roadmap.md` "Future / If Demand". Current best-effort matches Codex's
   stance; Anthropic's strong durability is appropriate for the v0.5 daemon.
4. **Optional `Agent<TVocab>` generic** for accumulated typed event vocabularies
   (Hono-style `.use()` chaining). Recorded as future work; v0.4 uses loose
   `Event<string, unknown>` at read site to keep `Agent` non-generic.
5. **`session-remote` adapter** (Codex-style remote `ThreadStore` analog) —
   v0.5 territory. The current `SessionStore` interface is shaped to
   accommodate it without breaking.

---

*Last revised: 2026-05-07 (v0.4 / Feature 010 implementation complete, post-code-review fixes).*
