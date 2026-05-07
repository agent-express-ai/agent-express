---
title: Roadmap
audience: contributors
last-revised: 2026-05-07
---

# Agent Express — Roadmap

Shipped phases and planned features. For architectural rationale see the design docs:

- [`design/agent-express-concept.md`](design/agent-express-concept.md) — framework position, agent session primitive, why middleware beats graphs, 7-framework comparison
- [`design/middleware-interface.md`](design/middleware-interface.md) — single `Middleware` interface, 5 hooks, `(ctx, next)` onion pattern
- [`design/agent-loop.md`](design/agent-loop.md) — 5-level lifecycle nesting and the model→tool→model loop within a turn
- [`design/event-log.md`](design/event-log.md) — v0.4 substrate: typed events as the canonical session record
- [`design/`](design/) — full index of design documents (also covers providers, adapters, observability, testing)
- [`research/`](research/) — reference architectures (Anthropic Managed Agents, OpenAI Agents SDK, OpenAI Codex `app-server`, LangChain Deep Agents, OpenClaw resident agents)

Status: APPROVED. Last refactored 2026-05-06 to spec-driven dev best practices (atomic features, one-spec-per-feature, demand-gated future versions).

## MVP Roadmap

### Phase 001: Core Engine ✅

**Goal:** `agent.use()` works. Middleware composes. Agent loop runs.

| Deliverable | Description |
|---|---|
| `Agent` | Core class: constructor + `use()` + `run()` |
| `AgentRun` | `AsyncIterable<StreamEvent>` + `.result: Promise<RunResult>` |
| Context types | `AgentContext` → `SessionContext` → `TurnContext` → `ModelContext` / `ToolContext` |
| `Middleware` interface | 5 onion hooks: `agent`, `session`, `turn`, `model`, `tool` |
| Onion executor | Hook chaining for runtime hooks with error propagation |
| State system | `StateProxy` with typed fields, session scope, optional reducers |
| Streaming | `run()` returns `AgentRun` with streaming events |
| Parallel tool calls | `Promise.all` by default, sequential opt-in |
| Anthropic adapter | Claude Messages API via `@ai-sdk/anthropic` |
| OpenAI adapter | Chat Completions API via `@ai-sdk/openai` |
| `tools.function()` | TypeScript function tools with Zod schemas |

### Phase 002: Built-in Middleware ✅

**Goal:** Useful out of the box. Covers "thick" agents (multi-step, tool use, verification).

| Deliverable | Description |
|---|---|
| `tools.mcp()` | MCP server connection and tool execution |
| `dev.console()` | Full lifecycle terminal trace |
| `model.retry()` | LLM retry with exponential backoff |
| `guard.budget()` | Per-session USD cost enforcement |
| `guard.input()` / `guard.output()` | Input/output validation |
| `guard.maxIterations()` | Loop iteration limit |
| `guard.timeout()` | Turn/model timeouts |
| `model.router()` | Complexity-based model routing |
| `memory.compaction()` | Context window management (5 strategies incl. summarize, hybrid) |
| `observe.usage()` | Token usage tracking |
| `observe.tools()` | Tool call recording |
| `observe.duration()` | Turn timing |
| `observe.log()` | Structured JSON logging |
| `defaults()` | Sensible middleware preset (opt-out with `defaults: false`) |

### Phase 003: Explicit Lifecycle Sessions ✅

**Goal:** First-class `Session` for multi-turn conversations.

| Deliverable | Description |
|---|---|
| `Session` class | `run()`, `close()`, history, state |
| `agent.session()` | Create explicit sessions |
| `agent.init()` / `agent.dispose()` | Explicit lifecycle management |
| Session state | Persistent state across turns within a session |

### Phase 004: Testing Framework ✅

**Goal:** Best-in-class functional agent testing.

| Deliverable | Description |
|---|---|
| `testAgent()` | Declarative test helper from `agent-express/test` |
| `TestModel` / `FunctionModel` | Mock LLM responses for deterministic tests |
| `capture` | Tool call capture utilities |
| `recorder` | Record/replay cassette system |
| `snapshot` | Snapshot testing helpers |
| CI runner | `npx agent-express test` — JUnit XML output |
| API call guard | Blocks real API calls in test environment |

### Phase 005: HITL Approval ✅

**Goal:** Human-in-the-loop tool approval.

| Deliverable | Description |
|---|---|
| `guard.approve()` | Tool approval middleware with `approve`, `deny`, `modify` helpers |

### Phase 006: CLI & DX ✅

**Goal:** "Zero to working agent in under 5 minutes."

| Deliverable | Description |
|---|---|
| `npx create-agent-express` | Interactive project scaffold with 4 templates |
| `npx agent-express dev` | Terminal chat with hot reload |
| `npx agent-express test` | Agent test runner |
| Templates | default, coding, research, support-bot |

### Phase 007: Docs Launch ✅

**Goal:** Professional documentation. API reference, guides, examples.

### Phase 008: Docs Site Launch ✅

**Goal:** Starlight docs site deployed. Ready for community launch.

## Post-MVP Roadmap


### Terminology — Feature, not Phase (2026-05-06 refactor)

Going forward we use **Feature** as the atomic unit of work and **Version** as the milestone group. Reasons:

- A feature maps to one speckit spec, one demo gate, one shippable increment
- "Phase" implied strict temporal sequence; "Feature" implies unit of value, reorderable by dependency graph
- Phase 010 (was 13 deliverables in one block) violated speckit's "one spec = one testable feature" rule — refactored into 5 atomic features (010-014) below
- Phases 001-009 keep historical names for git-blame / spec-folder consistency; new work uses Feature numbering

