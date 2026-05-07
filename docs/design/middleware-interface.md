---
title: Middleware Interface
status: shipped
ships-with: v0.4.0+
last-revised: 2026-05-07
audience: contributors
---

# Agent Express: Middleware Interface Design

> The single `Middleware` interface and `(ctx, next)` onion pattern that
> compose every memory, guard, tool, observability, and skill middleware in
> the framework.

This document focuses on the *interface*. For the framework's overall
position and why middleware was chosen over graph nodes, see
[`agent-express-concept.md`](agent-express-concept.md). For where each hook
fires within a turn (the model→tool→model loop, abort/skipCall semantics,
the 5-level lifecycle nesting), see [`agent-loop.md`](agent-loop.md). For
the v0.4 event log that middleware can read and extend, see
[`event-log.md`](event-log.md).

---

## 1. The Design Question

Should all middleware (memory, tools, guardrails, turn, context) share one interface or have separate ones?

**Three options from the competitive landscape:**

| Option | Who Does It | Pros | Cons |
|--------|-------------|------|------|
| **One function** `(ctx, next)` | Express.js, Koa, Hono | Simplest, one concept | Loses lifecycle granularity |
| **Per-category interfaces** | Google ADK (8+ callback types) | Type-safe, self-documenting | Too many concepts to learn |
| **One interface, optional lifecycle hooks** | Deep Agents (5 hooks) | Progressive complexity, typed | Object-oriented, less "functional" |

**Answer: Option 3, but simplified.**

One `Middleware` interface with optional lifecycle hooks. Each runtime hook follows the same `(ctx, next)` onion pattern. A middleware implements only the hooks it needs. Simple middleware can also be just a function.

---

## 2. Lifecycle Levels

The agent runtime has six distinct nesting levels. Two are simple hooks (agent lifecycle), four are decorator/onion (runtime execution):

```
┌──────────────────────────────────────────────────────────────┐
│  AGENT (long-lived, one instance serves many conversations)   │
│  init / dispose                                               │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  SESSION (per conversation / thread)                    │  │
│  │  - user identity, restored state, allocated resources   │  │
│  │                                                         │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  TURN (per user message → assistant response)     │  │  │
│  │  │                                                    │  │  │
│  │  │  ┌──────────────────────────────────────────┐     │  │  │
│  │  │  │  MODEL (one LLM call)                     │     │  │  │
│  │  │  │  - messages, model selection, tool schemas │     │  │  │
│  │  │  └──────────────────────────────────────────┘     │  │  │
│  │  │                                                    │  │  │
│  │  │  ┌──────────────────────────────────────────┐     │  │  │
│  │  │  │  TOOL (one tool execution)                │     │  │  │
│  │  │  │  - tool name, args, approval              │     │  │  │
│  │  │  └──────────────────────────────────────────┘     │  │  │
│  │  │                                                    │  │  │
│  │  │  MODEL → TOOL → MODEL → TOOL → ... → final text  │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  │                                                         │  │
│  │  TURN → TURN → TURN → ... (multi-turn conversation)    │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│  SESSION → SESSION → SESSION → ... (many conversations)       │
└──────────────────────────────────────────────────────────────┘
```

### Why these six levels?

**Agent vs Session** -- the critical separation:

| | Agent (init/dispose) | Session (session hook) |
|---|---|---|
| When | Once per agent lifetime | Once per conversation |
| Duration | Hours/days/weeks | Minutes/hours |
| What to do | Connect MCP servers, load skill catalogs, compile tool schemas, warm caches | Load user state, restore checkpoint, load user-specific memories, allocate sandbox |
| Cleanup | Disconnect servers, close DB pools | Save checkpoint, flush memories, destroy sandbox container |

Without this separation, session-scoped work leaks into turn hooks with manual "already loaded?" flags:

```typescript
// BAD: without session hook, loading memories every turn
turn: async (ctx, next) => {
  if (!ctx.state._memoriesLoaded) {                 // ← manual flag, hack
    ctx.state.memories = await loadMemories(ctx.session.userId)
    ctx.state._memoriesLoaded = true
  }
  await next()
}

// GOOD: with session hook, load once per conversation
session: async (ctx, next) => {
  ctx.state.memories = await loadMemories(ctx.userId)
  await next()  // all turns within this session already have memories
}
```

**Why four runtime hooks (not fewer)?** A single `(ctx, next)` wrapping the turn can't intercept individual model calls or tool calls within that turn. You'd need event emitters, which are less composable and less discoverable.

