# Anthropic Managed Agents — Architectural Reference

Reverse-engineered from publicly available materials, generated 2026-04-29.
Used as design reference for agent-express v0.4 framework + v0.5 Go server.

## Executive Summary

- **Anthropic Managed Agents** virtualises a Claude-powered agent into three independently scalable, replaceable components: **Brain** (Claude + harness), **Hands** (sandboxes/tools), and **Session** (durable append-only event log).
- The harness is **stateless**. Failure recovery and horizontal scaling work because the entire session lives outside any one process: any harness can `wake(sessionId)` and reconstruct context.
- All inter-component communication is **procedural and uniform** — sandboxes/tools through `execute(name, input) → string`; session through `getEvents()`/`emitEvent()`/`getSession()`. The harness "doesn't know whether the sandbox is a container, a phone, or a Pokémon emulator."
- **Credentials never enter the sandbox.** Bundled into resources at provision time, OR fetched on demand by an MCP/credential proxy outside the agent's trust boundary.
- Decoupling produced ~60% reduction in p50 TTFT and >90% reduction in p95 by deferring container provisioning, enabling N:M brain-to-hands connectivity, and treating sandboxes as cattle rather than pets.

## Core Conceptual Model (direct quotes)

| Primitive | Anthropic's definition (quote) | Scope |
|---|---|---|
| **Brain** | "Claude and its harness" | Reasoning side. Stateless, horizontally scalable. Holds no durable state of its own. |
| **Hands** | "sandboxes and tools that perform actions" | Anything that performs side effects. Containers, MCP servers, phones, emulators — uniformly invoked. "No hand is coupled to any brain, brains can pass hands to one another." |
| **Session** | "the log of session events" | Append-only ordered record of everything that happened. Outlives any single harness process. "The session provides this same benefit, serving as a context object that lives outside Claude's context window." |
| **Harness** | "the loop that calls Claude and route Claude's tool calls to the relevant infrastructure" | One process worth of the agent loop: load events → call Claude → dispatch tool calls via `execute()` → emit result events → repeat. Newly stateless: the loop no longer lives inside the same container as the tools. |
| **Sandbox** | "an execution environment where Claude can run code and edit files" | A specific container/VM/microVM where code Claude generates actually runs. Disposable; provisioned on demand; never holds long-lived credentials. |
| **Event log** | (the contents of a Session) | Append-only, durable, queryable. Event types observed: `user_message`, `assistant_message`, `tool_call`, `tool_result`, `context_reset`. |
| **MCP proxy / credential proxy** | "For custom tools, we support MCP and store OAuth tokens in a secure vault. Claude calls MCP tools via a dedicated proxy; this proxy takes in a token associated with the session." | Sits outside agent trust boundary. Receives session-scoped token, fetches credentials from vault, makes outbound call. Neither harness nor sandbox sees the secret. |
| **Resources** (parameter to `provision`) | (inferred) | Descriptor of what sandbox needs: image, mounts, network policy, attached credentials/identities, optionally pre-bundled tokens. |

## Procedural API (the 6 methods)

### Sandbox interface (Hands)

```
execute(name: string, input: unknown) → Promise<string>
provision({ resources }) → Promise<SandboxHandle>
```

- `execute` is the single uniform verb. Article explicit: "a name and input go in, and a string is returned." Forces harness to be agnostic about what's behind the name.
- `provision` is on-demand. Lazy provisioning (only when a `tool_call` actually needs a sandbox) is the source of the 60%/90% TTFT improvement.

### Session interface

```
emitEvent(id: SessionId, event: Event) → Promise<void>
getEvents(id, opts?) → Promise<Event[]>
getSession(id) → Promise<Session>
```

- `emitEvent` is durable + (inferred) idempotent via deterministic event IDs.
- `getEvents` supports "flexible positional slicing" — by index, range, offset; "rewind to previous moments" possible.
- `getSession` returns full session metadata + log; used by `wake()` and tools needing replay.

### Harness interface

```
wake(sessionId) → Promise<HarnessHandle>
```