### Speckit best-practice format for each feature spec

Every feature in this roadmap follows the same structure:

| Section | Content |
|---|---|
| **Why** | 1-2 sentences — what problem this solves, who has it. Outcome-framed. |
| **User-visible behavior** | The single observable change. No implementation talk. |
| **Non-goals** | What this feature explicitly does NOT do. Often the most important section — prevents scope creep. |
| **Acceptance criteria** | Bulleted, testable conditions. Each independently verifiable. |
| **Demo gate** | The one scenario shown when feature ships. Concrete: *"kill -9 mid-tool-call, restart, conversation continues from same turn"* — not "tests pass." |
| **Dependencies** | Other features this depends on, by number. |
| **Risks** | What can go wrong, how we'll catch it. |

Each feature spec should be sized as one testable, demoable increment. Anything that mixes multiple shippable changes needs splitting.

### Version → Feature mapping (revised 2026-05-06 — speckit-aligned)

| Version | Features | Decomposition | Headline |
|---|---|---|---|
| **v0.4** | 010-019 | Detailed below — 10 atomic features, each with own spec | TS framework + harness customization positioning + Show HN |
| **v0.4.x** | (no features) | Design partner discovery — outreach activity, not feature work | Active outreach to 5 B2B agent-platform companies. **Decision gate**: 3+ concrete daemon-mode demand signals → trigger v0.5. |
| **v0.5** (demand-gated) | TBD | High-level description below; feature decomposition deferred until demand validated | `@agent-express/app-server` TypeScript daemon adapter (Codex public protocol + Anthropic internal architecture) |
| **v0.6+** (demand-gated) | TBD | High-level description below; feature decomposition deferred until v0.5 in production with design partners | codingAgent preset + reference applications + channel adapters + replay debugger |
| **v0.7+** (demand-gated) | TBD | High-level description below; feature decomposition deferred | Permission enforcer adapters + signed skills (opt-in adapter packages) |

**Note on Phase numbering:** existing Phases 010-014 retain their numbers and content. Phase 015 reframed from prior plan ("Go server v1") to "TS app-server adapter (demand-gated)". Phase 016 (prior: Server v1 production polish) merged into Phase 015. Phase 017 retained but slimmed (channel adapters + replay debugger only). Phase 018-020 retain content.

### Phase 009: Providers & Observability ✅

> Shipped in v0.2.0

- Universal provider resolver — any `@ai-sdk/*` provider via `"provider/model"` string
- `observe.metrics()` — 10 `agent_express_*` metrics via OTel Meter API
- `observe.traces()` — OpenTelemetry distributed tracing (framework + GenAI span names)
- `observe.log()` enhanced — level, duration, errors, traceId, content opt-in
- `@opentelemetry/api` as optional peer dependency (shared by metrics + traces)

## v0.4 Features (010-019) — atomic, speckit-aligned

> Each feature below = one speckit spec, one demo gate, one shippable increment. Phase 010 from prior plan was 13 deliverables in one block — refactored 2026-05-06 into 5 atomic features (010-014). Multi-agent (was Phase 011) renumbered to Feature 015. Subsequent renumbered +4. Workspace+checkpoint moved out of v0.4 (will live in codingAgent preset, v0.6+). Credentials Pattern 2 deferred to v0.5+ (only meaningful with daemon process).

### Feature 010: Event Log Foundation

**Why** — Today `Session` is a messages array. Crash = session lost; replay = best-effort; multi-agent = nowhere to write `agent:handoff` events; compaction destroys history. Append-only event log fixes all four problems by becoming the single source of truth.

**User-visible behavior**
- `Session.events` is the canonical store; `Session.history` is a derived view (backwards-compat read access)
- Every model response, tool call/progress/result, state change emits a typed event with UUIDv7 id and timestamp
- Apps extend `Event` union with custom types (`channel:inbound`, `cron:tick`, `voice:partial`, etc.) without forking core
- Existing sqlite/redis/postgres adapters store events; `session-openai` package deleted (incompatible)

**Non-goals**
- `agent.wake()` resume — Feature 011
- `context.*` ContextAssembler primitives — Feature 012
- `WorkspaceRef` / `memory.checkpoint()` — moved to v0.6+ codingAgent preset
- Pattern 2 credential proxy — moved to v0.5
- Three-surface state API (`RunState`/`sessionState`/`snapshot`) — Feature 011 (needed for resume resolution)

**Acceptance criteria**
- All 619 existing tests pass with event-log-backed Session (`Session.history` derived view preserves backwards compat)
- Round-trip serialize/deserialize tested for every event type with `schemaVersion` field
- Event union extensible — adding custom event type works in user code without modifying core (test case)
- sqlite/redis/postgres adapters store events with `(sessionId, eventId)` unique constraint; idempotent re-emit
- Migration guide `docs/migration/v0.3-to-v0.4.md` validates v0.3 → v0.4 upgrade path
- `session-openai` removed from packages/, README, docs
- Coverage ≥85% on new code

**Demo gate** — Run a multi-turn agent in `npx agent-express dev`. Open SQLite via `sqlite3 .agent-express/sessions.db "SELECT type, ts FROM events ORDER BY ts"` — see typed event timeline (`user:input → model:response → tool:call → tool:result → ...`). Tail in real-time with `--watch`.

**Dependencies** — None.

**Risks** — Event union extensibility under JSON-column storage; validate against Postgres `jsonb` adapter early. session-openai deletion is clean cut (zero users affected).

---

### Feature 011: Multi-process Resume (`wake`)

**Why** — Production agents need crash recovery. If a Node process dies mid-turn, any other process should pick up the same session from the event log without state loss. This is the load-bearing primitive that distinguishes "single-process toy" from "production-grade harness."

