---
title: Event Log
status: shipped
ships-with: v0.4.0+
last-revised: 2026-05-07
audience: contributors
---

# Agent Express: Event Log Implementation (v0.4)

> Engineering reference. Describes how the event log substrate is wired in the
> code as it ships in v0.4. Cross-checked against Anthropic Managed Agents
> ([`../research/anthropic-managed-agents.md`](../research/anthropic-managed-agents.md))
> and OpenAI Codex `thread-store` / `app-server`
> ([`../research/openai-codex.md`](../research/openai-codex.md)).

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
default `synchronous_commit`, Redis AOF=everysec. Rationale: agent-express
is a framework, not a managed-cloud platform; per-event `fsync` × dozens of
events per turn = noticeable latency tax. A `kill -9` of the Node process
loses no events that already returned from `emit` (writer drain handles it);
a kernel panic / power-off MAY lose the last few ms of buffered writes.
Strict-durability mode (`fsync` per event) is recorded in `docs/roadmap.md`
under "Future / If Demand".

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
deliberately diverges.

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

**Sibling design documents**:
- [`agent-express-concept.md`](agent-express-concept.md) — what the
  framework is and why session is the primitive (the event log is how
  the session primitive is materialized in v0.4)
- [`agent-loop.md`](agent-loop.md) — when each event fires within the
  agent loop (§ 8 maps every event type to its emission point)
- [`middleware-interface.md`](middleware-interface.md) — the
  `Middleware` interface that declares `events:` and consumes them via
  hook context
- [`adapters.md`](adapters.md) — the `SessionStore` contract that
  durable backends implement
- [`observability.md`](observability.md) — the events-vs-state choice
  for observability middleware (§ 17.5 here is the design rationale)

**Source code**:
- `src/event-log/` — the event log substrate (see § 4 for the file layout)
- `src/run.ts` — `AgentRun` streaming iterator
- `src/session.ts` — `Session` class, `executeTurn`, drain at turn:end
- `src/agent.ts` — `agent.init()` wiring, `findSessionStore` via the
  `SESSION_STORE_PROVIDER` symbol
- `src/middleware/memory/store.ts` — `memoryStore()` middleware that
  advertises a `SessionStore` and replays events on session start
- `packages/session-{sqlite,redis,postgres}/` — three bundled storage adapters

**Tests that exercise the pipeline end-to-end**:
- `tests/integration/durable-persistence.test.ts` — full Agent + memoryStore
  + sqliteStore round-trip; session resume replay; idempotent re-emit
- `tests/event-log/event-log.test.ts` — EventLog primitive (append, subscribe,
  replay, subscriber-throw containment, close)
- `tests/event-log/extensibility.test.ts` — middleware-declared event types,
  `typedEvents` helper, collision detection, forward-compat read

**Reference architectures the design borrows from**:
- `docs/research/anthropic-managed-agents.md` — Brain/Hands/Session
  decomposition, 6 procedural methods, credential proxy patterns
- `docs/research/openai-codex.md` — `RolloutItem` JSONL,
  `ThreadStore::Local|Remote|InMemory`, recovery via replay

**Roadmap context**:
- `docs/roadmap.md` — multi-process resume (`agent.wake`) builds on this
  substrate; pluggable `ContextAssembler` consumes events for compaction;
  multi-agent primitives (`agent:handoff`, `agent:delegate`) emit reserved
  types declared here

---

## 17. Design Rationale & References

The choices documented above didn't emerge from first principles. They're a
deliberate distillation of three things converging in 2026: Anthropic's
managed-agents architecture, OpenAI Codex's `thread-store` / `app-server`
shape, and 30 years of event-sourcing practice from the DDD / Kafka world.
This section maps each design choice to the public source that influenced it.

### 17.1 Why an event log at all (not a message array)

**Source**: Anthropic, "Scaling Managed Agents: Decoupling the brain from the
hands" — https://www.anthropic.com/engineering/managed-agents