**Why four runtime hooks (not more)?** Google ADK has 8+ callback types. But the onion `(ctx, next)` pattern collapses `beforeModel` + `afterModel` + `onModelError` into one `model` hook (before = above `next()`, after = below `next()`, error = `catch`).

---

## 3. The Middleware Interface

```typescript
// ─── Core type ───────────────────────────────────────────

interface Middleware {
  name: string

  /** Static tool declarations, merged at agent creation */
  tools?: Tool[]

  /** State schema extension, merged at agent creation */
  state?: StateSchema

  // ─── Agent lifecycle (simple hooks) ──────────────────

  /** One-time initialization when agent is created */
  init?(ctx: AgentContext): Promise<void>

  /** Cleanup when agent is shutting down */
  dispose?(): Promise<void>

  // ─── Runtime (decorator/onion) ───────────────────────

  /** Wraps a conversation: session start → all turns → session end */
  session?(ctx: SessionContext, next: () => Promise<void>): Promise<void>

  /** Wraps one full turn: user message → assistant response */
  turn?(ctx: TurnContext, next: () => Promise<void>): Promise<void>

  /** Wraps one LLM call (many per turn) */
  model?(ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse>

  /** Wraps one tool execution (many per model call) */
  tool?(ctx: ToolContext, next: () => Promise<ToolResult>): Promise<ToolResult>
}

// ─── Shorthand: plain function = turn hook ───────────────

type MiddlewareFn = (ctx: TurnContext, next: () => Promise<void>) => Promise<void>

// app.use() accepts both:
type MiddlewareInput = Middleware | MiddlewareFn
```

**The shorthand rule:** if you pass a plain function to `app.use()`, it becomes a `turn` hook. This covers the simplest case (logging, timing, error handling) without requiring an object.

---

## 4. Context Types

Contexts form an inheritance chain that mirrors the lifecycle nesting. Each deeper level has access to everything from the levels above it.

```
AgentContext                        ← init / dispose
  └── SessionContext                ← session
        └── TurnContext             ← turn
              ├── ModelContext       ← model
              └── ToolContext        ← tool
```

```typescript
// ─── Agent (long-lived, one per agent instance) ──────────

interface AgentContext {
  agent: AgentDef                   // name, model, instructions, limits
  registerTool(tool: Tool): void    // dynamic tool registration
  config: Record<string, unknown>   // middleware-specific config from agent def
}

// ─── Session (per conversation / thread) ─────────────────

interface SessionContext extends AgentContext {
  session: Session                  // session ID, metadata, history
  userId: string                    // who is talking
  sessionId: string                 // conversation identifier
  isResumed: boolean                // restored from checkpoint?

  // Session-scoped state (shared across all turns in this session)
  state: StateProxy                 // typed proxy: state.memories, state.cost, etc.

  // Events (for streaming to client)
  emit(event: StreamEvent): void
}

// ─── Turn (per user message → assistant response) ────────

interface TurnContext extends SessionContext {
  // This turn's data
  input: Message[]                  // user message(s) for this turn
  output: Message | null            // assistant response (populated after model call)
  turnId: string                    // unique turn identifier

  // Control flow
  abort(reason: string): never      // short-circuit the entire turn

  // Metadata
  turnIndex: number                 // which turn in this session (0, 1, 2, ...)
  startedAt: number
  traceId: string
}

// ─── Model (per LLM call, many per turn) ─────────────────

interface ModelContext extends TurnContext {
  // What will be sent to the LLM
  messages: Message[]               // conversation messages (mutable)
  model: string                     // model identifier (mutable via setModel)
  toolDefs: ToolDef[]               // tool schemas being sent (mutable)

  // Mutations
  setModel(model: string): void             // override model for this call
  addSystemMessage(text: string): void      // inject into system prompt
  addMessage(msg: Message): void            // inject into conversation
  removeTools(...names: string[]): void     // hide tools from this call

  // Short-circuit
  skipCall(response: ModelResponse): void   // return without calling LLM (caching)

  // Metadata
  callIndex: number                 // which model call in this turn (0, 1, 2, ...)
}

// ─── Tool (per tool execution, many per model call) ──────

interface ToolContext extends TurnContext {
  // What will be executed
  tool: ToolDef                     // tool being called (name, schema)
  args: Record<string, unknown>     // arguments from the LLM (mutable)
  callId: string                    // tool call ID from the model

  // Mutations
  modifyArgs(newArgs: Record<string, unknown>): void  // transform args

  // Control flow
  approve(): void                   // explicit approval (for HITL)
  deny(reason: string): void        // block execution, return error to model
  skipCall(result: ToolResult): void // return without executing (mocking)

  // Metadata
  callIndex: number                 // which tool call in this model response
}
```