- Boots a fresh harness process and attaches it to an existing session. Reads event log, reconstructs context, resumes the loop.
- Primary recovery primitive — when a harness dies, any other host can `wake()` and pick up exactly where left off.

## Data Model

**Event structure** (mostly inferred):
```
Event {
  id                      // ordinal / monotonic
  session_id              // explicit in SDK message types
  timestamp               // [INFERRED]
  type                    // "user_message" | "assistant_message" | "tool_call"
                          //   | "tool_result" | "context_reset" | ...
  payload                 // type-dependent
  parent_tool_use_id?     // for nesting (subagent / batched tool calls), explicit in SDK
}
```

**Event types named or strongly implied:**
- `user_message` — user input
- `assistant_message` — model response (with `usage` block)
- `tool_call` — tool name + input
- `tool_result` — string result
- `context_reset` — compaction boundary

The Claude Agent SDK exposes a richer surface for the same conceptual model: `SDKUserMessage`, `SDKAssistantMessage`, `SDKResultMessage`, `SDKSystemMessage`, `SDKCompactBoundaryMessage`, `SDKHookStartedMessage` / `SDKHookProgressMessage` / `SDKHookResponseMessage`, `SDKToolUseSummaryMessage`, `SDKRateLimitEvent`. Each carries `uuid` and `session_id`.

**Querying:** flexible positional slicing — by index, range, or offset. Supports cursor-based replay during `wake`, range reads when reconstructing a context window, seeking to compaction boundaries, rewinding for forking/branching scenarios.

**Schema versioning** [SPECULATION]: not documented publicly. Some form of forward-compatible event envelope is almost certain — likely a `version` field plus tolerant deserialization.

**Persistence** [INFERRED / SPECULATION]: Anthropic does not name the storage system. Append-only, ordered, range-queryable, multi-tenant access pattern fits a log-structured store (Kafka-like) or partitioned RDBMS table keyed `(session_id, ordinal)`. The SDK is storage-agnostic — `sessionStore?: SessionStore` option lets users plug their own.

**Multi-tenancy** [PUBLIC at SDK level]: each session has `session_id`. Platform-level isolation is at *resource* boundary — credentials never leave the proxy, sandboxes are per-session and disposable, event log keyed by session id.

## Execution Flow

```
   Client                Harness              Session             Sandbox / Hand
     │                     │                    │                    │
     │  start(sessionId)   │                    │                    │
     │────────────────────►│                    │                    │
     │                     │  getSession(id)    │                    │
     │                     │───────────────────►│                    │
     │                     │◄─── events ────────│                    │
     │                     │                    │                    │
     │                     │ build context window from events        │
     │                     │                    │                    │
     │                     │── call Claude ────────────────────────► │ (Brain)
     │                     │◄── tool_call(s) ─────────────────────── │
     │                     │                    │                    │
     │                     │  emitEvent(tool_call)                   │
     │                     │───────────────────►│                    │
     │                     │                    │                    │
     │                     │  (lazy) provision({resources})          │
     │                     │────────────────────────────────────────►│
     │                     │  execute(name, input)                   │
     │                     │────────────────────────────────────────►│
     │                     │◄────────────── result string ───────────│
     │                     │                    │                    │
     │                     │  emitEvent(tool_result)                 │
     │                     │───────────────────►│                    │
     │                     │                    │                    │
     │                     │── loop until model emits final text ──► │
     │◄── stream events ───│                    │                    │
                                                                     
  ── crash ──                                                        
                                                                     
  New harness process anywhere:                                      
     │  wake(sessionId)    │                    │                    │
     │────────────────────►│ getSession ───────►│                    │
     │                     │◄── full log ───────│                    │
     │                     │ resume mid-loop                          
```

**Key properties:**
- Harness assembles Claude's context window *each turn* by reading events. Slicing/summarisation/compaction strategy is harness's call — Anthropic deliberately leaves it flexible "because they can't predict what specific context engineering will be required in future models."
- Sandboxes provisioned **lazily** (only when `tool_call` needs one). Source of TTFT improvement.
- After a crash, `wake(sessionId)` rebuilds session-level state; in-flight tool calls that didn't make it into the event log are simply replayed by the model.