Anthropic's central insight: *"the session provides this same benefit, serving
as a context object that lives outside Claude's context window."* The harness
is stateless; the session log is the source of truth; any harness can
`wake(sessionId)` and reconstruct context. That decoupling delivered ~60% p50
TTFT improvement and >90% p95 in their production deployment.

Anthropic's session is conceptually identical to what we call the event log
here. Their public procedural API (`emitEvent` / `getEvents` / `getSession` /
`wake` / `provision` / `execute`) shaped our `SessionStore` interface —
ours is intentionally narrower because we don't yet ship the sandbox /
provision side of the contract.

**Convergent evidence**: OpenAI Codex independently arrived at the same
shape. Codex's `RolloutItem` JSONL append-only journal is structurally the
same primitive — we cross-checked the design against
https://github.com/openai/codex/tree/main/codex-rs/thread-store. When two
independent platforms converge on "append-only typed event log per
conversation as the canonical durable record", that's the strongest
positive signal in the design space.

### 17.2 Why fine-grained event types vs a coarse enum

**Source**: Claude Agent SDK (TypeScript) message types —
https://github.com/anthropics/claude-agent-sdk-typescript and the SDK
reference at https://code.claude.com/docs/en/agent-sdk/typescript

Anthropic's SDK exposes `SDKUserMessage`, `SDKAssistantMessage`,
`SDKResultMessage`, `SDKSystemMessage`, `SDKCompactBoundaryMessage`,
`SDKHookStartedMessage` / `SDKHookProgressMessage` / `SDKHookResponseMessage`,
`SDKToolUseSummaryMessage`, `SDKRateLimitEvent` — fine-grained, one event
per logical occurrence. Codex chose the opposite: `RolloutItem` is a
5-variant enum where many things hide under a generic `EventMsg` variant.

We chose Anthropic-style fine grain because:
1. Validation is meaningful (each event type has a specific Zod schema)
2. Streaming consumers can branch on `event.type` for UI / dev-console /
   observability without parsing nested envelope variants
3. The `tool:call` / `tool:result` naming aligns with industry vocabulary —
   matches Codex `app-server`'s `item/started` + `item/completed` pattern
   for tool items even though the data shape differs

### 17.3 Why a unified streaming + persistent surface

**Source**: convergence between Anthropic Managed Agents (events drive
streaming AND replay) and Codex `app-server`'s notification protocol —
https://developers.openai.com/codex/app-server

Codex's `app-server` emits server-to-client notifications (`thread/started`,
`turn/started`, `item/agentMessage/delta`, `turn/completed`, etc.) over
JSON-RPC. Those notifications ARE the same events that Codex's `RolloutItem`
JSONL persists — same data, two transport modes.

We made this property explicit: the `for await ... of agentRun` iterator
yields the same `Event` objects (referential equality, same `id`s) that
`session.events` exposes that storage adapters persist. v0.3 had separate
`StreamEvent` (flat shape, no IDs) and `Message[]` (different shape,
no IDs) — we eliminated the drift.

### 17.4 Why best-effort durability (not strict fsync per event)

**Source**: OpenAI Codex's deliberate stance documented in
`codex-rs/rollout/src/recorder.rs` and reverse-engineered in our research
notes. Specifically: Codex's writer task uses bounded `mpsc` channels (capacity
256), background drain via tokio task, **no `fsync`** — survives `kill -9`
via OS page cache, may lose tail under kernel panic / power loss.

Anthropic's managed-cloud architecture sits on the other side: every event
durably committed before acknowledgment. That's appropriate for a managed
PaaS where the platform owns the durability promise to customers.

agent-express is a framework, not a managed cloud. Per-event `fsync` × dozens
of events per turn = ~5–10ms × 30 = noticeable latency tax for the
embedded use case. Codex's empirical evidence (millions of users on the
best-effort model) is what tipped the design.