### Why inheritance, not composition?

The nesting is physical, not conceptual. A tool call **literally happens inside** a turn, which **literally happens inside** a session, which **literally runs on** an agent. Every deeper level needs access to the shallower data:

- A `tool` hook checking cost needs `ctx.state.totalCost` (from SessionContext)
- A `model` hook routing by model needs `ctx.agent.limits` (from AgentContext)
- A `tool` hook logging needs `ctx.sessionId` + `ctx.turnId` + `ctx.callId` (all levels)

Inheritance gives this naturally. Composition would require `ctx.session.state.totalCost` or `ctx.agent.agent.limits` -- verbose and redundant.

---

## 5. Execution Model

### 5.1 Hook Chaining (Onion Model)

When multiple middleware implement the same hook, they form an onion:

```
app.use(A)  // implements model hook
app.use(B)  // implements model hook
app.use(C)  // implements model hook

Execution order for a model call:

  A.model(ctx, next) ──────────────────────────────────────┐
    │ [A's "before" logic]                                  │
    ├── B.model(ctx, next) ────────────────────────────┐   │
    │     │ [B's "before" logic]                        │   │
    │     ├── C.model(ctx, next) ──────────────────┐   │   │
    │     │     │ [C's "before" logic]              │   │   │
    │     │     ├── [ACTUAL LLM CALL]               │   │   │
    │     │     │ [C's "after" logic]               │   │   │
    │     │     └──────────────────────────────────┘   │   │
    │     │ [B's "after" logic]                        │   │
    │     └────────────────────────────────────────────┘   │
    │ [A's "after" logic]                                  │
    └──────────────────────────────────────────────────────┘
```

Registration order = outside-in. First registered middleware is outermost (runs first before, last after). This is the standard onion model from Koa/Express.

### 5.2 Cross-Hook Execution Within a Turn

```
Turn start
  │
  ├─ A.turn(ctx, next) wraps everything below
  │   ├─ B.turn(ctx, next) wraps everything below
  │   │   │
  │   │   │  ┌─── Step 1 (model call + tool execution) ─────────┐
  │   │   │  │                                                    │
  │   │   │  │  A.model(ctx, next)                                │
  │   │   │  │    B.model(ctx, next)                              │
  │   │   │  │      [LLM CALL] → returns tool calls               │
  │   │   │  │                                                    │
  │   │   │  │  for each tool call:                               │
  │   │   │  │    A.tool(ctx, next)                               │
  │   │   │  │      B.tool(ctx, next)                             │
  │   │   │  │        [TOOL EXECUTION]                            │
  │   │   │  │                                                    │
  │   │   │  └────────────────────────────────────────────────────┘
  │   │   │
  │   │   │  ┌─── Step 2 (model call with tool results) ─────────┐
  │   │   │  │                                                    │
  │   │   │  │  A.model(ctx, next)                                │
  │   │   │  │    B.model(ctx, next)                              │
  │   │   │  │      [LLM CALL] → returns final text               │
  │   │   │  │                                                    │
  │   │   │  └────────────────────────────────────────────────────┘
  │   │   │
  │   │   └─ B.turn "after" logic
  │   └─ A.turn "after" logic
  │
Turn end
```

### 5.3 Middleware Registration

```typescript
const app = new AgentApp()

// Shorthand: function = turn hook
app.use(async (ctx, next) => {
  const start = Date.now()
  await next()
  console.log(`Turn took ${Date.now() - start}ms`)
})

// Full form: object with hooks
app.use({
  name: "cost-tracker",
  state: {
    totalCost: { type: "number", default: 0, reducer: (a, b) => a + b }
  },
  model: async (ctx, next) => {
    const response = await next()
    ctx.state.totalCost += calculateCost(response.usage)
    return response
  }
})
```

---

## 6. How Each Category Maps to the Interface

### 6.1 Memory Middleware

Memory needs to: inject context before model call, save knowledge after turn.