## Sandbox Architecture

- **Provisioning:** `provision({ resources })`. Resources include image, CPU/memory, attached credentials (e.g., pre-bundled git remote URL), network policy.
- **Protocol harness ↔ sandbox** [INFERRED]: not named publicly. Given `execute(name, input) → string` and the "phone or Pokémon emulator" analogy, almost certainly RPC-over-HTTP/gRPC on top of MCP-style dispatch.
- **Inside sandbox:** isolated filesystem, process tree, controlled network egress, **no long-lived credentials**. Tokens bundled at provision time (Pattern 1) or via MCP/credential proxy (Pattern 2).
- **Lifecycle:** per-session is dominant pattern. SDK Hosting docs list patterns: "Ephemeral Sessions", "Long-Running Sessions", "Hybrid Sessions", "Single Containers".
- **Failure modes:** sandbox crash cannot lose Brain state because Brain state lives in Session log. Surfaces as tool error event.
- **Sandbox technology:** Anthropic doesn't name internal tech. Public SDK Hosting docs list **sandbox-runtime** (bubblewrap on Linux, sandbox-exec on macOS), **Docker**, **gVisor**, **Firecracker microVMs**, **QEMU**, plus third-party providers Modal, Cloudflare Sandboxes, Daytona, E2B, Fly Machines, Vercel Sandbox.

## Credentials / Auth Architecture

Two named patterns:

**Pattern 1 — Bundle at provision time.** Credentials baked into resources before sandbox handed to agent. Canonical example: git token wired into remote URL during provisioning. Agent loop never sees token; just runs `git push`.

**Pattern 2 — Vault + MCP proxy.** "For custom tools, we support MCP and store OAuth tokens in a secure vault. Claude calls MCP tools via a dedicated proxy; this proxy takes in a token associated with the session." Proxy:
1. receives tool call from Claude through harness
2. looks up *session-scoped* token
3. fetches matching credentials from vault
4. makes outbound API call
5. returns result back to model

Neither harness, sandbox, nor model sees the secret. Session ID is the key — multi-tenancy enforced because each session resolves to its own credential set.

Public SDK security docs generalise: "rather than giving an agent direct access to an API key, you could run a proxy outside the agent's environment that injects the key into requests" — same pattern, available via Envoy's `credential_injector`, mitmproxy, LiteLLM, or custom MCP server.

## Context Window Management

Central claim: **"the session provides this same benefit, serving as a context object that lives outside Claude's context window."**

Mechanism:
- Session log is source of truth.
- Each turn, harness reads events through `getEvents()` and *constructs* prompt sent to Claude. Slicing/summarisation/compaction are harness concerns, not session concerns.
- Anthropic deliberately leaves compaction strategy open: "they can't predict what specific context engineering will be required in future models."
- Two complementary patterns from harness-design posts:
  - **Context resets:** between sessions, start fresh window; recover state from artefacts (git history, `claude-progress.txt`, feature lists).
  - **In-place compaction:** replaced by stronger models (Opus 4.6) that "plan more carefully, sustain agentic tasks for longer."
- SDK exposes `PreCompact` and `SDKCompactBoundaryMessage` as first-class events — compaction is logged in the same event stream.

## Multi-Agent

**"Brains can pass hands to one another."** Operationally:
- Sandboxes addressed by handle (or name through `execute`); don't hold per-brain state. Two harnesses can sequentially or concurrently use the same hand.
- Subagent/delegation reflected in SDK as `parent_tool_use_id` linking events, plus dedicated lifecycle hooks `SubagentStart` / `SubagentStop` and tool input `AgentInput { subagent_type, model, max_turns, isolation: "worktree", ... }`.
- Harness-design post describes three-agent architecture (Planner / Generator / Evaluator) communicating through file artefacts ("sprint contracts") rather than direct shared memory — consistent with sessions being the only durable communication channel.

[SPECULATION]: no public spec for how brains hand off; simplest interpretation is parent harness obtains sandbox handle, opens child session, passes handle by reference.