**User-visible behavior**
- `agent.wake(sessionId)` loads session from `SessionStore`, replays events into in-memory state, returns ready `Session` instance
- Concurrent `wake()` calls on same session ID are mutually exclusive (advisory lock prevents two processes claiming same session)
- Three-surface state API (`SessionState = { runState, sessionState?, snapshot? }`) — resume resolution order: live session > snapshot > rehydrate from RunState
- Works across sqlite (single-process), redis (multi-process via Redis-backed lock), postgres (multi-process via `pg_try_advisory_lock`)

**Non-goals**
- Workspace restore (git ref) — deferred to v0.6+ codingAgent preset
- Sandbox blob restore — sandbox-provider responsibility (Phase 018+)
- Hot-failover (zero-downtime takeover) — recovery, not failover

**Acceptance criteria**
- E2E test: start session, kill -9 process mid-turn, fresh process `agent.wake(sessionId)`, conversation continues from same point
- Concurrent `wake()` test: two processes call `wake()` on same id simultaneously; one wins lock, other gets `SessionLockedError`
- Postgres advisory lock (default) and Redis-based fallback both pass concurrency stress test
- Three-surface state API typed; resolution order tested with all three sources present

**Demo gate** — Terminal demo: start agent in shell A, mid-conversation `kill -9`, in shell B run `npx agent-express resume <sessionId>` — agent picks up exactly where left off, last user message and tool calls visible.

**Dependencies** — Feature 010 (event log).

**Risks** — `wake()` lock primitive is the most failure-prone part. Postgres advisory locks well-understood; Redis-based locks have edge cases (clock skew, network partition). Stress test with simulated partitions.

---

### Feature 012: Pluggable Context Assembly + Compaction Vocabulary

**Why** — The "harness assembles context window each turn from events" pattern (Anthropic Managed Agents) is the load-bearing primitive that lets harness customizers pick context strategy without forking. Plus: industry-standard compaction vocabulary (HISTORY_SNIP / MICROCOMPACT / etc.) makes our compaction recognizable to readers of "12 Agentic Harness Patterns" and Anthropic harness-design posts.

**User-visible behavior**
- `context.linear()` — default ContextAssembler, chronological event-to-message mapping. Ships first.
- `ContextAssembler` interface public — apps can implement custom assemblers
- Existing 5 compaction strategies aliased to industry-canonical names: `keep-recent`→`HISTORY_SNIP`, `summarize`→`MICROCOMPACT`, `clear-tool-results`→`CONTEXT_COLLAPSE`, `hybrid`→`AUTOCOMPACT`, plus new `CONTEXT_RESET`
- Compaction emits `compaction:applied` event with metadata; underlying events never modified or deleted (compaction-stays-in-harness invariant)

**Non-goals**
- `context.windowed()` / `context.summarized()` / `context.cached()` — ship as recipes in v0.4.x community-driven, not blocker for v0.4 launch
- RTBF crypto-shredding implementation — documented as pattern, actual implementation v0.6+
- Cache strategy tuning — Anthropic prompt cache integration is Feature 016 work (AgentOps Controls Polish)

**Acceptance criteria**
- `context.linear()` is the default assembler; existing tests pass without explicit `.use(context.linear())`
- `ContextAssembler` interface documented + 1 example custom assembler in `examples/`
- Old strategy names work as deprecation aliases for one minor (`keep-recent` still loads, emits deprecation warning)
- `compaction:applied` event written on every compaction; `Session.events` count before/after differs only by addition of marker — no event removal
- `SessionStore.delete()` removes whole sessions; no API exists to delete individual events

**Demo gate** — Run agent with `memory.compaction({ strategy: "MICROCOMPACT" })`. After 50 turns, query event log: see all 50+ user/assistant events PLUS `compaction:applied` markers. Old events still readable.

**Dependencies** — Feature 010.

**Risks** — Deprecation alias surface needs careful naming. RTBF crypto-shredding is a documentation deliverable — clearly mark as "pattern, not implementation."

---

### Feature 013: Credentials Architecture (Pattern 1)

**Why** — Production agents handle secrets. Today credentials live in agent code = they leak into events, state, error messages, sandbox FS. Pattern 1 (bundle at provision time) closes this for embedded mode: secrets injected into tool/sandbox at init, never serialized into the event log.

**User-visible behavior**
- `CredentialStore` interface public (`get(name): Promise<string>`)
- Adapters: `env` (default — process.env), `file` (`.env`-style), `vault` (HashiCorp Vault), `awsSecrets` (AWS Secrets Manager), `azureKeyVault` (Azure Key Vault)
- Tools declare required credentials via `Tool.requires: { credential: "github", scope: "repo:read" }`
- Credentials injected into tools at `agent.init()`, never serialized into events / state / messages / sandbox FS

**Non-goals**
- Pattern 2 (vault + outbound proxy) — deferred to v0.5 (only meaningful with daemon process; embedded mode covered by Pattern 1)
- OAuth flow management — config-time setup, runtime is read-only
- Multi-tenant credential routing — v0.6+ when multi-tenant scenarios validated

**Acceptance criteria**
- Test: agent code reads secret via `ctx.credentials.get("openai")` — secret value never appears in `Session.events` payload, never in `ctx.state`, never in tool input/output if not explicitly used
- 5 adapters (`env`/`file`/`vault`/`awsSecrets`/`azureKeyVault`) load credentials with same `CredentialStore` interface
- `Tool.requires` declaration validated at `agent.init()`; missing credential → init fails fast with clear error
- Test coverage: credential leakage detection (grep `ctx.events` payload after run for known secret value — must not appear)

