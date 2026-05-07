---
title: Agent Express — Concept
status: shipped
ships-with: v0.4.0+
last-revised: 2026-05-07
audience: contributors
---

# Agent Express — Concept

> What this framework is, what primitive it builds on, and why it's a
> *framework* in the Express.js sense rather than a runtime in the
> Kubernetes sense.

This document is the architectural-concept overview for new contributors.
For the middleware interface specifics, see
[`middleware-interface.md`](middleware-interface.md). For the concrete agent
loop and lifecycle nesting, see [`agent-loop.md`](agent-loop.md). For the
v0.4 event-log substrate, see [`event-log.md`](event-log.md).

---

## 1. Position in the agent-tooling landscape

Two things have stabilized in 2025–2026: the LLM provider API surface
(messages + tool calls + streaming) and the basic agent shape (a loop that
calls a model, dispatches tool calls, feeds results back). What hasn't
stabilized is what's *on top* of the loop — the harness, the policies, the
state, the persistence, the multi-agent coordination, the observability.

Several frameworks have made a bet on a particular harness shape:

- Vercel AI SDK ships streaming and provider abstractions but no
  opinionated agent loop — you build the harness yourself.
- Mastra ships a full platform: agent loop, RAG, memory, deploy story.
  Opinionated harness, batteries-included.
- LangGraph models the agent loop as a directed graph — nodes execute,
  edges route. Powerful for branching workflows; heavier mental model.
- OpenAI Agents SDK ships a minimal agent loop with handoffs and a hosted
  state option (server-side conversations).
- Google ADK uses 8+ callback types at distinct lifecycle points.
- LangChain Deep Agents (Python) wraps LangGraph with a middleware stack —
  the middleware IS the API; the graph is implementation detail.

These are different bets on **what the right unit of customization is**.
Agent Express's bet is the same one that won the web-framework wars:
**`(ctx, next)` middleware**. Every JavaScript/TypeScript backend developer
already knows this pattern from Express, Koa, Hono. It's the muscle memory
the ecosystem already has. Applying it to the agent loop costs zero
conceptual learning.

---

## 2. The agent primitive

### 2.1 What's the "container" for agents?

Docker won because its primitive is simple and clear: filesystem + process
+ network namespace = container. The agent equivalent is harder, because an
agent is a *set of references to external resources* + instructions, not a
self-contained unit. There's no obvious agent-shaped box.

### 2.2 Agent definition vs agent session

The primitive is not "agent" (the static description) but **agent session**
(the live execution):

```
Agent Definition (like a Docker image)   Agent Session (like a container)
───────────────────────────────────      ─────────────────────────────────
Static description                       Live process
model + tools + instructions             current state + memory + history
Version-controlled                       Ephemeral or persistent
One definition                           Many concurrent sessions
```

Agent Session has identity (session ID, parent agent, user/caller), state
(working memory, turn history, pending tool calls), resources (model
budget, tool permissions, time limit), lifecycle (created → running →
waiting → completed/failed), and observability (trace, cost, latency).

This is the primitive. Agent Express makes it first-class via the
[`Session`](../../src/session.ts) class — see
[`agent-loop.md`](agent-loop.md) for the lifecycle layers and where
each middleware hook fires.

### 2.3 Why it's premature to build a runtime

Historical progression in adjacent ecosystems:

```
Web platform:    CGI (1995) → Frameworks (2005) → Docker (2013) → K8s (2014)
Agent platform:  Raw LLM calls (2023) → Frameworks (2025) → ??? → ???
```

We are at the **framework stage**, not the runtime stage. The agent
primitive has not stabilized across the industry. Building a runtime on
top of an unstable primitive — a daemon that owns scheduling, storage,
multi-tenancy — is building Kubernetes before Docker. The framework must
*define* the primitive through real usage first.

This is why agent-express ships as an npm library that embeds in your
existing HTTP server (Express / Hono / Fastify / Next.js / etc.), not as
a daemon you run separately. The future may include a daemon adapter —
see the roadmap — but the framework comes first.

---

## 3. Framework, not runtime

### 3.1 The distinction