## Observability

Stated publicly:
- TTFT metrics: p50 dropped ~60%, p95 dropped >90% after decoupling.
- Cost tracking in SDK: `SDKResultMessage.total_cost_usd`, `modelUsage[model] = { costUSD, inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens }`. Docs explicitly warn this is client-side estimate; authoritative billing comes from Usage and Cost API.
- Per-step usage on every assistant message (`message.message.usage`); deduplicate by `message.id` for parallel tool batches.
- `permission_denials` explicit on result message.
- Log itself *is* observability surface — every tool call, tool result, model response, permission decision in event stream.

[INFERRED]: per-session tracing via `session_id`; tool call correlation via `tool_use_id`; structured logs / OpenTelemetry from harness, sandbox, proxy independently.

## Comparison to Other Architectures

| Aspect | Anthropic Managed Agents | OpenAI Agents SDK | Temporal | AWS AgentCore | LangGraph (durable) |
|---|---|---|---|---|---|
| State model | Append-only event log per session, external to model | Hosted "thread" / response state on OpenAI side | Workflow event history (similar idea, generic) | Managed runtime + memory store | Checkpointer-backed graph state |
| Execution loop | Stateless harness, `wake(sessionId)` recovery | Hosted Responses + sandboxes | Stateless workers, replay from history | Managed runtime, opaque | Stateless graph step, replay from checkpointer |
| Tool layer | Uniform `execute(name, input) → string` | Tool calls + sandboxes (some hosted) | Activities (typed RPC) | Managed gateway | Tool nodes within graph |
| Sandboxing | Per-session disposable; tech open | Hosted sandbox tools | None native | Managed | None native |
| Credentials | MCP/credential proxy outside trust boundary | Connectors, OAuth handled by OpenAI | User-managed | IAM-driven | User-managed |
| Multi-agent | Brains can pass hands; subagents via SDK | Hosted handoff primitives | Generic workflow nesting | Multi-agent collaboration primitives | Graph-of-graphs |

**Convergence:** Temporal, LangGraph, Anthropic all converge on *event-sourced, replayable* execution as durability primitive.

**Divergence:**
- Anthropic separates credentials at architectural level (MCP/credential proxy as first-class infra). Others leave to user.
- OpenAI hosts state inside its platform (Threads/Responses); Anthropic's Session is conceptually same but designed around assumption that *harness, not model API, owns the loop*.
- AWS AgentCore is managed runtime; Anthropic Managed Agents is procedural API surface — closer to Temporal than to AgentCore.

## Architectural Diagrams

### Component diagram

```
                  ┌──────────────────────────────┐
                  │   Client / API consumer       │
                  └───────────────┬───────────────┘
                                  │
                                  ▼
   ┌────────────────────────────────────────────────────┐
   │                   BRAIN                             │
   │  ┌──────────────┐         ┌───────────────────┐    │
   │  │ Claude model │◄───────►│ Harness (loop)    │    │
   │  └──────────────┘         │  - context build  │    │
   │                           │  - dispatch tool  │    │
   │                           │  - emit events    │    │
   │                           └────┬─────────┬────┘    │
   └────────────────────────────────│─────────│─────────┘
                                    │         │
                          getEvents │         │ execute
                          emitEvent │         │ provision
                                    ▼         ▼
                  ┌─────────────────────┐  ┌─────────────────────┐
                  │      SESSION         │  │       HANDS          │
                  │  append-only log     │  │  ┌────────────────┐  │
                  │  user_msg/assist/    │  │  │ Sandbox (cont.)│  │
                  │  tool_call/result/   │  │  ├────────────────┤  │
                  │  context_reset       │  │  │ MCP servers    │  │
                  └─────────────────────┘  │  ├────────────────┤  │
                                           │  │ Phone / emu /  │  │
                                           │  │ arbitrary tool │  │
                                           │  └────────────────┘  │
                                           │  ┌────────────────┐  │
                                           │  │ Credential     │  │
                                           │  │ proxy + Vault  │  │
                                           │  └────────────────┘  │
                                           └─────────────────────┘
```