**Demo gate** — `examples/credentials-leak-test.ts` — agent uses GitHub API token, makes call, dumps `Session.events`. Token value `ghp_...` searched in dump → zero matches. Visible audit-clean log.

**Dependencies** — Feature 010 (event log structure for leak detection).

**Risks** — Vault and AWS adapters require integration tests with real services (or mocked); catch breakage early via cassettes.

---

### Feature 014: Load-bearing Invariants + SessionStore Transparent Swap

**Why** — Two related guarantees: (1) certain middlewares (event log Session + ContextAssembler) cannot be removed via `defaults: false` because the framework breaks without them; (2) `SessionStore` interface is stable across all storage backends — same code runs against sqlite, postgres, or (later) remote daemon. Both are framework-level invariants that protect against silent breakage.

**User-visible behavior**
- `LoadBearingMiddlewareError` thrown at agent construction if user attempts to remove Session event log or ContextAssembler
- `SessionStore` interface (`load`/`save`/`delete`/`add`/`list`) public, stable, documented as transparent-swap contract
- All v0.4 storage adapters (sqlite/redis/postgres) interchangeable: same agent code, swap adapter at config-time only
- Daemon-readiness constraint #15 verified — capability namespaces (`tools.filesystem`/`tools.shell`/etc.) match OpenAI Sandbox Agents vocabulary

**Non-goals**
- `@agent-express/session-remote` (remote daemon adapter) — Feature in v0.5
- Multi-tenant SessionStore — v0.6+
- Storage migration tools (sqlite → postgres dump) — community contribution

**Acceptance criteria**
- Test: `new Agent({ defaults: false })` without explicit event log middleware → constructor throws `LoadBearingMiddlewareError` with clear message and remediation
- Test: same agent test suite runs unmodified against all 3 SessionStore impls (parametrized test fixture)
- `SessionStore` interface JSDoc documents transparent-swap invariant explicitly with reference to Codex `ThreadStore::Local|Remote|InMemory` and Anthropic SDK `sessionStore?` pattern
- Audit doc at `docs/sessionstore-contract.md` lists guarantees, edge cases, what adapters MUST/MAY do

**Demo gate** — One agent code, three commands: `STORAGE=sqlite npm run demo`, `STORAGE=redis npm run demo`, `STORAGE=postgres npm run demo`. All three behave identically (same conversation outputs, same event log shape). Code unchanged between runs.

**Dependencies** — Feature 010, Feature 011 (transparent-swap validates against `wake()` semantics).

**Risks** — Edge cases in `list()` pagination across adapters. Define semantic precisely (sort order, cursor format) in `docs/sessionstore-contract.md`.

### Feature 015: Multi-agent (`tools.delegate` + `tools.handoff`)

> Renumbered 2026-05-06 from Phase 011.

**Why** — Multi-agent agents are increasingly common (orchestrator + specialists, triage + L2 escalation, planner + executor). Today users hand-roll this with `tools.function()` calling another agent's `run()`. First-class `tools.delegate` (sync subagent-as-tool) and `tools.handoff` (control transfer) make multi-agent replayable, type-safe, and budget-aware via the event log.

**User-visible behavior**
- `tools.delegate(targetAgent, opts)` — orchestrator calls specialist, gets result back. Subagent costs accrue against orchestrator's `guard.budget`
- `tools.handoff(targetAgent, opts)` — current agent passes control; new agent owns the conversation. State-key whitelist via `carryState: ["userIntent", "ticketId"]`
- Both emit `agent:delegate` / `agent:handoff` events; `wake()` reads latest handoff to determine which agent owns conversation
- `IsolationMode` type with `"shared"` (default, only mode in v0.4) — `"shared-fs"`/`"worktree"`/`"sandbox"` API locked but unimplemented (light up in v0.6+ codingAgent preset)

**Non-goals**
- `agent.spawn([...])` parallel subagents with worktree isolation — v0.6+ codingAgent preset
- Cross-vendor handoff (agent A on OpenAI, agent B on Anthropic) — works through provider-neutral middleware already, no special handling needed
- Multi-agent conversation visualization UI — out of scope

**Acceptance criteria**
- E2E test: orchestrator delegates to billing specialist, result returns, costs accrue against orchestrator's budget cap
- E2E test: triage agent hands off to L2; `Session.events` shows `agent:handoff` marker with `carryState` keys; `wake()` after handoff resumes with L2's instructions/model
- `IsolationMode` type exposed; passing `"worktree"` in v0.4 throws clear `NotImplementedError` with pointer to v0.6+ codingAgent preset
- Coverage: round-trip handoff through event log + crash + wake test passes

**Demo gate** — Run two-agent chat: triage agent receives "I need a refund," hands off to billing specialist with `carryState: ["orderId"]`. Kill -9 mid-handoff. Wake — billing specialist resumes with order context. Visible in event log as `agent:handoff` event before the kill.

**Dependencies** — Features 010, 011, 014.

**Risks** — `carryState` semantics edge cases (nested namespaces, undefined keys). Lock down explicit empty-array default ("nothing crosses unless listed") to prevent accidental data leak.

### Feature 016: Governance Primitives Polish

> Renumbered 2026-05-06 from Phase 012 (was "AgentOps Controls Polish"). Renamed to align with "batteries-included governance" framing in current positioning.

**Why** — The 4 most common production agent failures (cost runaway, privilege escalation, quality drift, compliance gap) have existing primitives in v0.3 (`guard.budget`, `guard.approve`, `memory.compaction`, `recorder`), but each has rough edges that hold back enterprise adoption. This feature closes those gaps so the "batteries-included governance" claim is defensible.