The strict-durability mode (`SessionStore.durability: "strict" | "best-effort"`)
is recorded in `docs/roadmap.md` for if-and-when a real user reports event
loss in a tail-of-turn crash.

### 17.5 Why per-event `(sessionId, eventId)` idempotency

**Source**: standard pattern from Kafka / RabbitMQ / SQS exactly-once
semantics. Specific influence: Anthropic's mention of *"`emitEvent` is
durable + (inferred) idempotent via deterministic event IDs"* in their
Engineering article.

Codex's `LocalThreadStore` doesn't enforce uniqueness because it's a JSONL
append file — the file IS the constraint. Network adapters need explicit
uniqueness. We made the invariant load-bearing across all adapter shapes
(SQL `(session_id, event_id) PRIMARY KEY`, Redis `event-ids` set guard,
Postgres `ON CONFLICT DO NOTHING`) because the v0.5 remote-daemon adapter
will exercise it.

### 17.6 Why UUIDv7 (not ULID, not Snowflake, not autoincrement)

**Source**: RFC 9562 (UUIDv7 specification, 2024) —
https://www.rfc-editor.org/rfc/rfc9562. Adopted by Anthropic SDK
(events carry `uuid` per Claude Agent SDK message types) and the broader
distributed-database industry (PostgreSQL 17 added `uuidv7()`, MongoDB,
ScyllaDB, etc.).

Properties we wanted:
- Timestamp-prefixed → lexicographically sortable ≈ chronological order
  (so storage doesn't need a separate ORDER BY ts)
- Decentralized (no coordinator) → embedded use case works without
  network calls
- 128-bit collision-free at production scale
- Standard UUID format → broad tooling support

ULID has the same properties but isn't UUID-shaped (Anthropic SDK
convention divergence). Snowflake needs coordination. KSUID is 27 bytes.
Autoincrement requires central authority. UUIDv7 won.

### 17.7 Why Zod validation at emit (not just types)

**Source**: real-world LLM safety practice. tRPC, Mastra, LangChain Zod
schemas — https://github.com/colinhacks/zod and the broader TypeScript
ecosystem norm of "validate at boundaries."

Pure TypeScript types don't survive the runtime. An LLM can produce
malformed tool output; a middleware can emit a struct missing a required
field; a downstream package can be on a slightly different schema version.
Zod `safeParse` at the emit boundary is the cheap defense.

Specific call-out: Zod accepts shapes that don't round-trip through
JSON.stringify (functions, BigInt, Date instances, `undefined` values,
circular refs). We added a JSON-replacer guard as the second validation
layer — if Zod accepts a value that storage can't represent, the event
emission fails synchronously rather than silently corrupting the durable
log. This two-layer pattern is industry-standard for serialization
boundaries (e.g., gRPC + protobuf marshaling).

### 17.8 Why middleware-declared event vocabulary (not closed enum)

**Source**: deliberate divergence from both Anthropic SDK and Codex
`app-server`. Both ship closed event enums versioned by the platform itself.
To add `channel:slack:inbound` to either platform you'd fork the codebase.

The `Middleware.events` extension point is the load-bearing piece of
agent-express's "harness customization framework" positioning. The
inspiration is Express.js / Hono — the `(ctx, next)` middleware function
is the harness primitive, and just as middleware can declare its own state
schema, it should declare its own event schema. Vocabulary is part of what
the user customizes.

This is also where v0.4 most clearly diverges from prior art. Cross-comparison
covered in detail in `docs/design/event-log.md` § 13 above.

### 17.9 Why bounded queue + background writer (not direct write)

**Source**: standard backpressure pattern from Tokio, Trio, asyncio. Specific
prior art:
- Codex `rollout/src/recorder.rs` — bounded mpsc channel (capacity 256),
  background `rollout_writer` tokio task, retry on transient failure
- Tokio's standard MPSC backpressure idiom