### API surface

```
                          ┌──────────── Harness API ────────────┐
                          │  wake(sessionId) → HarnessHandle    │
                          └──────────────────────────────────────┘
                                          │
                                          ▼
       ┌─────────── Session API ──────────┐    ┌────────── Sandbox API ──────────┐
       │  emitEvent(id, event)            │    │  provision({ resources })       │
       │  getEvents(id, opts?) → Event[]  │    │  execute(name, input) → string  │
       │  getSession(id) → Session        │    │                                  │
       └──────────────────────────────────┘    └──────────────────────────────────┘
```

### Deployment / process boundaries

```
   ┌─────────────────────────────────────────────────────────────────┐
   │  Anthropic-managed control plane                                │
   │                                                                 │
   │   ┌──────────────┐    ┌──────────────────┐   ┌─────────────┐    │
   │   │ Harness pool │    │ Session log store│   │ MCP / cred  │    │
   │   │ (stateless,  │◄──►│ (durable, multi- │   │ proxy +     │    │
   │   │  N replicas) │    │  tenant)         │   │ vault       │    │
   │   └─────┬────────┘    └──────────────────┘   └──────┬──────┘    │
   │         │                                           │           │
   │         │                              outbound calls           │
   │         │                              with injected creds      │
   │         ▼                                           ▼           │
   │   ┌──────────────────────────────────────────────────────┐     │
   │   │ Sandbox fleet (per-session, ephemeral)                │     │
   │   │   - container / microVM / gVisor                      │     │
   │   │   - no long-lived credentials                         │     │
   │   │   - egress only via proxy                             │     │
   │   └───────────────────────────────────────────────────────┘     │
   └─────────────────────────────────────────────────────────────────┘
                       │                                  ▲
                       │ Claude API                       │ tool calls
                       ▼                                  │
            ┌─────────────────────┐         ┌────────────────────────┐
            │  Anthropic LLM tier │         │ External APIs          │
            │  (Sonnet/Opus/etc.) │         │ (GitHub, Slack, DBs,   │
            └─────────────────────┘         │  customer SaaS, …)     │
                                            └────────────────────────┘
```

## What's Public vs What's Inferred

| Claim | Status |
|---|---|
| Brain = "Claude and its harness" | **PUBLIC** — direct quote |
| Hands = "sandboxes and tools that perform actions" | **PUBLIC** |
| Session = "the log of session events" | **PUBLIC** |
| Harness = "the loop that calls Claude and route Claude's tool calls" | **PUBLIC** |
| Sandbox = "an execution environment where Claude can run code and edit files" | **PUBLIC** |
| Procedural API names: `execute`, `getEvents`, `emitEvent`, `getSession`, `wake`, `provision` | **PUBLIC** |
| `execute(name, input) → string` exact contract | **PUBLIC** |
| Session "lives outside Claude's context window" | **PUBLIC** |
| MCP proxy + OAuth vault + session-scoped tokens | **PUBLIC** |
| 60% p50 / 90% p95 TTFT improvement | **PUBLIC** |
| "Brains can pass hands to one another" | **PUBLIC** |
| Event types `user_message`, `assistant_message`, `tool_call`, `tool_result`, `context_reset` | **INFERRED** from independent technical write-ups synthesizing the article |
| Bundled-credential pattern (git token in remote URL) | **INFERRED** — described in technical write-ups |
| Sandboxes provisioned lazily / per-session | **INFERRED** — matches TTFT result |
| Storage backend (Postgres? Kafka? proprietary?) | **SPECULATION** — not stated |
| Wire protocol harness↔sandbox (HTTP/gRPC?) | **SPECULATION** |
| Underlying sandbox tech in Anthropic's production | **SPECULATION** |
| Schema versioning of events | **SPECULATION** |
| Hand handoff between brains: handle passing through child session | **SPECULATION** |
| Multi-tenancy partitioning model in storage | **SPECULATION** at platform level |
| SDK hooks (`PreToolUse`, `PostToolUse`, etc.) | **PUBLIC** — from `claude-agent-sdk-typescript`, marked SDK-not-article |
| `canUseTool` permission callback | **PUBLIC** — from SDK |
| `permissionMode: default \| acceptEdits \| bypassPermissions \| plan \| dontAsk \| auto` | **PUBLIC** — from SDK |
| Event-log-as-observability | **INFERRED** |
| `total_cost_usd` is client-side, not authoritative | **PUBLIC** — explicitly warned |