**User-visible behavior**
- `guard.approve()` becomes composable classifier chain — multiple classifiers (regex / allowlist / LLM-as-judge / custom) compose via middleware order; each can `approve`/`deny`/`escalate`/`modify`. Emits `permission:approved`/`denied`/`modified` events on every decision
- `memory.compaction()` exposes named hook points (`PreCompact`/`OnHistorySnip`/`OnContextCollapse`/`OnAutocompact`/`OnContextReset`) as middleware injection points
- `recorder` cassette format records every event type including permission decisions, state transitions, tool progress
- `guard.budget()` adds realtime hooks (`onBudgetWarning(0.5)`, `onBudgetCritical(0.9)`, `onBudgetExhausted()`) for pre-emptive abort
- `memory.plan()` ships — TodoList in `ctx.state` as no-op tool (Deep Agents pattern); 5th governance primitive for quality drift across all agent shapes

**Non-goals**
- Output validators (`toxicityDetector` / `hallucinationDetector` / `offTopicDetector`) — community contribution / future demand
- Authoritative billing reconciliation — explicit caveat: client-side cost estimation, use provider Cost APIs for billing
- LLM-as-judge classifier specifics — left to user; we ship the chain, not the judge

**Acceptance criteria**
- `guard.approve()` chain test: 3 classifiers, second denies, log shows `permission:denied` with classifier name and reason
- `memory.compaction()` hook test: custom middleware injected at `OnAutocompact`, fires correctly, modifies compaction summary
- `recorder` round-trip test: every event type from Feature 010 union present in cassette
- `guard.budget` warning hooks test: agent runs, hits 50% threshold, `onBudgetWarning` callback fired with current cost
- `memory.plan()` test: agent writes TodoList, reads it next turn, list visible in `Session.events`

**Demo gate** — Run agent with full governance stack: budget cap, approval classifier, compaction strategy, recorder. Trigger each primitive (high-cost operation hits budget warning, dangerous tool triggers approval, long session triggers compaction, recorder captures all). Show audit log replay matching original.

**Dependencies** — Features 010, 011, 012.

**Risks** — Permission classifier chain ordering edge cases. `recorder` cassette format must stay portable across versions (forward compat).

### Feature 017: README + Site Rewrite

> Renumbered 2026-05-06 from Phase 013.

**Why** — Current README and landing page still position agent-express as a "minimalist middleware framework" or "control plane." The 2026-05-05 positioning lock-in (harness customization framework) hasn't propagated to public-facing copy. Until it does, the marketing claim and the artifact don't match.

**User-visible behavior**
- README hero: *"The only framework where harness shape is yours"* — sub-line about `(ctx, next)` as harness-unit, agent shapes (coding/research/resident/chat/autonomous), build-vs-buy
- README sections (in order): Why harness customization → Build vs buy → Batteries-included governance → Quick start → Comparative table vs Anthropic/OpenAI/Mastra/Deep Agents/LangGraph/Vercel
- Landing page (agent-express.ai) navigation: Architecture / Build vs Buy / What runs on it / Get started
- Vocabulary mapping table — explicit Anthropic/OpenAI/Deep Agents → agent-express equivalents
- Citations index linking to `docs/research/` and Raieli article

**Non-goals**
- Show HN copy itself — Feature 019
- 12 patterns reference recipes — Feature 018
- Documentation site overhaul (Starlight structure) — already shipped Phase 008
- Translated docs — community contribution

**Acceptance criteria**
- Hero copy in README matches v0.4 hero claim; npm description updated; package.json description updated
- Comparative table renders correctly, references no removed claims (no "control plane" hero, no managed cloud, no Go server)
- Landing page deploys; existing redirects preserved
- Vocabulary mapping table includes Anthropic 6 methods, OpenAI Capabilities, Deep Agents 4 pillars, "12 Patterns" pattern #12 → all map to agent-express
- Build-vs-buy section includes table with Anthropic Cloud / OpenAI Cloud / AWS AgentCore as buy options; agent-express as build option

**Demo gate** — Open agent-express.ai in incognito; first 5 seconds tell visitor (a) what it is, (b) why it's different from Mastra/LangGraph/Vercel AI SDK, (c) how to start. Show diff of README before/after — every "control plane" reference replaced or contextualized as batteries-included.

**Dependencies** — None (text work, parallel with code features).

**Risks** — Comparative table claims need to be verifiable. Add disclaimer "as of 2026-05" + commit hash references for each competitor framework.

### Feature 018: 12 Patterns Reference Implementation

> Renumbered 2026-05-06 from Phase 013.5.