```typescript
const episodicMemory: Middleware = {
  name: "memory-episodic",

  state: {
    memories: { type: "array", default: [] }
  },

  // Load memory store on session start
  async init(ctx) {
    this.store = await MemoryStore.open(ctx.config.backend ?? "sqlite")
  },

  // Inject relevant memories before each LLM call
  async model(ctx, next) {
    const query = lastUserMessage(ctx.messages)
    const memories = await this.store.search(query, { limit: 5 })

    if (memories.length > 0) {
      ctx.addSystemMessage(
        `## Relevant memories\n${memories.map(m => `- ${m.text}`).join("\n")}`
      )
    }

    return await next()
  },

  // After the full turn, save noteworthy information
  async turn(ctx, next) {
    await next()

    // Extract facts from the conversation and persist
    const facts = extractFacts(ctx.output)
    if (facts.length > 0) {
      await this.store.save(facts)
    }
  }
}
```

**Why this works:** `model` hook injects memories into each LLM call (not just the first -- important for multi-step turns). `turn` hook saves memories once per turn after completion. Clean separation.

### 6.2 Working Memory / Context Window Middleware

Manages context size: trims old messages, summarizes, evicts large results.

```typescript
const contextManager: Middleware = {
  name: "context-manager",

  // Before each LLM call: check context budget, summarize if needed
  async model(ctx, next) {
    const tokenCount = estimateTokens(ctx.messages)
    const budget = getModelContextWindow(ctx.model)

    if (tokenCount > budget * 0.85) {
      // Summarize older messages, keep recent ones
      const { summarized, kept } = await summarize(
        ctx.messages,
        { keepRecent: 10, model: "haiku-4.5" }
      )
      ctx.messages.length = 0
      ctx.messages.push(summarized, ...kept)
    }

    return await next()
  },

  // After each tool call: evict large results to files
  async tool(ctx, next) {
    const result = await next()

    if (estimateTokens(result.content) > 20_000) {
      const path = `/.cache/tool-results/${ctx.callId}.md`
      await ctx.session.writeFile(path, result.content)
      return {
        ...result,
        content: `Result saved to ${path} (${result.content.length} chars). Use read_file to access.`
      }
    }

    return result
  }
}
```

**Why both hooks:** `model` handles pre-call summarization. `tool` handles post-execution result eviction. Two different lifecycle points, one middleware.

### 6.3 Guard Middleware

Guards validate input/output and can block execution.

```typescript
// Simple guard: cost cap
const costCap: Middleware = {
  name: "guard-cost-cap",

  model: async (ctx, next) => {
    if (ctx.state.totalCost >= ctx.agent.limits.maxCost) {
      ctx.abort("Session cost limit exceeded")
    }
    return await next()
  }
}

// Input guard with OpenAI-style racing
const inputGuard: Middleware = {
  name: "guard-input-safety",

  model: async (ctx, next) => {
    // Race guardrail check against model call (OpenAI pattern)
    const [guardResult, modelResult] = await Promise.allSettled([
      classifyInput(ctx.messages),
      next()
    ])

    // If guard triggered, discard model response
    if (guardResult.status === "fulfilled" && guardResult.value.unsafe) {
      ctx.abort(`Blocked: ${guardResult.value.reason}`)
    }

    // If guard errored, still use model response (fail-open)
    if (modelResult.status === "rejected") throw modelResult.reason
    return modelResult.value
  }
}

// Tool-level guard: human approval for dangerous actions
const actionApproval: Middleware = {
  name: "guard-action-approval",

  tool: async (ctx, next) => {
    const dangerousTools = ["delete_user", "process_refund", "drop_table"]

    if (dangerousTools.includes(ctx.tool.name)) {
      // Pause execution, emit approval request to UI
      ctx.emit({ type: "approval_required", tool: ctx.tool.name, args: ctx.args })

      const decision = await ctx.session.waitForApproval(ctx.callId)

      if (decision.approved) {
        return await next()
      } else {
        ctx.deny(decision.reason ?? "User denied action")
      }
    }

    return await next()
  }
}
```

**Key pattern:** Cost cap uses `model` hook (check before each LLM call). Input safety uses `model` hook with `Promise.allSettled` for racing. Tool approval uses `tool` hook. Same interface, three different guard strategies.

### 6.4 Tools Middleware

Registers tools and handles their execution.

```typescript
// MCP tools: register from MCP servers
const mcpTools: Middleware = {
  name: "tools-mcp",

  async init(ctx) {
    this.servers = await Promise.all(
      ctx.config.servers.map(s => McpClient.connect(s))
    )

    // Register all tools from all MCP servers
    for (const server of this.servers) {
      const tools = await server.listTools()
      tools.forEach(t => ctx.registerTool(mcpToolToTool(t, server)))
    }
  },

  // MCP tool execution passes through the tool hook
  // (no custom tool hook needed -- tools are registered with executors in setup)
}