```
Runtime (premature):                Framework (timely):
─────────────────────               ────────────────────
Standalone daemon/server            Library (npm install)
Manages its own lifecycle           Helps you BUILD agents
Owns storage, scheduling            Uses YOUR DB, YOUR server
Heavy, opinionated                  Light, composable
"Run my server"                     "Add to your server"

= Kubernetes, Docker daemon         = Express.js, Spring Framework
```

### 3.2 Why frameworks ship before specs

No infrastructure standard ever won spec-first:

```
Docker:     Working runtime (2013) → adoption → OCI spec (2015)
Kubernetes: Working orchestrator (2014) → adoption → CRI/CSI/CNI (2016-17)
MCP:        Working in Claude (2024) → Cursor/Zed adopt → spec evolves
```

Spec-first attempts (Agent Protocol from e2b being the cautionary
example) tend to die in committee. Rule of thumb: spec follows software.

### 3.3 The Express.js analogy

Express won because of four things:

1. **Middleware** — a universal composable pattern, one interface
2. **Minimalism** — tiny core, large ecosystem
3. **Non-opinionated** — REST? GraphQL? Your call
4. **Escape hatch** — when Express isn't enough, you're already in Node

The same applies to agents. Most agents are linear pipelines, not
DAGs (see § 4 below). Middleware is the right abstraction for the
common case, with escape hatches (raw LLM calls, external orchestrators)
for the complex case.

---

## 4. Why middleware beats graphs for most agents

The 95% pattern looks like this:

```
User message
  → [pre-process: inject memory, context]
  → LLM call
  → [post-process: validate, extract tool calls]
  → Tool execution
  → [post-process: format results]
  → LLM call (with tool results)
  → [post-process: verify, format]
  → Response
```

This is a **pipeline**, not a graph. Middleware is the natural abstraction
for pipelines. LangGraph's graph model (inspired by Google Pregel BSP)
introduces concepts most agent developers don't need: StateGraph,
TypedDict reducers, super-steps, conditional edges. Powerful for the 5%
case (complex workflows with cycles, parallel branches, dynamic routing);
overhead for the 95%.

Deep Agents validates this: `create_deep_agent()` hides LangGraph's graph
behind a middleware stack. The middleware *is* the real API; the graph is
implementation detail. Agent Express removes the graph entirely for the
common case, keeping middleware as the primitive.

For workflows that genuinely need a graph: agent-express composes with
external orchestrators (Temporal, Inngest, Cloudflare Workflows). Don't
fight your problem with the wrong abstraction.

---

## 5. The middleware unit

```typescript
type Middleware = {
  name: string
  state?: StateSchema       // declares session state fields
  events?: EventTypeMap     // declares event types this middleware emits

  // 5 optional onion hooks — middleware implements only what it needs
  agent?(ctx, next): Promise<void>
  session?(ctx, next): Promise<void>
  turn?(ctx, next): Promise<void>
  model?(ctx, next): Promise<ModelResponse>
  tool?(ctx, next): Promise<ToolResult>
}
```

Each runtime hook (`session` / `turn` / `model` / `tool`) follows the
same `(ctx, next)` onion pattern. Code before `await next()` runs on the
way in; code after runs on the way out. A middleware that wants to
intercept tool execution implements `tool`. A middleware that wants to
hold session state implements `session`. A middleware that wants to do
both does both.

Full design rationale and signature details:
[`middleware-interface.md`](middleware-interface.md). Where each hook
fires within the agent loop:
[`agent-loop.md`](agent-loop.md).

---

## 6. Embeds, doesn't host

The framework does not own the server. It exposes a handler that any HTTP
framework can mount:

```typescript
// Express
import express from "express"
const app = express()
app.post("/chat", toExpressHandler(createHandler(agent)))

// Hono (Cloudflare Workers, Bun, Deno, Node)
import { Hono } from "hono"
const honoApp = new Hono()
honoApp.post("/chat", toHonoHandler(createHandler(agent)))

// Direct Web standard Request/Response (Bun, Deno, edge runtimes)
const handler = createHandler(agent)
Bun.serve({ fetch: handler })

// CLI / scripts (no server)
const result = await agent.run("hello").result

// Tests
const { result } = await testAgent(agent, "hello")
```