**Why** — The "harness customization framework" claim needs irrefutable proof before Show HN. Reader from the canonical "12 Agentic Harness Patterns" article (generativeprogrammer.com) lands in our repo, sees all 12 patterns implemented as 50-200-line recipes on agent-express, concludes "this is harness-native by construction, not marketing." Doctrinal proof. Not feature-parity with Codex/Claude (those are vertical, we're horizontal) — coverage of doctrinal taxonomy.

**User-visible behavior**
- `examples/12-patterns/` directory — 12 runnable TypeScript recipes (~50-200 LOC each), one pattern per file, runnable via `npx agent-express dev examples/12-patterns/01-control-loop.ts`
- Blog post on agent-express.ai/blog: *"All 12 agentic harness patterns, implemented in agent-express"* — one paragraph + code snippet per pattern
- Side-by-side comparison repo `agent-express-vs/` — same agent task in agent-express / Mastra / LangGraph / Vercel AI SDK; honest LOC + customization-depth metrics
- `12-patterns-coverage.md` audit doc — tracks % coverage, recipe location, version first shipped

**Coverage status entering this feature** (verified against article headlines before publication):

| # | Pattern | Status entering v0.4 launch |
|---|---|---|
| 1 | Agent control loop | ✅ shipped (core agent loop) |
| 2 | Tool routing / dispatch | ✅ shipped (`tool` hook + `tools.function`/`tools.mcp`) |
| 3 | Context window management / compaction | ✅ shipped + extended (`memory.compaction` + `context.*` from Feature 012) |
| 4 | Session persistence / event log | ✅ shipped in Feature 010 (event log Session) |
| 5 | Multi-agent / delegation / handoff | ✅ shipped in Feature 015 |
| 6 | Sandbox / execution boundaries | ⚠️ interface only in v0.4 (full 8 providers in v0.6+ codingAgent preset) — recipe shows interface |
| 7 | Credentials / secret management | ✅ shipped in Feature 013 (Pattern 1) |
| 8 | Permission / approval gating | ✅ shipped (`guard.approve` v0.3 + classifier chain Feature 016) |
| 9 | Cost / budget governance | ✅ shipped (`guard.budget` + realtime hooks Feature 016) |
| 10 | Observability / tracing | ✅ shipped (`observe.*` Phase 009) |
| 11 | Retry / error recovery | ✅ shipped (`model.retry`) |
| 12 | Lifecycle hooks | ✅ **structural** — `(ctx, next)` is this pattern |

11/12 fully shipped, 1/12 (sandbox) interface-only — recipes ship at v0.4 launch.

**Non-goals**
- Feature-parity with Codex tooling (apply_patch syntax, syscall hooks, kernel sandbox)
- Recipe for sandbox 8 providers — interface-only recipe is sufficient; full impls in v0.6+
- Translating recipes to other languages

**Acceptance criteria**
- 12 recipe files in `examples/12-patterns/`, each runnable end-to-end
- Pattern verification pass against original article completed; mapping documented; deviations explained
- Blog post drafted, sanity-checked by 2-3 trusted readers before publication
- `agent-express-vs/` repo public; comparison table in README is honest (we lose on some axes, win on harness customization)
- `12-patterns-coverage.md` matches the table above; updated mechanism for future minor releases

**Demo gate** — Cold-start a reader: open blog post → click pattern #4 (event log) → land on `examples/12-patterns/04-event-log.ts` → run `npx agent-express dev` → see working pattern in 30 seconds. Same flow for all 12 patterns.

**Dependencies** — Features 010-016 (need substrate primitives shipped to demo them), Feature 017 (vocabulary mapping table referenced from blog post).

**Risks** — Article headlines may differ from our reconstruction; verification pass critical before publication. Comparison repo claims need verifiable evidence (commit hashes for each competitor at time of comparison).

> Sequencing — ships before Feature 019 (Show HN) to leave a sanity-check window.

---

### Feature 019: Show HN + Community Launch

> Renumbered 2026-05-06 from Phase 014.

**Why** — Public launch is the moment positioning either lands or doesn't. Feature 017 (README rewrite) and Feature 018 (12 patterns) build the artifacts; Feature 019 fires them at HN, Reddit, Dev.to, Twitter to seed the "harness customization framework" vocabulary in industry discourse.

**User-visible behavior**
- Show HN post live with title: *"Show HN: agent-express — the only TS framework where harness shape is yours"*
- Reddit posts to r/typescript, r/MachineLearning, r/devops with tailored angles
- Dev.to series: *"Building harness shape from `(ctx, next)`"* — one post per architectural primitive
- Long-form HN blog post: *"Harness customization is the gap in the TS agent ecosystem in 2026"*
- Twitter/X engagement seeding pattern recognition (reply to agent-failure tweets with primitive that handles it)

**Non-goals**
- Paid promotion / advertising
- Conference submissions (deferred to v0.5+ after design partners validated)
- Newsletter outreach beyond Show HN comments thread

**Acceptance criteria**
- Show HN post drafted, reviewed by 3 trusted founders for sharpness, published Tuesday/Wednesday morning PT
- All 5 launch channels (HN, Reddit ×3 subs, Dev.to series, Twitter, blog post) executed within 7 days of HN post
- Documented response cadence (60-min response window for first 8 hours of HN top page)
- Targets: 500-1K stars in 30 days, 200+ npm weekly downloads, 1+ external blog/podcast citing "harness customization framework" vocabulary

**Demo gate** — Show HN post is live, response thread is active, comparison repo is being cloned by readers. Star count graph visible in repo insights.

**Dependencies** — Features 017 (README), 018 (12 patterns + comparison repo), all v0.4 features (010-016) shipped and tested.

**Risks** — HN comments will probe weak spots — be honest where we lose to competitors. Don't over-promise on v0.5+ features that are demand-gated.

## v0.5+ Versions — high-level descriptions only

> Per spec-driven dev best practices, atomic feature decomposition for these versions is **deferred** until demand is validated and version-level scope is locked. Listed below as version-level hero claims + scope intent + decision triggers. Each version will get its own feature breakdown (010-019-style atomic specs) before implementation begins. This avoids speculative spec authoring on infrastructure without users.

### v0.5 — TS App-Server Adapter (demand-gated)

**Hero claim**: *"agent-express v0.5 — same engine, now also a daemon. Codex public protocol, Anthropic internal architecture, no platform lock-in."*

**Scope intent**: Self-hostable harness customization framework as a TypeScript daemon. Same engine as v0.4, new transport. Public protocol shaped after Codex's `app-server-protocol/`; internal architecture shaped after Anthropic Managed Agents (stateless harness, append-only event log, lazy sandbox, credential proxy). Mirror Codex's `ThreadStore::Local|Remote|InMemory` enum so embedded apps and remote-daemon-backed apps run identical code.

**Packages**: `@agent-express/app-server`, `@agent-express/app-server-client`, `@agent-express/session-remote`.

**Demand trigger**: 3+ concrete signals from v0.4.x outreach saying *"we want, but cannot use embedded — need a daemon"* from B2B agent-platform companies (Decagon, Maven AGI, Mintlify, Inkeep, Glean, Vapi, Retell, ElevenLabs Conv AI, PolyAI, Sierra, Cresta — pick 5, contact, validate). Fewer than 3 → v0.5 deferred, ship more v0.4 evangelism.

**Why TypeScript** (not Go, not Rust): agent workloads I/O-bound; V8/Node handles 100-1000 concurrent sessions/process — above realistic v0.5 B2B needs. Inngest, Trigger.dev, LangServe prove non-systems-language daemons work. Same-language as framework eliminates code/type duplication. Polyglot consumer story = JSON Schema export, not daemon language.

**Decomposition pending** — full feature breakdown (atomic specs) after demand trigger fires. Likely candidates: public protocol + 4 transports, bidirectional JSON-RPC + approval flow, `session-remote` SessionStore adapter, in-process facade, schema export pipeline, Pattern 2 credential proxy, multi-tenancy invariants. Each will get own spec at decomposition time.

---

### v0.6+ — Reference Applications + Coding Agent (demand-gated)

**Hero claim**: *"agent-express runtime hosts every agent shape — coding, chat, research, resident, autonomous — all on the same `(ctx, next)` substrate."*

**Scope intent**: Prove genericity of harness customization across all major agent shapes. 5 `presets.*` ship, each on the same `Agent` class with the same middleware framework — if any preset requires divergent runtime, the harness customization claim is broken and we go back to drawing board.

**Likely contents** (decomposition deferred):

- **Coding agent stack** — `presets.codingAgent()` + sandbox primitives (`sandbox.local`, `sandbox.docker`, `sandbox.e2b`, `sandbox.modal`, `sandbox.daytona`, `sandbox.vercel`, `sandbox.cloudflare`, `sandbox.runloop`, `sandbox.blaxel`, `sandbox.kube`) + workspace-control middlewares (`tools.filesystem` with pluggable backend, `tools.shell` with approval gate, `tools.applyPatch` V4A format, `tools.skills`, `context.agentsMd`, `memory.checkpoint`, `memory.workspace`)
- **Spawn / worktree isolation** — `agent.spawn([tasks], { isolation: "worktree" | "sandbox" | "shared-fs" })` lights up the `IsolationMode` API designed in Feature 015
- **Channel adapters** — `channel.slack`, `channel.email`, `channel.webhook`, `channel.cron`, `channel.discord`, `channel.telegram` for OpenClaw-pattern resident agents (event-triggered wake)
- **Replay debugger CLI** — `agent-express replay <session-id>` deterministic step-through + rewind/fork from any event index
- **Reference presets** — `presets.chatAssistant`, `presets.researchAgent`, `presets.personalAgent`, `presets.autonomousLoop` (proves all agent shapes on same substrate)

**Demand trigger**: v0.5 in production with at least 1 design partner; specific demand for one or more of the agent shapes above (coding-agent users asking for sandbox uniformity, resident-agent users asking for channel adapters, etc.). No demand → v0.6 contents stay deferred.

**Decomposition pending** — atomic features defined when version-level scope locks per design-partner pull.

---

### v0.7+ — Permission Enforcer Adapters + Signed Skills (demand-gated)

**Hero claim**: *"Kernel-level enforcement when you need it — opt-in adapters, core stays vendor-neutral."*

**Scope intent**: Resident-agent (OpenClaw-pattern) and supply-chain security primitives. All opt-in adapter packages. Core stays vendor-neutral and TS-only.

**Likely contents** (decomposition deferred):

- `guard.permissions()` universal hook (no-op default in core)
- `@agent-express/guard-seatbelt` — macOS `sandbox-exec` adapter
- `@agent-express/guard-seccomp` — Linux seccomp syscall filtering
- `@agent-express/guard-knox` — AccuKnox/KubeArmor + eBPF (matches OpenClaw → KnoxClaw integration)
- `@agent-express/guard-windows-acl` — Windows ACL adapter (community-led)
- `tools.skill()` opt-in cryptographic signing — verify at install + runtime (OpenClaw v2026.4.12 RFC pattern)
- Threat model documentation — defended-against / requires-adapter / out-of-scope

**Demand trigger**: regulated-industry customer or resident-agent platform asking specifically for OS-level enforcement that goes beyond what application-layer guards provide. Without that ask — v0.7 contents stay deferred (kernel-level enforcement is high-effort, niche-demand work).

**Decomposition pending** — atomic features defined when version-level scope locks per regulated-customer ask or platform-builder demand.

### Deferred / Reordered from prior roadmap

The following items were in the prior roadmap but are now deferred or reordered as community-led / opt-in:

- **Support Bot / Research / Data Agent presets** — deferred. After the codingAgent preset (Phase 018) ships and validates the harness primitives, additional presets become candidates for community contribution rather than first-party scope. The 4-pain framing makes the presets less load-bearing for differentiation; they're now demos rather than products.
- **`agent-express build` CLI** (was Phase 014) — deprecated. Deployment is now opt-in: embed `agent-express` library, or import `@agent-express/app-server` in v0.5. No first-party Helm chart, k8s operator, or deployment artifacts — B2B platform builders integrate the daemon into their own infrastructure however suits them.
- **Eval Framework `agent-express/eval`** — moved to v1.0+ optional scope. AgentOps Controls (server-side) covers replay; standalone eval framework competes with Braintrust/Promptfoo/Inspect AI in saturated space — no priority.
- **Spawn / Parallel Subagents (`agent.spawn()`)** — deferred to v0.6 or later, requires sandbox git-worktree integration. Not load-bearing for v0.4 wedge.
- **Community Ecosystem / Signed Manifests** — emerges naturally once contributors arrive (post-launch). Not part of pre-launch scope.

### Future / If Demand
- Built-in output validators for `guard.output()`: `toxicityDetector()`, `hallucinationDetector()`, `offTopicDetector()` — ready-made validators like `injectionDetector()` for input
- Multi-agent orchestration (`delegates` on Agent, orchestrator-worker)
- Studio (browser-based trace visualization, session replay)
- Observability SaaS (hosted dashboard — monetization)
- Certified middleware marketplace (20K+ stars)
- Hosted platform
- **Per-adapter strict durability mode** — `SessionStore.durability: "strict" | "best-effort"`. v0.4 ships best-effort only (Codex-pattern: WAL=NORMAL on SQLite, default `synchronous_commit` on Postgres, AOF=everysec on Redis). A `"strict"` mode (`fsync` per event / SYNCHRONOUS=FULL / `synchronous_commit=on` with explicit flush / AOF=always) is desirable when (a) an actual user reports event loss in a tail-of-turn crash, OR (b) the v0.5 daemon adapter lands and inherits Anthropic-style zero-loss guarantees. Recorded as TODO from Feature 010 clarification (2026-05-06).
- **Optional `Agent<TVocab>` generic for typed event vocabulary** — Feature 010 ships with loose typing (`Event<string, unknown>` at read site, `ctx.emit({ type: string, payload: unknown })` at write site, runtime safety via Zod). A future enhancement is an opt-in `Agent<TVocab = EventTypeMap>` generic that accumulates the merged event vocabulary through `agent.use()`-style fluent chaining (Hono / Elysia / Effect-TS pattern), giving compile-time discriminated-union narrowing on `session.events` reads and autocomplete on `ctx.emit` types. Worth introducing when (a) at least one ecosystem middleware-author requests it, OR (b) we ship an `agent.spawn()` typed-multiagent API in v0.6+ where vocabulary divergence becomes a real safety concern. Recorded as TODO from Feature 010 R-003 (2026-05-06).

## Success Criteria (revised 2026-05-05 for harness customization framework positioning)

### v0.4 (Show HN)
| Metric | Target | Realistic? |
|---|---|---|
| Show HN published | 1 | yes |
| GitHub stars | 500-1K | sharper hook ("the only TS framework where harness shape is yours") supports the higher end of prior 200-500 range |
| npm weekly downloads | 200+ | yes if Show HN lands |
| Test coverage | ≥85% statements | already at 89% |
| `(ctx, next)` 5-hook middleware in core | shipped | yes |
| All 12 agentic harness patterns shipped as runnable recipes (`examples/12-patterns/`) | 12/12 | Phase 013.5 deliverable |
| Vocabulary mapping table (Anthropic / OpenAI / Deep Agents → agent-express) in README | shipped | Phase 013 deliverable |
| Side-by-side comparison repo (`agent-express-vs/`) | shipped | Phase 013.5 deliverable |
| "harness customization framework" vocabulary cited externally | 1+ blog/podcast | aspirational |

### v0.4.x (Design partner discovery)
| Metric | Target |
|---|---|
| B2B agent-platform companies contacted | 5+ specific names (seed list: Decagon, Maven AGI, Mintlify, Inkeep, Glean, Vapi, Retell, ElevenLabs Conv AI, PolyAI, Sierra, Cresta) |
| Conversations with technical founder / VP Eng | 5+ |
| Concrete daemon-mode demand signals ("we want, but cannot use embedded — need a daemon") | **3+ to trigger v0.5; <3 → v0.5 deferred** |
| Production agent-express embedded deployments | 10-50 self-reported |
| Community presets contributed | 1-2 |

### v0.5 (TS app-server adapter, demand-gated)
| Metric | Target |
|---|---|
| `@agent-express/app-server` package | shipped |
| Public protocol JSON schemas published | 100% method coverage |
| 4 transports working (stdio / unix-socket / websocket / off) | shipped |
| Bidirectional approval flow integration with `guard.approve()` | shipped |
| Multi-tenant by design (no singletons in process) | enforced via tests |
| Auto-generated TS SDK | shipped |
| JSON Schema published per release | shipped (enables community-contributed non-TS SDKs) |
| Design partners running app-server in production | 1-2 |
| GitHub stars | 1.5-3K |
| First non-TS-shop evaluator (any team consuming via community-contributed SDK or direct JSON-RPC) | 1+ |

### v0.6+ (Reference applications)
| Metric | Target |
|---|---|
| `presets.codingAgent()` | shipped |
| `presets.chatAssistant()` | shipped |
| `presets.researchAgent()` | shipped |
| `presets.personalAgent()` | shipped |
| `presets.autonomousLoop()` | shipped |
| Genericity test passes — all 5 presets on same `Agent` class with same middleware framework | enforced |
| GitHub stars | 3-5K |

### Honest expectations (per voice #2 distribution analysis)

- **Realistic 6mo:** 300-800 stars (good Show HN + Hono-like cult — best case)
- **Realistic 12mo:** 1.5-3K stars (only if a preset goes viral OR server release lands)
- **Realistic 24mo:** 5K stars or stalled at 2K (depends entirely on founder content engine)
- **Path to 10K+:** requires (a) viral preset, OR (b) paid channel, OR (c) competitor pivot. None controllable.

The roadmap targets the **realistic** scenario, not the moonshot.