// Deferred tools (Claude Code pattern): register names only, load on demand
const deferredTools: Middleware = {
  name: "tools-deferred",

  tools: [
    // Meta-tool that loads actual tool schemas
    {
      name: "load_tool",
      description: "Load a tool's full schema. Available tools: github, jira, slack...",
      schema: { query: { type: "string" } },
      execute: async (args, ctx) => {
        const tool = await this.registry.resolve(args.query)
        ctx.registerTool(tool)  // dynamically add to agent's toolkit
        return { loaded: tool.name, schema: tool.schema }
      }
    }
  ],

  async init(ctx) {
    this.registry = new ToolRegistry(ctx.config.sources)
    // Inject available tool names into system prompt
    const names = await this.registry.listNames()
    ctx.agent.instructions += `\n\nAvailable tools (use load_tool to activate): ${names.join(", ")}`
  }
}
```

### 6.5 Turn Middleware (Checkpoint, Trace, Retry)

Operates at the turn level: wrapping the entire cycle.

```typescript
// Checkpoint: save state after each turn for durability
const checkpoint: Middleware = {
  name: "turn-checkpoint",

  async init(ctx) {
    this.store = await CheckpointStore.open(ctx.config.backend ?? "sqlite")
    // Restore from last checkpoint if resuming
    const last = await this.store.latest(ctx.agent.name, ctx.session.id)
    if (last) ctx.session.restore(last)
  },

  async turn(ctx, next) {
    await next()
    // Save checkpoint after successful turn completion
    await this.store.save({
      agentName: ctx.agent.name,
      sessionId: ctx.session.id,
      state: ctx.state.snapshot(),
      messages: ctx.session.messages,
      turnId: ctx.turnId,
    })
  },

  // Also checkpoint after each model call (finer granularity)
  async model(ctx, next) {
    const response = await next()
    if (ctx.config.every === "step") {
      await this.store.saveStep(ctx.turnId, ctx.callIndex, ctx.state.snapshot())
    }
    return response
  }
}

// Trace: emit structured trace events
const trace: Middleware = {
  name: "turn-trace",

  async turn(ctx, next) {
    const span = tracer.startSpan("turn", { turnId: ctx.turnId })
    try {
      await next()
      span.setStatus("ok")
    } catch (err) {
      span.setStatus("error", err.message)
      throw err
    } finally {
      span.end()
    }
  },

  async model(ctx, next) {
    const span = tracer.startSpan("model_call", {
      model: ctx.model,
      messageCount: ctx.messages.length,
    })
    const response = await next()
    span.setAttribute("tokens.input", response.usage.input)
    span.setAttribute("tokens.output", response.usage.output)
    span.end()
    return response
  },

  async tool(ctx, next) {
    const span = tracer.startSpan("tool_call", { tool: ctx.tool.name })
    const result = await next()
    span.end()
    return result
  }
}

// Retry: retry failed LLM calls with backoff
const retry: Middleware = {
  name: "turn-retry",

  async model(ctx, next) {
    let lastError: Error | undefined
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await next()
      } catch (err) {
        lastError = err as Error
        if (!isRetryable(err)) throw err
        await sleep(Math.pow(2, attempt) * 1000)
      }
    }
    throw lastError
  }
}
```

### 6.6 Model Router Middleware

Per-turn and per-tool model selection.

```typescript
const modelRouter: Middleware = {
  name: "turn-model-router",

  async model(ctx, next) {
    // Per-complexity routing
    const complexity = estimateComplexity(ctx.messages)
    const routes = ctx.config.routes ?? {
      simple:  "haiku-4.5",
      medium:  "sonnet-4.6",
      complex: "opus-4.6",
    }
    ctx.setModel(routes[complexity] ?? ctx.model)
    return await next()
  },

  async tool(ctx, next) {
    // Per-tool model routing (Docker Agent pattern):
    // after tool execution, the NEXT model call uses a tool-specific model
    const perToolModel = ctx.config.perTool?.[ctx.tool.name]
    if (perToolModel) {
      ctx.state._nextModelOverride = perToolModel
    }
    return await next()
  }
}
```

### 6.7 Skills Middleware (Claude Code Pattern)

Lazy-loaded markdown instructions.

```typescript
const skills: Middleware = {
  name: "skills",

  state: {
    loadedSkills: { type: "object", default: {} }
  },

  async init(ctx) {
    this.catalog = await SkillCatalog.scan(ctx.config.sources)

    // Register a "read_skill" tool for on-demand loading
    ctx.registerTool({
      name: "read_skill",
      description: "Load full instructions for a skill",
      schema: { skillName: { type: "string", enum: this.catalog.names() } },
      execute: async (args) => {
        const content = await this.catalog.load(args.skillName)
        return { content }
      }
    })
  },

  // Inject skill list (names + descriptions only) into system prompt
  async model(ctx, next) {
    if (ctx.callIndex === 0) {  // only on first model call per turn
      const list = this.catalog.entries()
        .map(s => `- ${s.name}: ${s.description}`)
        .join("\n")
      ctx.addSystemMessage(`## Available skills\n${list}\nUse read_skill to load full instructions.`)
    }
    return await next()
  }
}
```

### 6.8 Sub-Agent Middleware

Agent delegation following the OpenAI handoff-as-tool pattern.

```typescript
const subAgents: Middleware = {
  name: "sub-agents",

  async init(ctx) {
    const subAgentDefs = ctx.config.agents ?? []

    // Register a "delegate" tool for each sub-agent
    for (const sub of subAgentDefs) {
      ctx.registerTool({
        name: `delegate_to_${sub.name}`,
        description: sub.description,
        schema: { task: { type: "string" } },
        execute: async (args, toolCtx) => {
          // Run sub-agent with isolated context (Claude Code pattern)
          const subApp = new AgentApp()
          subApp.use(...sub.middleware)
          const result = await subApp.run(sub.name, {
            input: args.task,
            parentSession: toolCtx.session,
          })
          return { result: result.output }
        }
      })
    }
  }
}
```

---

## 7. The Complete Picture

Every category uses the same four hooks differently:

```
                     init    dispose  session    turn    model   tool
                     ────    ───────  ───────    ────    ─────   ────