Direct write per emit would block the agent loop on disk I/O for every
streaming chunk. The bounded queue lets emit run at memory speed (~1µs)
while the writer drains at adapter speed (~1–5ms per write). The
`drain(sessionId)` call at `turn:end` is the durability sync point.

The capacity of 256 is borrowed from Codex's empirical choice — large
enough that typical turns never block; small enough to bound memory.

### 17.10 Why `derive-history` projects only user/assistant messages

**Source**: matches v0.3 SessionState behavior. The v0.3 implementation only
called `addMessage` for user input and final assistant text — tool calls /
results were NOT in `session.history`. The agent loop in `loop.ts` builds
its model-call message array dynamically per turn, including tool messages
inline within the turn but not preserving them across turns.

Anthropic's SDK default agent loop and OpenAI's function-calling pattern
both rebuild tool history fresh per turn from the assistant's natural-language
reflection ("I called tool X and got result Y"). Verbatim cross-turn tool
history is a minority requirement; users who need it can write a custom
projection over `session.events` (the raw log preserves everything).

### 17.11 Reading list for contributors

The below are the public sources we read carefully when designing this
substrate. Listed in order of how foundational each is to the design:

**Anthropic primary** (foundational — read first if contributing)
- *Scaling Managed Agents: Decoupling the brain from the hands* —
  https://www.anthropic.com/engineering/managed-agents
- *Effective harnesses for long-running agents* —
  https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- *Harness design for long-running application development* —
  https://www.anthropic.com/engineering/harness-design-long-running-apps

**Anthropic SDK reference**
- Claude Agent SDK (TypeScript) GitHub —
  https://github.com/anthropics/claude-agent-sdk-typescript
- Agent SDK reference docs — https://code.claude.com/docs/en/agent-sdk/typescript
- Hosting docs (sandbox patterns) —
  https://code.claude.com/docs/en/agent-sdk/hosting
- Cost tracking docs (usage / cost-per-call) —
  https://code.claude.com/docs/en/agent-sdk/cost-tracking
- Secure deployment docs (credential isolation) —
  https://code.claude.com/docs/en/agent-sdk/secure-deployment

**OpenAI Codex** (foundational — read first if contributing)
- Codex GitHub (codex-rs Rust implementation) — https://github.com/openai/codex
- Codex `thread-store` crate (storage abstraction) —
  https://github.com/openai/codex/tree/main/codex-rs/thread-store
- Codex `app-server` developer protocol —
  https://developers.openai.com/codex/app-server

**Standards & specifications**
- RFC 9562 — Universally Unique IDentifiers (UUIDv7) —
  https://www.rfc-editor.org/rfc/rfc9562
- JSON Schema 2020-12 — https://json-schema.org/specification
- CloudEvents 1.0 (envelope-and-payload event shape) —
  https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md

**Industry / framework references**
- Apache Kafka design (event log as foundational primitive, replay semantics) —
  https://kafka.apache.org/documentation/#design
- Event Sourcing pattern (Martin Fowler) —
  https://martinfowler.com/eaaDev/EventSourcing.html
- Anthropic vs OpenAI architectural comparison (DEV Community write-up,
  cross-checked against the primary sources above) —
  https://dev.to/_46ea277e677b888e0cd13/anthropic-managed-agents-architecture-decoupling-brain-from-hands-for-scalable-ai-agents-295k

**Onion-middleware lineage** (where the `(ctx, next)` shape comes from)
- Express.js middleware — https://expressjs.com/en/guide/using-middleware.html
- Koa.js context + cascading middleware — https://koajs.com/#middleware
- Hono framework (modern type-safe `(c, next)` middleware) —
  https://hono.dev/docs/concepts/middleware

If you're contributing event-log changes, the **Anthropic primary** and
**OpenAI Codex** clusters are the most important — they describe the
convergent platform-level decisions that shaped why we built it this way.
The rest are useful background.

---

## 18. Open Questions / Future Work

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

*Last revised: 2026-05-07 (v0.4 implementation complete, post-code-review fixes).*