## Implications for agent-express Design

### What we anchor on (PUBLIC, safe)

1. **Triad naming** — Brain/Hands/Session/Harness/Sandbox in our docs/diagrams matches Anthropic vocabulary
2. **6 procedural methods** — `execute`/`getEvents`/`emitEvent`/`getSession`/`wake`/`provision` go directly into our protobuf spec
3. **`execute(name, input) → string`** — exact contract for our `Tool`/`Sandbox` interface
4. **Stateless harness** — our `Agent.wake(sessionId)` semantics match
5. **Session as event log outside context window** — our D2 decision (event log first-class)
6. **Lazy sandbox provisioning** — informs our `harness.checkpoint()` and sandbox lifecycle design
7. **Two credential patterns** — Pattern 1 (bundle at provision) + Pattern 2 (proxy + vault) both implementable in `CredentialStore` interface

### What we have to invent (NOT public)

1. **Storage technology** — Anthropic doesn't say. We choose Postgres (event log) + Redis (advisory locks) for v0.5 server.
2. **Wire protocol harness↔sandbox** — Anthropic doesn't say. We choose gRPC + REST gateway (Temporal pattern).
3. **Event schema** — We define our own; ground in Anthropic's named event types but extend (handoff/delegate/checkpoint/compaction events).
4. **Schema versioning** — `schemaVersion: number` field in every event, tolerant deserialization (our v0.4 decision).
5. **Multi-tenancy model** — partition by `(session_id, tenant_id)`; namespace isolation in v0.7.
6. **Brain-to-brain handoff protocol** — We choose: child session inherits sandbox handle by reference, parent session gets `agent:handoff` event with child session ID.

## Source Citations

**Primary**
- Anthropic Engineering — *Scaling Managed Agents: Decoupling the brain from the hands* — https://www.anthropic.com/engineering/managed-agents

**Anthropic-authored related**
- *Effective harnesses for long-running agents* — https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- *Harness design for long-running application development* — https://www.anthropic.com/engineering/harness-design-long-running-apps

**Claude Agent SDK (TypeScript)**
- GitHub — https://github.com/anthropics/claude-agent-sdk-typescript
- TypeScript reference — https://code.claude.com/docs/en/agent-sdk/typescript
- Hooks — https://code.claude.com/docs/en/agent-sdk/hooks
- Permissions — https://code.claude.com/docs/en/agent-sdk/permissions
- Hosting — https://code.claude.com/docs/en/agent-sdk/hosting
- Cost tracking — https://code.claude.com/docs/en/agent-sdk/cost-tracking
- Secure deployment — https://code.claude.com/docs/en/agent-sdk/secure-deployment

**Independent technical write-ups (for cross-checking the procedural API)**
- DEV Community — https://dev.to/_46ea277e677b888e0cd13/anthropic-managed-agents-architecture-decoupling-brain-from-hands-for-scalable-ai-agents-295k
- Epsilla — https://www.epsilla.com/blogs/anthropic-managed-agents-decoupling-brain-hands-enterprise-orchestration
- Ken Huang Substack — https://kenhuangus.substack.com/p/how-anthropic-scaling-managed-agents
- DeepWiki — https://deepwiki.com/deusyu/harness-engineering/3.2-anthropic:-managed-agents-and-meta-harness-architecture
- Cozypet five-layers analysis — https://cozypet.github.io/five-layers-harness/v2.html
- Arcade.dev critique — https://www.arcade.dev/blog/anthropic-managed-agents-missing-hands
- Cobus Greyling — https://cobusgreyling.medium.com/claude-managed-agents-0f47df3caa6f