memory-episodic       .        .      [load]    [save]  [inject]  .
memory-working        .        .        .         .     [trim]  [evict]
guard-cost-cap        .        .        .         .     [check]   .
guard-input           .        .        .         .     [race]    .
guard-approval        .        .        .         .       .     [approve]
tools-mcp           [conn]   [disc]     .         .       .       .
tools-deferred      [catalog]  .        .         .       .       .
checkpoint            .        .      [restore]  [save]  [step]   .
trace                 .        .      [span]    [span]  [span]  [span]
retry                 .        .        .         .     [retry]   .
model-router          .        .        .         .     [route]   .
skills              [scan]     .        .         .     [list]    .
sub-agents          [register] .        .         .       .       .
sandbox               .        .      [alloc]     .       .     [exec]
user-auth             .        .      [verify]    .       .       .
todos                 .        .        .         .     [inject]  .
```

**Observation:** Every category is a different PATTERN of using the same hooks. No category needs a special interface. The `Middleware` type is sufficient for all of them.

Key shift from the original design: `session` hook fills the gap between agent-level init and per-turn execution. Memory loading, checkpoint restore, sandbox allocation, and user auth all live here now -- previously they were awkwardly stuffed into `turn` with manual "already done?" flags.

---

## 8. Why This Design Beats the Alternatives

### vs. Google ADK (8+ callbacks)

ADK requires learning: `before_agent_callback`, `after_agent_callback`, `before_model_callback`, `after_model_callback`, `on_model_error_callback`, `before_tool_callback`, `after_tool_callback`, `on_tool_error_callback` -- plus the Plugin system with its own parallel set.

Agent Express: four hooks. `before_X` + `after_X` + `on_X_error` collapse into one onion function:

```typescript
// ADK: three separate callbacks
before_model_callback = (ctx, request) => { /* before */ }
after_model_callback = (ctx, response) => { /* after */ }
on_model_error_callback = (ctx, error) => { /* error */ }

// Agent Express: one hook
model: async (ctx, next) => {
  // before
  try {
    const response = await next()
    // after
    return response
  } catch (error) {
    // error
    throw error
  }
}
```

**3 callbacks → 1 hook.** Same power, less API surface.

### vs. OpenAI Agents SDK (Hooks + Guardrails)

OpenAI separates hooks (observability) from guardrails (safety) as different systems. Agent Express unifies them -- a guardrail IS a middleware that uses the `model` or `tool` hook to short-circuit.

```typescript
// OpenAI: separate systems
agent.input_guardrails = [safety_check]    // GuardrailFunctionOutput
agent.hooks = AgentHooks(on_model_start=log)  // void callbacks