The HTTP handler streams events as Server-Sent Events. Sessions can be
keyed by header (`x-session-id`) for stateful conversations across
requests. Storage is plug-in: SQLite for development, Redis or Postgres
for production, all shipped as adapter packages with the same
[`SessionStore`](../../src/types.ts) interface — see
[`event-log.md`](event-log.md) for the contract.

---

## 7. Architecture comparison

This is the most direct technical contrast against alternatives in the
TS / Python agent-framework space. Each framework solves the same
problem (run an agent loop, manage state, integrate tools) but bets on
different primitives.

| Concern | Vercel AI SDK | Mastra | LangGraph | OpenAI Agents SDK | Google ADK | Deep Agents | **Agent Express** |
|---|---|---|---|---|---|---|---|
| Core primitive | Provider streams | Agent + Workflows | StateGraph | Agent + Handoffs | Runner + Session | LangGraph + middleware | Agent + Middleware |
| Customization unit | Function call | Class hierarchy | Graph node | Class config | 8+ callbacks | Middleware (Python) | `(ctx, next)` |
| Multi-turn | Manual messages[] | `Memory` thread/resource | Checkpointer + thread_id | `Session` interface | First-class `Session` | Inherited from LangGraph | First-class `Session` |
| State across turns | None native | Yes (Memory) | Yes (Checkpointer) | Yes (Session) | Yes (state field) | Yes | Yes (event log + state) |
| Onion middleware | model only | HTTP + tool only | Graph nodes (not onion) | EventEmitter only | 6 callbacks (not onion) | 4 hook types | 5-level onion |
| Tool integration | Function calling | Native + MCP | Graph nodes | Native + MCP | Native | LangChain tools | Function tools + MCP |
| Streaming | ✅ first-class | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ same Event objects across stream + log |
| HTTP server | None | Hono baked in | None | None | Built-in | None | Embeds (Express/Hono/Fastify/Web standard) |
| Storage adapters | None native | SQLite/Postgres/Mongo/Mem | Multiple | OpenAI Conversations API | Multiple | Inherited | SQLite/Redis/Postgres event log |
| Language | TS | TS | TS+Py | TS+Py | Multi (Java/Py/Go) | Python only | TS only |
| Distribution | npm | npm | npm/pip | npm/pip | Multi-lang | pip | npm |

The differentiation isn't feature breadth — Mastra has more out-of-the-box
than agent-express. The differentiation is **the customization unit**.
agent-express is the only TS framework that exposes `(ctx, next)` as the
single composable primitive across all five lifecycle layers (agent /
session / turn / model / tool). Every other framework either has a
different primitive (graph node, callback, class hierarchy) or has
middleware at fewer layers.

For most agent shapes this is the right trade. For the 5% of workflows
that need a real graph, use agent-express alongside an external
orchestrator (Temporal, Inngest, Cloudflare Workflows).

---

## 8. Reading order for new contributors

1. This document — what we're building and why
2. [`middleware-interface.md`](middleware-interface.md) — the
   `(ctx, next)` contract in detail
3. [`agent-loop.md`](agent-loop.md) — the 5-level lifecycle nesting
   (agent / session / turn / model / tool) and the model→tool→model
   loop within one turn
4. [`event-log.md`](event-log.md) — the v0.4 substrate: typed events as
   the canonical session record, durability, adapter contract
5. [`providers.md`](providers.md) — how `"provider/model"` strings
   resolve to AI SDK V3 model instances
6. [`adapters.md`](adapters.md) — the three adapter families (session
   stores, embeddings, search) and their contracts
7. [`observability.md`](observability.md) — six observability
   middlewares (in-memory tracking + log/metrics/traces export)
8. [`testing.md`](testing.md) — the testing toolkit (`testAgent`,
   `FunctionModel`, recorder cassettes, real-request guard)

After this stack, the [`research/`](../research/) directory has
reverse-engineering notes on Anthropic Managed Agents, OpenAI Codex,
LangChain Deep Agents, and OpenClaw — useful when discussing why
agent-express makes the choices it does relative to other platforms.