// Agent Express: one system
app.use(safetyGuard)   // model hook that aborts on unsafe input
app.use(logger)        // model hook that logs calls
// Both are Middleware. Same interface. Same composition.
```

**2 systems → 1 system.** Guardrails compose with other middleware naturally.

### vs. LangGraph (Graph nodes)

LangGraph uses graph topology for extensibility. Adding logging = adding a graph node + edges. Adding guardrails = adding a guard node + conditional edges.

Agent Express: add middleware. No graph rewiring.

```typescript
// LangGraph: modify graph structure
graph.add_node("guard", guard_function)
graph.add_edge("guard", "agent")
graph.add_conditional_edges("guard", should_continue, {"block": END, "pass": "agent"})

// Agent Express: add middleware
app.use(guard)
```

### vs. Deep Agents (5-hook objects)

Deep Agents is closest to Agent Express. Key differences:

| | Deep Agents | Agent Express |
|---|---|---|
| Hooks | `stateSchema`, `tools`, `beforeAgent`, `wrapModelCall`, `wrapToolCall` | `state`, `tools`, `init`, `dispose`, `session`, `turn`, `model`, `tool` |
| Turn-level hook | None (no turn wrapping) | `turn` (wraps full turn) |
| Shorthand | None (always object) | Function = turn hook |
| Underlying runtime | LangGraph (Pregel BSP) | Simple loop (no graph) |
| State extension | `stateSchema` returns TypedDict/Annotation | `state` property with reducer functions |

Agent Express adds the `turn` hook (Deep Agents doesn't have it -- they rely on LangGraph's graph-level wrapping) and the function shorthand for simple cases.

### vs. Docker Agent (Shell hooks)

Docker Agent uses shell scripts for hooks. Powerful for ops, but limited for complex logic (no state, no composition, no type safety).

Agent Express middleware are TypeScript functions -- full language power, typed contexts, composable.

---

## 9. Edge Cases and Design Decisions

### 9.1 Middleware That Needs Multiple Hooks

A middleware CAN implement multiple hooks. This is intentional -- it's how a middleware becomes a self-contained unit:

```typescript
const costTracker: Middleware = {
  name: "cost-tracker",
  state: { totalCost: { type: "number", default: 0, reducer: (a, b) => a + b } },

  // Check budget before each model call
  model: async (ctx, next) => {
    if (ctx.state.totalCost >= 5.00) ctx.abort("Budget exceeded")
    const response = await next()
    ctx.state.totalCost += calculateCost(response.usage)
    return response
  },

  // Log per-turn cost
  turn: async (ctx, next) => {
    const before = ctx.state.totalCost
    await next()
    console.log(`Turn cost: $${(ctx.state.totalCost - before).toFixed(4)}`)
  }
}
```

**This is the Deep Agents insight:** middleware is a self-contained unit with its own state, tools, and behavior across multiple lifecycle points.

### 9.2 Hook Execution Order Across Middleware

Given `app.use(A); app.use(B); app.use(C)`:

- **`turn` hooks:** A.turn → B.turn → C.turn → [turn execution] → C → B → A
- **`model` hooks (within turn):** A.model → B.model → C.model → [LLM call] → C → B → A
- **`tool` hooks (within turn):** A.tool → B.tool → C.tool → [tool exec] → C → B → A

All hooks follow the same onion order, independently. A middleware's `turn` and `model` hooks don't need special coordination -- the runtime handles nesting.

### 9.3 Short-Circuiting

Three ways to short-circuit:

```typescript
// 1. abort() -- terminate the entire turn with error
model: async (ctx, next) => {
  if (unsafe) ctx.abort("Blocked by safety guard")
  return await next()
}

// 2. skipCall() -- return without calling downstream (caching, mocking)
model: async (ctx, next) => {
  const cached = cache.get(ctx.messages)
  if (cached) { ctx.skipCall(cached); return cached }
  return await next()
}

// 3. deny() -- tool-level, returns error to model (model retries with different approach)
tool: async (ctx, next) => {
  if (ctx.tool.name === "rm_rf") {
    ctx.deny("This tool is not allowed")
    // NOT thrown -- returns error as tool result, model can adapt
  }
  return await next()
}
```

**`abort`** = hard stop, error to user. **`skipCall`** = bypass downstream, return synthetic result. **`deny`** = tool-only, soft failure that the model sees.

### 9.4 Async Setup and Teardown

```typescript
const mcp: Middleware = {
  name: "tools-mcp",

  async init(ctx) {
    // Async initialization: connect to MCP servers
    this.client = await McpClient.connect(ctx.config.server)
    const tools = await this.client.listTools()
    tools.forEach(t => ctx.registerTool(t))
  },

  // Teardown: the AgentApp calls dispose() on shutdown
  async dispose() {
    await this.client?.disconnect()
  }
}
```

`setup` runs once when the agent/session starts. `dispose` (optional) runs on shutdown. Both are async.

### 9.5 State Reducers (From LangGraph)

Middleware can extend shared state with typed fields and merge strategies:

```typescript
const todos: Middleware = {
  name: "todos",

  state: {
    todos: {
      type: "array",
      items: { content: "string", status: "string" },
      default: [],
      reducer: (existing, update) => {
        // Replace by ID, append new
        const map = new Map(existing.map(t => [t.id, t]))
        for (const t of update) map.set(t.id, t)
        return [...map.values()]
      }
    }
  },

  tools: [writeTodosTool],

  model: async (ctx, next) => {
    if (ctx.state.todos.length > 0) {
      ctx.addSystemMessage(formatTodos(ctx.state.todos))
    }
    return await next()
  }
}
```

State fields from multiple middleware merge into one `StateProxy`. Reducers prevent accidental overwrites when multiple middleware touch the same field.

### 9.6 Composing Middleware Into Bundles

For common patterns, middleware can be pre-composed:

```typescript
// A "deep agent" bundle (equivalent to Deep Agents' create_deep_agent)
function deepAgent(config?: DeepAgentConfig): Middleware[] {
  return [
    todos(),
    skills({ sources: config?.skills }),
    contextManager({ trigger: 0.85 }),
    episodicMemory({ backend: config?.memoryBackend }),
    subAgents({ agents: config?.subAgents }),
    modelRouter({ routes: config?.modelRoutes }),
    checkpoint({ backend: config?.checkpointBackend }),
    trace({ format: "otel" }),
  ]
}

// Usage:
app.use(...deepAgent({ skills: ["./skills/"] }))
```

This is how Agent Express provides "batteries-included" without sacrificing composability.

---

## 10. Summary: The Interface

```typescript
//
// This is the entire middleware interface.
// Every memory, guard, tool, turn, context, skill, and sub-agent middleware
// implements this single type.
//

interface Middleware {
  /** Identifier for debugging and tracing */
  name: string

  /** Static tool declarations (merged at agent creation) */
  tools?: Tool[]

  /** State schema extensions (merged at agent creation, with reducers) */
  state?: StateSchema

  // ─── Agent lifecycle (simple hooks, once) ──────────────

  /** One-time init: connect services, register dynamic tools */
  init?(ctx: AgentContext): Promise<void>

  /** Cleanup: disconnect services, release resources */
  dispose?(): Promise<void>

  // ─── Runtime (decorator/onion, nested) ─────────────────

  /** Wraps a conversation: session start → all turns → session end */
  session?(ctx: SessionContext, next: () => Promise<void>): Promise<void>

  /** Wraps one turn: user message → assistant response */
  turn?(ctx: TurnContext, next: () => Promise<void>): Promise<void>

  /** Wraps one LLM call (many per turn) */
  model?(ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse>

  /** Wraps one tool execution (many per model call) */
  tool?(ctx: ToolContext, next: () => Promise<ToolResult>): Promise<ToolResult>
}

// Context inheritance chain:
//   AgentContext → SessionContext → TurnContext → ModelContext
//                                              → ToolContext
```

**One interface. Six hooks. Two simple (init/dispose) + four onion (session/turn/model/tool).**

The categories (memory, guard, tools, turn, context, skills, sub-agents) are not types -- they're **patterns** of using the same interface. A memory middleware implements `init` + `session` + `model`. A guard implements `model` and/or `tool`. A checkpoint implements `session` + `turn` + `model`. They all compose on one stack.

---

## 11. Where to next

- [`agent-loop.md`](agent-loop.md) — where each hook fires inside the
  agent loop, control flow primitives (`abort`, `skipCall`, `deny`),
  ordering and composition rules
- [`event-log.md`](event-log.md) — how middleware declares its own event
  types via `events:` and reads them back through `typedEvents`
- [`observability.md`](observability.md) — six observability middlewares
  (`observe.usage`, `observe.tools`, `observe.duration`, `observe.log`,
  `observe.metrics`, `observe.traces`) showing the model+turn pattern
- [`adapters.md`](adapters.md) — how middleware that needs external
  services (storage, embeddings, search) declares an adapter contract
- [`testing.md`](testing.md) — how to unit-test a middleware in
  isolation with `testAgent` and `FunctionModel`

This is the Express.js insight applied to agents: the middleware signature is simple and universal. The richness comes from what you do inside it, not from how many interface types you need to learn.