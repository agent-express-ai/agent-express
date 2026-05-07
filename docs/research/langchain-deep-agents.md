# LangChain Deep Agents — Architectural Reference

Reverse-engineered from publicly available materials, generated 2026-04-30.
Used as design reference for agent-express v0.4 framework + v0.5 Go server.

## 1. Executive Summary

- **Deep Agents** is, in LangChain's own words, "an agent harness... an opinionated, ready-to-run agent out of the box" — a pre-wired bundle of (1) a long Claude-Code-style system prompt, (2) a `write_todos` planning tool, (3) a virtual filesystem (`ls`/`read_file`/`write_file`/`edit_file`/`glob`/`grep`), (4) a `task` tool that spawns isolated sub-agents, and (5) a `summarization` middleware that compacts message history. There is no novel runtime; `create_deep_agent()` returns a *compiled LangGraph graph*. Everything Deep Agents adds rides on LangGraph's existing state/checkpoint/interrupt machinery.
- The architectural thesis (from the original blog post): an LLM becomes "deep" — i.e., capable of long-horizon work — when given **a planning tool, sub-agents, file-system access, and a detailed system prompt**. Each is essentially context engineering: the planning tool is "basically a no-op" that exists to keep the model on track; the filesystem is "mocked out" using LangGraph state; sub-agents exist mainly to give context isolation; the system prompt is "long" and "[contains] detailed instructions on how to use tools."
- The execution model is **LangGraph durable execution**. A Deep Agent is a `CompiledStateGraph` parameterised by a thread id. State is checkpointed each super-step via a `Checkpointer`; runs can be resumed across processes; human-in-the-loop is built on LangGraph's `interrupt`/`Command` primitives; `interrupt_on={"tool_name": True}` wires HITL approval onto specific tools. Multi-tenancy is "scoped threads + per-user sandboxes + RBAC" — provided by **Deep Agents Deploy** (LangSmith Deployment), not the open-source SDK on its own.
- The differentiator vs. Anthropic's Claude Agent SDK is **pluggable backends**. The same agent can run with a `StateBackend` (files live in LangGraph state, ephemeral within a thread), a `FilesystemBackend` (real local disk), `LangSmithStore` (cross-thread persistence), or a `SandboxBackendProtocol` implementation (Modal, Daytona, Runloop, Deno). A `CompositeBackend` routes by path prefix. The agent process and the sandbox are decoupled — the agent can run in a long-lived container and treat a remote sandbox as one tool among many, rather than colocating with the sandbox.
- Sub-agents are **declared as plain Python `TypedDict`s** (`SubAgent { name, description, system_prompt, tools?, model?, middleware?, interrupt_on?, permissions?, response_format? }`) and invoked through a single tool — `task` — that takes `{ description, subagent_type }`. Each sub-agent invocation is a **fresh LangGraph compilation** with its own messages array; only the final message of the sub-agent run is returned to the parent as a `ToolMessage`. The sub-agent inherits the parent's `files` channel (so the virtual filesystem is shared) but does not see the parent's todos/skills/memory.
- The customisation surface is the **LangChain agent middleware** stack: `TodoListMiddleware`, `FilesystemMiddleware`, `SubAgentMiddleware`, `SummarizationMiddleware`, `PatchToolCallsMiddleware`, `AnthropicPromptCachingMiddleware`, optional `MemoryMiddleware`, `SkillsMiddleware`, `AsyncSubAgentMiddleware`, `_ToolExclusionMiddleware`, `HumanInTheLoopMiddleware`. User middleware is inserted at a fixed slot in the stack. Two middlewares are *required* and cannot be excluded: `FilesystemMiddleware` and `SubAgentMiddleware` — removing either silently breaks core features.

In one sentence: Deep Agents is a *batteries-included LangGraph harness* whose value is a curated middleware stack (planning + virtual FS + sub-agents + summarisation + caching) plus a pluggable backend interface, sitting on top of LangGraph's pre-existing durable execution, checkpointer, and interrupt primitives.

## 2. Core Conceptual Model

| Primitive | LangChain's definition (quoted) | Scope |
|---|---|---|
| **Deep Agent** | "An agent harness. An opinionated, ready-to-run agent out of the box. Instead of wiring up prompts, tools, and context management yourself, you get a working agent immediately and customize what you need." (README) | One compiled LangGraph graph, returned from `create_deep_agent`. Not a server, not a runtime — a graph object you `.invoke()`. |
| **Planning tool / TodoList** | "Claude Code uses a Todo list tool. Funnily enough — this doesn't do anything! It's basically a no-op." / "A no-op Todo list planning tool (same as Claude Code) … It's just context engineering strategy to keep the agent on track." (LangChain blog) | A single tool `write_todos` whose only effect is to update a `todos: list` field in graph state. Provided by `TodoListMiddleware`. |
| **Virtual filesystem** | "A mocked out virtual file system that uses the agents state (a preexisting LangGraph concept)." (blog) / "It also acts as a shared workspace for all agents (and sub agents) to collaborate on." (blog) | Set of file tools (`ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`) backed by a `BackendProtocol`. Default backend is `StateBackend`, which stores files in the LangGraph `files` channel. |
| **Sub-agent** | "Claude Code can spawn sub agents. This allows it to split up tasks." / "Deep agents go deeper on topics. This is largely accomplished by spinning up sub agents that specifically focused on individual tasks." / TypedDict: "Specification for an agent." (subagents.py) | A declared agent spec; the parent invokes a sub-agent through the `task` tool, which calls `create_agent()` on the spec, runs it, returns final message. |
| **`task` tool** | "Launch an ephemeral subagent to handle complex, multi-step independent tasks with isolated context windows." (TASK_TOOL_DESCRIPTION, subagents.py) | Single tool the parent uses to delegate. Schema: `{ description: str, subagent_type: str }`. |
| **Detailed system prompt** | "Claude Code's recreated system prompts are long. They contain detailed instructions on how to use tools." / "Without these system prompts, the agents would not be nearly as deep. Prompting matters still!" (blog) | A multi-section composition: `USER` prompt → `BASE` (~80-line default) → optional `CUSTOM` from `HarnessProfile` → optional `SUFFIX`. Joined by blank lines. |
| **Backend (`BackendProtocol`)** | "Pluggable: local, virtual filesystem, remote sandbox, or custom." (comparison page) | Interface implementing file ops. Implementations: `StateBackend`, `FilesystemBackend`, `LangSmithStore`, `LocalShell`, `SandboxBackend`, `CompositeBackend`. |
| **Sandbox backend** (`SandboxBackendProtocol`) | "Extension of `BackendProtocol` that adds shell command execution. Designed for backends running in isolated environments (containers, VMs, remote hosts)." (protocol.py) | Adds `execute()` for shell. When attached, the `execute` tool becomes live; otherwise it returns an error. |
| **Middleware** | LangChain agent middleware (`AgentMiddleware` from `langchain.agents.middleware`). Hooks: `before_agent`, `before_model`, `wrap_model_call`, `wrap_tool_call`, `after_tool`, etc. | The customisation primitive. Each Deep Agents feature is a middleware. |
| **HarnessProfile** | "Harness profiles (beta): declarative bundles of system prompt, tool, middleware, and subagent tweaks, registered per provider or specific model." (comparison page) | Per-model tuning bundle — replaces the default system prompt with a model-specific one, adds suffix, attaches extra middleware. Pattern matches OpenAI's `model_provider`. |
| **LangGraph backbone** | "`create_deep_agent` returns a compiled LangGraph graph. Use it with streaming, Studio, checkpointers, or any LangGraph feature." (README) | Not a re-implementation. Deep Agents *is* a LangGraph graph and inherits all LangGraph runtime features. |
| **Checkpointer** | LangGraph: "specify a checkpointer that will save workflow progress." (durable-execution docs) | Persistence layer attached at compile time (`checkpointer=…`). Source of durability. |
| **Thread / `thread_id`** | LangGraph: configurable as `{"configurable": {"thread_id": thread_id}}` | Multi-conversation isolation. Each session uses a thread. |
| **Skills** | (SkillsMiddleware) — `skills: list[str]` parameter to `create_deep_agent` accepts paths to skill directories | A directory of capability bundles loaded as context. Mirrors Anthropic's "Skills" / OpenAI Codex's `SKILL.md`. |
| **Memory** | `MemoryMiddleware` — `memory: list[str]` accepts memory paths | Cross-thread memory store. Optional; when absent, agent only has thread-scoped state. |

## 3. The API Surface

### 3.1 Python — `create_deep_agent`

Signature (verbatim from `libs/deepagents/deepagents/graph.py`):

```python
def create_deep_agent(
    model: str | BaseChatModel | None = None,
    tools: Sequence[BaseTool | Callable | dict[str, Any]] | None = None,
    *,
    system_prompt: str | SystemMessage | None = None,
    middleware: Sequence[AgentMiddleware] = (),
    subagents: Sequence[SubAgent | CompiledSubAgent | AsyncSubAgent] | None = None,
    skills: list[str] | None = None,
    memory: list[str] | None = None,
    permissions: list[FilesystemPermission] | None = None,
    backend: BackendProtocol | BackendFactory | None = None,
    interrupt_on: dict[str, bool | InterruptOnConfig] | None = None,
    response_format: ResponseFormat[ResponseT] | type[ResponseT] | dict[str, Any] | None = None,
    context_schema: type[ContextT] | None = None,
    checkpointer: Checkpointer | None = None,
    store: BaseStore | None = None,
    debug: bool = False,
    name: str | None = None,
    cache: BaseCache | None = None,
) -> CompiledStateGraph[...]
```

Returns a **compiled LangGraph state graph**. All LangGraph features — `.invoke`, `.stream`, `.astream`, Studio, checkpointer, `.get_state(config)`, `.update_state(config, ...)` — work directly on the returned object.

### 3.2 TypeScript — `createDeepAgent`

Signature (from `libs/deepagents/src/agent.ts`):

```typescript
export function createDeepAgent<...>(params: CreateDeepAgentParams = {}) { ... }
```

Where `CreateDeepAgentParams` is, effectively:

```typescript
{
  model?: string | BaseLanguageModel,           // default "anthropic:claude-sonnet-4-6"
  tools?: (ClientTool | ServerTool)[],
  systemPrompt?: string | SystemMessage,
  middleware?: AgentMiddleware[],
  subagents?: AnySubAgent[],                    // SubAgent | CompiledSubAgent | AsyncSubAgent
  responseFormat?: SupportedResponseFormat,     // ToolStrategy | ProviderStrategy | ...
  contextSchema?: InteropZodObject,
  checkpointer?: BaseCheckpointSaver,
  store?: BaseStore,
  backend?: AnyBackendProtocol | ((config) => AnyBackendProtocol),
  interruptOn?: Record<string, boolean | InterruptOnConfig>,
  name?: string,
  memory?: string[],
  skills?: string[],
  permissions?: FilesystemPermission[],
}
```

The TS surface is intentionally **near-identical** to Python (camelCase modulo). Built-in tool name set is shared via `BUILTIN_TOOL_NAMES = { ...FILESYSTEM_TOOL_NAMES, ...ASYNC_TASK_TOOL_NAMES, "task", "write_todos" }` and a `ConfigurationError("TOOL_NAME_COLLISION")` is raised if user tools collide.

### 3.3 Sub-agent registration

Sub-agents are declared as **plain dicts / TypedDicts**, not classes — important because that means they're easy to serialize and easy to generate (e.g., from a config file).

```python
research_subagent: SubAgent = {
    "name": "research-agent",                   # required
    "description": "Used to research more in depth questions",  # required
    "system_prompt": "You are a great researcher",              # required
    "tools": [internet_search],                  # optional, inherits parent if missing
    "model": "openai:gpt-4o",                    # optional override
    # also optional: middleware, interrupt_on, skills, permissions, response_format
}
agent = create_deep_agent(subagents=[research_subagent])
```

### 3.4 Tool registration

User tools are passed as `tools=[...]` and **merged with built-ins**: `write_todos`, `ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`, `execute`, `task`. There is a name-collision guard (TS) and tool description override mechanism (`_apply_tool_description_overrides`) so harness profiles can patch tool prompts per model.

### 3.5 Failure semantics

- **Wrong model**: warning and resolution via `init_chat_model`. The framework specifically requires "a LLM that supports tool calling."
- **Tool execution error**: tools return string error content; `PatchToolCallsMiddleware` "[provides] automatic message history fixes when tool calls are interrupted" so a partial tool sequence doesn't poison the next invocation.
- **`StateBackend` outside graph context**: explicit `RuntimeError("StateBackend must be used inside a LangGraph graph execution …")`.
- **Excluded required middleware**: `_apply_excluded_middleware` raises `ValueError` rather than returning a silently degraded agent.
- **Sub-agent without checkpointer using `interrupt_on`**: documented requirement — checkpointer mandatory for HITL.

## 4. Data Model

### 4.1 LangGraph state schema

A Deep Agent's state is composed from `AgentState` (LangChain's base — gives you `messages`) plus the additional channels each middleware contributes:

```
DeepAgentState (effective, after middleware composition):
{
  messages:            list[AnyMessage]                # base (with reducer = add_messages)
  todos:               list[Todo]                      # TodoListMiddleware
  files:               dict[str, FileData]             # FilesystemMiddleware (StateBackend)
  skills_metadata:     ...                             # SkillsMiddleware (private)
  memory_contents:     ...                             # MemoryMiddleware (private)
  structured_response: T | None                        # when response_format is set
}
```

`FileData` (verbatim from `backends/protocol.py`):

```python
class FileData(TypedDict):
    content: str          # plain string (utf-8 text or base64 binary)
    encoding: str         # "utf-8" | "base64"
    created_at: NotRequired[str]    # ISO 8601
    modified_at: NotRequired[str]
```

`FilesystemState` (verbatim):

```python
class FilesystemState(AgentState):
    files: Annotated[NotRequired[dict[str, FileData]], _file_data_reducer]
```

The `_file_data_reducer` deserves attention — it is the merge function LangGraph uses for the `files` channel. Verbatim:

> "This reducer enables file deletion by treating `None` values in the right dictionary as deletion markers. … Files with `None` values are treated as deletion markers and removed from the result."

### 4.2 TodoList state

A simple list of todo dicts (`{ content, status, activeForm? }`-shaped objects, same idea as Claude Code's TodoWrite). The contents are non-load-bearing — what matters is that the model writes to and reads from this slot to keep itself on track.

### 4.3 Persistence backend

State persistence is **LangGraph checkpointer**, not Deep Agents' invention:

- `MemorySaver` — in-process, default for testing.
- `SqliteSaver` — local file (LangGraph standard).
- `PostgresSaver` — production-grade, persistent across restarts.
- Custom — implement `BaseCheckpointSaver`.

Snapshot is per-`thread_id`. Cross-thread persistence (long-term memory across conversations) is via the `store` parameter (`BaseStore` — typically a `LangSmithStore` or custom).

### 4.4 Filesystem backends

A separate axis from checkpointer — controls where *files* live:

| Backend | Storage | Lifetime |
|---|---|---|
| `StateBackend` (default) | LangGraph `files` channel | Within thread; checkpointed alongside everything else |
| `FilesystemBackend` | Real local disk | Persistent on disk, outside graph state |
| `LangSmithStore` | LangSmith / `BaseStore` | Cross-thread, durable |
| `SandboxBackend` (e.g. Modal, Daytona, Deno, Runloop) | Remote sandbox FS | Per-sandbox lifetime |
| `LocalShell` | Local shell with `execute` | Local process |
| `CompositeBackend` | Routes by path prefix to multiple backends | Composed |

### 4.5 Multi-tenancy

Per the **Deep Agents vs Claude Agent SDK comparison page** (verbatim):

> Deep Agents includes "scoped threads, per-user sandboxes, RBAC" built-in, while Claude Agent SDK requires developers to "build an API wrapper that spins up a sandbox per user."

These features are part of **Deep Agents Deploy** (the LangSmith Deployment server bundling Deep Agents), not part of the open-source SDK. The OSS SDK gives you `thread_id` (LangGraph) and the `permissions` parameter (FilesystemPermission rules) — the surrounding tenant-isolation infrastructure is layered above.

## 5. Execution Flow

```
   Caller             Compiled LangGraph         Middleware Stack          Sub-agent (lazy)
     │                       │                        │                       │
     │ .invoke({messages})   │                        │                       │
     ├──────────────────────►│                        │                       │
     │                       │ Checkpointer.get(thread_id) → resume from latest snapshot
     │                       │                        │                       │
     │                       │                        │                       │
     │                       │ ── before_agent ────► [TodoList, Filesystem,   │
     │                       │                        SubAgent, Summarization,│
     │                       │                        PatchToolCalls, …]      │
     │                       │                        │                       │
     │                       │                        │ inject system prompt  │
     │                       │                        │ inject tools          │
     │                       │                        │ register state keys   │
     │                       │                        │                       │
     │                       │ ── before_model ────► (compaction, caching)   │
     │                       │ ── wrap_model_call ──► call LLM                │
     │                       │ ◄─── tool_calls ────── │                       │
     │                       │                        │                       │
     │                       │ ── wrap_tool_call ───► dispatch tool           │
     │                       │   • write_todos ──► update todos channel       │
     │                       │   • write_file ───► backend.write_file()       │
     │                       │   • execute    ───► sandbox.execute()          │
     │                       │   • task       ───► spawn sub-agent ──────────►│ create_agent() compile + run
     │                       │                                        ◄──────│ final message extraction
     │                       │                        │                       │
     │                       │ Checkpointer.put → snapshot after super-step  │
     │                       │                        │                       │
     │                       │ loop until no more tool calls                  │
     │ ◄──── result ─────────│                        │                       │
                                                                              
   ── crash / disconnect ──                                                   
                                                                              
   New process, same thread_id:                                               
     │ .invoke({messages: [...]}, {"configurable": {"thread_id": same}})      │
     │                       │ Checkpointer.get → restored state              │
     │                       │ replay from last super-step                    │
```

**Key properties** (from LangGraph durable-execution docs, verbatim):

- "Workflows replay all steps from the starting point until reaching the halting point."
- "Tasks: Non-deterministic and side-effect operations must be wrapped inside tasks to prevent re-execution upon resumption. Results are retrieved from the persistence layer."
- "Workflows must be deterministic and idempotent."
- Three durability modes: `"exit"` (only at completion/error/interrupt), `"async"` (async writes), `"sync"` (synchronous before each step).

The planning loop is **not a special construct** — it is the standard tool-calling agent loop (`create_agent`'s ReAct-style loop) that happens to have `write_todos` and `task` available alongside file tools. The "depth" comes from the model deciding to:

1. Call `write_todos` to record a plan.
2. Use `write_file` to dump intermediate notes / context summaries.
3. Call `task` with a `subagent_type` to delegate isolated work.
4. Call `read_file` to recover earlier state.
5. Call `write_todos` again to update progress.

The system prompt explicitly teaches the model this pattern.

## 6. Sub-agent Architecture

### 6.1 Declaration

Sub-agents are dicts. The full TypedDict (verbatim from `subagents.py`):

```python
class SubAgent(TypedDict):
    name: str                                                # required
    description: str                                         # required
    system_prompt: str                                       # required
    tools: NotRequired[Sequence[BaseTool | Callable | dict[str, Any]]]
    model: NotRequired[str | BaseChatModel]
    middleware: NotRequired[list[AgentMiddleware]]
    interrupt_on: NotRequired[dict[str, bool | InterruptOnConfig]]
    skills: NotRequired[list[str]]
    permissions: NotRequired[list[FilesystemPermission]]
    response_format: NotRequired[ResponseFormat[Any] | type | dict[str, Any]]
```

There is also a `CompiledSubAgent` shape — `{ name, description, runnable }` — which lets you bring your own pre-compiled LangGraph runnable as a sub-agent.

### 6.2 Context isolation

The `task` tool description explicitly states (verbatim):

> "Each agent invocation is **stateless**. You will not be able to send additional messages to the agent, nor will the agent be able to communicate with you outside of its final report. Therefore, your prompt should contain a highly detailed task description for the agent to perform autonomously and you should specify exactly what information the agent should return back to you in its final and only message to you."

What "isolated context window" means concretely:

- The sub-agent gets a **fresh `messages` array** seeded only with the description from the `task` call.
- Excluded keys (verbatim from source): `_EXCLUDED_STATE_KEYS = {"messages", "todos", "structured_response", "skills_metadata", "memory_contents"}`. These are stripped from the parent state before passing it to the sub-agent.
- The **`files` channel is shared** — sub-agent reads/writes go through the same backend as the parent. This is how the sub-agent communicates "rich" results back: write to a file, return a short message saying "results in `/notes/research.md`."
- When the sub-agent finishes: "the final message in the 'messages' list will be extracted and returned as a `ToolMessage` to the parent agent."

### 6.3 Tool restrictions per sub-agent

`tools` field on SubAgent overrides the parent's tool set entirely (rather than appending). If omitted, "inherits tools from the main agent via `default_tools`." Likewise `permissions` (FilesystemPermission rules): if provided, **replaces** parent's; if omitted, inherits.

### 6.4 Communication

Two channels:

1. **Final message** — the `ToolMessage` returned to the parent. Constrained: short, summary-only.
2. **Virtual filesystem** — both parent and child write to `files`. This is the "shared workspace" mentioned in the blog: "It also acts as a shared workspace for all agents (and sub agents) to collaborate on."

There is no message-passing API between parent and running child — sub-agents are blocking, fire-and-forget within the parent's tool call.

### 6.5 Recursion

Sub-agents are themselves built via `create_agent()` with the same default middleware stack — meaning a sub-agent **also has the `task` tool** unless the spec strips it via `tools=[...]`. So sub-agents calling sub-agents is supported by construction. There's no public stated depth limit.

### 6.6 Async sub-agents

`AsyncSubAgent` and `AsyncSubAgentMiddleware` allow non-blocking sub-agent launch — the parent can spawn a sub-agent and continue while it runs. This is part of the customization surface but not the default.

## 7. Virtual Filesystem

### 7.1 What it is

The virtual filesystem is **a backend interface** plus **a fixed set of file tools** — not a fixed implementation.

Default backend: `StateBackend`, which stores `dict[str, FileData]` in the LangGraph `files` state channel. From `backends/state.py` (verbatim):

> "Backend that stores files in agent state (ephemeral). Uses LangGraph's state management and checkpointing. Files persist within a conversation thread but not across threads. State is automatically checkpointed after each agent step."

### 7.2 Tools

| Tool | Backend method | Notes |
|---|---|---|
| `ls` | `backend.ls(path)` | Lists `FileInfo` entries. Permission-checked. |
| `read_file` | `backend.read_file(path, offset, limit)` | Pagination with `offset`/`limit` lines. |
| `write_file` | `backend.write_file(path, content)` | Creates new file. |
| `edit_file` | `backend.edit_file(path, old, new, replace_all)` | String-based replacement edit. |
| `glob` | `backend.glob(pattern)` | wcmatch-based, supports `**` and `{a,b}`. |
| `grep` | `backend.grep(pattern, path?)` | Content search across files. |
| `execute` | `backend.execute(cmd)` (sandbox only) | Only when backend implements `SandboxBackendProtocol`. |

### 7.3 Permissions

`FilesystemPermission` is a dataclass (verbatim):

```python
@dataclass
class FilesystemPermission:
    operations: list[FilesystemOperation]   # Literal["read", "write"]
    paths: list[str]                        # absolute, no "..", no "~"
    mode: Literal["allow", "deny"] = "allow"
```

Rules are evaluated in declaration order — first match wins. `FilesystemMiddleware` enforces them on every file tool call. Pattern-matched via `wcmatch` glob.

### 7.4 Persistence semantics

The persistence boundary depends on the backend chosen:

- `StateBackend` — files are part of the LangGraph state and travel with the checkpoint. Resuming a thread restores all files. Stripping the thread loses the files.
- `FilesystemBackend` — files are on real disk, outside graph state. Resuming a thread sees the disk as it currently is (which may have changed). True persistent FS.
- `LangSmithStore` — keyed in `BaseStore`, cross-thread.
- `SandboxBackend` — files live in the sandbox container; lifetime tied to sandbox.
- `CompositeBackend` — routes by path prefix; e.g., `/state/*` → `StateBackend`, `/disk/*` → `FilesystemBackend`.

### 7.5 Comparison to "git-as-state-handoff" (Anthropic)

Anthropic's harness-design pattern — observed in Claude Code — uses **git** as the durable handoff: each session leaves a git commit; the next session reads recent commits + `claude-progress.txt` to recover.

Deep Agents' equivalent is the **`files` channel inside LangGraph state** plus the LangGraph checkpoint. There is no built-in git wrapping; if you want git-as-handoff, you add it as a tool. The default model is closer to "files travel with the conversation" rather than "files are committed to a long-lived repository."

This matters for failure recovery: a Deep Agent on the default backend can be interrupted and resumed cleanly because LangGraph re-hydrates `files` from the checkpoint. With the `FilesystemBackend`, you opt into "files are out-of-band on disk" — recovery is up to you.

## 8. Planning Tool / TodoList

### 8.1 Operationally

`write_todos` is a tool that takes a list of todos and writes them to `state["todos"]`. From the original blog post (verbatim):

> "Funnily enough — this doesn't do anything! It's basically a no-op. … It's just context engineering strategy to keep the agent on track."

### 8.2 Why it's load-bearing

Three reasons emerge from the source:

1. **Forces outline-before-detail.** When the system prompt instructs the model to maintain a todo list, the model emits a structured plan before doing work. This raises the chance the work covers all sub-tasks.
2. **Re-grounds context.** The todos are visible to the model on every turn (they live in graph state and are surfaced via the system prompt). Long horizon agents drift; the todo list pulls them back.
3. **Survives summarisation.** The `SummarizationMiddleware` may compact the message history, but `todos` is a separate state channel, so plan structure isn't lost when prose history is.

### 8.3 Why it's a no-op

It does not hook into any scheduler, executor, or external system. The model is the planner, the writer, and the reader — the tool just gives it a place to put intermediate plans that won't be summarised away.

## 9. LangGraph Foundation

Deep Agents inherits, *unchanged*, from LangGraph:

| Capability | LangGraph primitive | How Deep Agents uses it |
|---|---|---|
| **Durable execution** | `Checkpointer` (`MemorySaver`, `SqliteSaver`, `PostgresSaver`) | `checkpointer=…` argument forwards directly. |
| **Threads** | `{"configurable": {"thread_id": ...}}` | Each conversation = one thread. Multi-tenancy at this layer. |
| **Interrupts** | `interrupt(...)` function + `Command` to resume | `interrupt_on={"tool_name": True}` wires `HumanInTheLoopMiddleware` onto specific tools. |
| **State management** | Channels with reducers (e.g., `add_messages`, `_file_data_reducer`) | All Deep Agents state (todos, files, skills) is just channels + reducers. |
| **Streaming** | `.stream()`, `.astream()`, event types | `createDeepAgent` returns a graph; streaming works untouched. |
| **Studio / observability** | LangGraph Studio + LangSmith | First-class — README explicitly recommends LangSmith. |
| **Cross-thread store** | `BaseStore` interface | `store=…` argument forwards directly. |

What Deep Agents adds **on top of** LangGraph:

1. **A curated default middleware stack.** LangGraph alone gives you a graph builder; you have to wire middleware yourself. Deep Agents picks 5–7 middlewares and orders them.
2. **Built-in tools tied to that stack.** `write_todos`, file tools, `task`, `execute` — these live inside their respective middlewares.
3. **A long, opinionated system prompt** that teaches the model to use those tools (the `BASE_AGENT_PROMPT`, ~80 lines).
4. **A pluggable backend protocol** (`BackendProtocol` / `SandboxBackendProtocol`) for files and shell.
5. **Sub-agent declaration sugar** — the `SubAgent` TypedDict + `task` tool wiring.
6. **Harness profiles** — per-model tuning bundles.
7. **Anthropic-specific cache breakpoint middleware** (`AnthropicPromptCachingMiddleware`).
8. **Patch-tool-calls middleware** that fixes message history when tool calls are interrupted.

Crucially: **none of these require new LangGraph runtime features**. Deep Agents is a configuration layer.

## 10. Long-running / Durable Behavior

### 10.1 Resume semantics

Per the LangGraph durable-execution docs (verbatim):

> "It will NOT resume from the same line of code where execution stopped; instead, it will identify an appropriate starting point. … Workflows replay all steps from the starting point until reaching the halting point."

Concretely: a Deep Agent crashes mid-tool-call → next process invokes with the same `thread_id` → checkpointer restores state → graph replays from the last super-step boundary. Side-effecting tool calls must be wrapped in LangGraph `tasks` (or be idempotent) to avoid double-execution. (Deep Agents doesn't currently auto-wrap tool calls in `tasks`; idempotence is the user's responsibility.)

### 10.2 Snapshot / rehydrate

The "snapshot" is the LangGraph checkpoint. It contains all channels: `messages`, `todos`, `files`, `skills_metadata`, etc. Rehydration is automatic when you invoke with the same `thread_id`.

### 10.3 Cross-process resume

Supported as long as:

1. Both processes use a checkpointer pointing at the same persistent storage (Sqlite, Postgres, etc.).
2. The same `thread_id` is supplied.
3. The same compiled graph (or a compatible one) is used.

This is the core durability story. It is **LangGraph's** durability story; Deep Agents inherits it transparently.

### 10.4 HITL across processes

`interrupt_on` + checkpointer means an interrupt during tool approval suspends the graph. A different process (or the same one minutes later) calls `.invoke(Command(resume=...))` to continue. The approval state is part of the checkpoint.

## 11. Comparison to Other Architectures

Drawn from (a) the towardsai comparison article, (b) the official Deep Agents vs Claude Agent SDK comparison page, and (c) primary-source reading of all three frameworks.

### 11.1 By axis

| Axis | Anthropic Managed Agents (Claude Agent SDK) | LangChain Deep Agents | OpenAI Agents SDK + Codex |
|---|---|---|---|
| **State plane** | Append-only event log (`Session`), durable, queryable; harness is stateless. | LangGraph state channels + checkpointer; thread-scoped; replayable. | `RunState` + `Session` (`SQLiteSession`/`OpenAIConversationsSession`); externalised, snapshot-able. |
| **Filesystem** | Sandbox-local FS; "Local filesystem of the sandbox it runs in." | Pluggable: `StateBackend` (in-state), `FilesystemBackend` (disk), `LangSmithStore`, `SandboxBackend`, `CompositeBackend`. | Sandbox FS through Manifest; `apply_patch` is the model-native edit primitive. |
| **Sandbox semantics** | Lazy `provision({resources})` → handle. Sandboxes are "cattle." Sandbox technology pluggable: bubblewrap, Docker, gVisor, Firecracker, Modal, Daytona, E2B, Fly Machines, etc. | Optional. Default backend is *no sandbox* (state-only). When attached, `SandboxBackendProtocol` (Modal, Daytona, Runloop, Deno, LangSmith Sandboxes). | First-class. 8 named providers (Blaxel, Cloudflare, Daytona, Docker, E2B, Modal, Runloop, Unix-local, Vercel) + BYO. Sandbox is the default execution surface. |
| **Sub-agent model** | `parent_tool_use_id` linking, `SubagentStart`/`SubagentStop` SDK events, `AgentInput { subagent_type, model, max_turns, isolation: "worktree", ... }`. | `SubAgent` TypedDict + `task` tool. Fresh LangGraph compile per invocation. Files channel shared, messages isolated. | `Handoff` class + `handoff()` factory. Models a sub-agent as a special tool call returning a new `Agent`. |
| **Tool composability** | `execute(name, input) → string` uniform verb. MCP first-class. Credentials via vault/proxy outside agent. | LangChain `BaseTool` + `tool()` decorator + MCP via `langchain-mcp-adapters`. Tools = LangChain tools. | Three layers: hosted tools (`webSearchTool`, `applyPatchTool`, etc.), function tools (`tool()`), MCP (`MCPServerStdio`/SSE/StreamableHttp). |
| **Multi-tenancy** | Session ID is the key. Per-session credentials, per-session sandboxes. Operator concern at platform layer. | OSS: `thread_id` (LangGraph). Production: Deep Agents Deploy adds "scoped threads, per-user sandboxes, RBAC" — *not* in OSS. | `RunConfig` + `Manifest` per session. Sandbox provider handles per-user isolation. |
| **Durability** | `wake(sessionId)` rebuilds context from event log. "Newly stateless: the loop no longer lives inside the same container as the tools." | LangGraph checkpointer + replay. "Workflows must be deterministic and idempotent." | `RunState` snapshot/rehydrate; sandbox state checkpoint+rehydrate. Three explicit state surfaces (`RunState`, `session_state`, `snapshot`). |
| **Customization model** | Hooks (`HookStartedMessage`, etc.), permission callbacks, MCP servers. Stateless harness. | LangChain `AgentMiddleware` stack with deterministic ordering. Required-middleware guarantee. | `Capability` modules (`Filesystem`, `Shell`, `Skills`, `Memory`, `Compaction`); `Guardrail` (4 types); `Tracing` (25+ processors). |
| **Coupling to provider** | Tightly coupled to Anthropic Claude. | Provider-agnostic ("any LLM with tool calling"). Model resolved via `init_chat_model`. | Provider-agnostic at SDK layer (LiteLLM bridge), but the *Codex* system prompt + Skills + apply_patch are tuned for OpenAI. |
| **Deployment narrative** | Walled garden: managed cloud, OAuth-scoped tokens, MCP proxy. | Open: OSS SDK runs anywhere; Deep Agents Deploy adds production server (LangSmith Deployment) with 30+ endpoints (MCP, A2A, HITL, Memory, Agent Protocol). | Codex Web (chatgpt.com/codex) on OpenAI cloud + Codex CLI for local. Same primitives, two delivery surfaces. |

### 11.2 The towardsai framing

The comparison article (Hightower, Apr 2026) frames the choice as *"the layer that runs the loop between reasoning and execution: sandboxing, tool routing, state, credentials, and multi-agent delegation."* It positions Deep Agents as the **open, provider-agnostic option** in contrast to Claude Managed Agents (described as "a walled garden that creates an incredible amount of lock in") and OpenAI's Codex stack (described as more model-coupled).

The article's core observation is that all three converged on essentially the same shape — **stateless reasoning + stateful workspace + uniform tool dispatch + durable session** — but along different axes:

- Anthropic stratified by trust (brain/hands/session/proxy).
- LangChain stratified by reusability (middleware + backend protocols).
- OpenAI stratified by file-edit centricity (Manifest + apply_patch).

### 11.3 Where Deep Agents diverges meaningfully

- **From Anthropic:** Anthropic's harness is stateless and event-sourced; Deep Agents' harness is stateful within a thread (LangGraph state) and replays via checkpoint, not by re-reading an event log. Anthropic's `execute()` is the uniform tool verb; Deep Agents has multiple tool surfaces (LangChain BaseTool, MCP, file tools, sub-agent task tool). Anthropic decouples credentials via MCP proxy + vault; Deep Agents leaves credential management to the user / deployment layer.
- **From OpenAI:** OpenAI elevates `apply_patch` to a first-class model primitive; Deep Agents has `edit_file` as a normal tool. OpenAI ships a declarative `Manifest` for workspace setup; Deep Agents has no Manifest equivalent — workspace is whatever the backend produces. OpenAI's Skills/Memory are baked into the harness as Capabilities; Deep Agents bolts them on as middleware.

### 11.4 Where Deep Agents converges

- **All three** decouple harness from sandbox (eventually).
- **All three** make sub-agent invocation a tool call (`task` / `Handoff` / Anthropic's `subagent_type`).
- **All three** keep credentials out of the model's reach (sandbox-bundled or proxy-mediated).
- **All three** allow swapping models — though OpenAI/Anthropic have stronger primary-vendor lock-in than LangChain.

## 12. Architectural Diagrams

### 12.1 High-level component view

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         create_deep_agent(...)                            │
│                                                                            │
│  returns CompiledStateGraph (LangGraph)                                   │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  Agent loop (LangGraph nodes)                                       │  │
│  │     before_agent → before_model → wrap_model_call → tool_dispatch  │  │
│  │                                                                      │  │
│  │  Middleware stack (deterministic order):                            │  │
│  │     TodoListMiddleware         (write_todos, todos channel)         │  │
│  │     SkillsMiddleware (opt)     (skill loading)                      │  │
│  │     FilesystemMiddleware *     (file tools, files channel)          │  │
│  │     SubAgentMiddleware *       (task tool, sub-agent compile/run)   │  │
│  │     SummarizationMiddleware    (history compaction)                 │  │
│  │     PatchToolCallsMiddleware   (recover from broken tool sequences) │  │
│  │     AsyncSubAgentMiddleware (opt)                                   │  │
│  │     ── user middleware inserted here ──                             │  │
│  │     HarnessProfile.extra_middleware (opt)                           │  │
│  │     _ToolExclusionMiddleware (opt)                                  │  │
│  │     AnthropicPromptCachingMiddleware                                │  │
│  │     MemoryMiddleware (opt)                                          │  │
│  │     HumanInTheLoopMiddleware (when interrupt_on used)               │  │
│  │  * = required, cannot be excluded                                   │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  State channels:                                                           │
│    messages, todos, files, skills_metadata, memory_contents,              │
│    structured_response                                                     │
└──────────────────────────────────────────────────────────────────────────┘
        │                            │                          │
        ▼                            ▼                          ▼
   Checkpointer                 Backend                      Store
   (LangGraph)                  (BackendProtocol)            (BaseStore)
   ─ MemorySaver               ─ StateBackend                ─ LangSmithStore
   ─ SqliteSaver               ─ FilesystemBackend           ─ Custom
   ─ PostgresSaver             ─ LangSmithStore              (cross-thread)
   ─ Custom                    ─ SandboxBackend
                                  (Modal/Daytona/Runloop/
                                   Deno)
                               ─ CompositeBackend
                               ─ LocalShell
```

### 12.2 Virtual filesystem flow

```
   write_file("/notes/a.md", "...")          read_file("/notes/a.md")
            │                                          │
            ▼                                          ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │                    FilesystemMiddleware                          │
   │   ┌─ permission check (FilesystemPermission rules) ──────────┐ │
   │   └─ dispatch to backend ───────────────────────────────────┘ │
   └─────────────────────────────────────────────────────────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
      StateBackend       FilesystemBackend    SandboxBackend
              │                 │                 │
              ▼                 ▼                 ▼
       LangGraph             local             remote
       `files` channel       disk              container
       (checkpointed         (no replay        (Modal /
        per super-step)       guarantee)        Daytona /
                                                Deno /
                                                Runloop)

       OR via CompositeBackend (path-prefix routing):
       /state/*  → StateBackend
       /tmp/*    → FilesystemBackend
       /sandbox/* → SandboxBackend
```

### 12.3 Sub-agent isolation

```
       Parent Deep Agent (thread_id = T)
       ┌───────────────────────────────────────────────────┐
       │  state = { messages, todos, files, ... }          │
       │  Model calls: task({                              │
       │     description: "research X in detail",          │
       │     subagent_type: "research-agent"               │
       │  })                                                │
       └───────────────────────────────────────────────────┘
                              │
                              ▼  task tool handler (SubAgentMiddleware)
       ┌───────────────────────────────────────────────────┐
       │  1. Look up SubAgent by name                       │
       │  2. Strip _EXCLUDED_STATE_KEYS from parent state:  │
       │     {messages, todos, structured_response,         │
       │      skills_metadata, memory_contents}             │
       │  3. Pass { files: parent.files } + new messages   │
       │  4. create_agent(subagent_spec).invoke(...)       │
       └───────────────────────────────────────────────────┘
                              │
                              ▼
       Sub-agent (transient compile)
       ┌───────────────────────────────────────────────────┐
       │  fresh messages = [HumanMessage(description)]     │
       │  shared files (read/write through same backend)   │
       │  own todos (not visible to parent)                 │
       │  own model (or inherited)                          │
       │  own tools (or inherited)                          │
       │  own permissions (or inherited)                    │
       │  runs to completion                                │
       └───────────────────────────────────────────────────┘
                              │
                              ▼
       Final message extracted → ToolMessage → returned to parent
       (rich results communicated via shared `files`)
```

## 13. What's Public vs What's Inferred

| Claim | Status |
|---|---|
| Deep Agents = "an agent harness, batteries-included" | **[PUBLIC]** README, blog |
| Returns a `CompiledStateGraph` from LangGraph | **[PUBLIC]** README, source |
| Built on LangGraph; checkpointer/durable execution inherited | **[PUBLIC]** README, durable-execution docs |
| `create_deep_agent` parameter list | **[PUBLIC]** Source verified |
| `SubAgent` TypedDict shape | **[PUBLIC]** Source verified (`subagents.py`) |
| `FileData` TypedDict shape | **[PUBLIC]** Source verified (`backends/protocol.py`) |
| `_file_data_reducer` enables file deletion via `None` | **[PUBLIC]** Source verified |
| TodoList tool is a no-op | **[PUBLIC]** Direct quote from blog |
| Sub-agent invocation is stateless / one-shot | **[PUBLIC]** Direct quote from `TASK_TOOL_DESCRIPTION` |
| `_EXCLUDED_STATE_KEYS = {messages, todos, structured_response, skills_metadata, memory_contents}` | **[PUBLIC]** Source verified |
| `files` channel shared between parent and sub-agent | **[PUBLIC]** Inferred from `StateBackend` semantics + blog "shared workspace" claim. Not directly contradicted anywhere. Confirmed by absence of `files` from `_EXCLUDED_STATE_KEYS`. |
| Backend protocols: `BackendProtocol`, `SandboxBackendProtocol` | **[PUBLIC]** Source verified |
| Multi-tenancy via "scoped threads, per-user sandboxes, RBAC" | **[PUBLIC]** Comparison page; **[INFERRED]** that this is part of Deep Agents Deploy, not OSS — based on "comparison page" framing + Deep Agents Deploy blog. |
| Required middleware: `FilesystemMiddleware`, `SubAgentMiddleware` | **[PUBLIC]** Source verified (`_REQUIRED_MIDDLEWARE`) |
| HarnessProfile (per-model tuning) | **[PUBLIC]** Comparison page; **[INFERRED]** schema/usage shape from source imports |
| BASE_AGENT_PROMPT is ~80 lines | **[PUBLIC]** Source verified |
| Three durability modes (`exit`, `async`, `sync`) | **[PUBLIC]** LangGraph durable-execution docs |
| Sub-agents calling sub-agents supported by construction | **[INFERRED]** Sub-agents get the same default middleware stack including `SubAgentMiddleware`; not explicitly forbidden. No depth limit documented. |
| Deep Agents Deploy = LangSmith Deployment server | **[PUBLIC]** Deep Agents Deploy blog |
| Deep Agents Deploy adds 30+ endpoints, MCP/A2A/HITL/Memory/Agent Protocol | **[PUBLIC]** Deep Agents Deploy blog |
| Tool name collision raises `ConfigurationError("TOOL_NAME_COLLISION")` | **[PUBLIC]** Source verified (TS) |
| Comparison framing in towardsai article | **[PUBLIC]** towardsai article + search snippets |
| Specific quotes attributed to towardsai article body | **[INFERRED / PARTIAL]** — full article body was not retrievable due to Medium auth-wall + cert error; framing relies on article abstract + search summaries + cross-reference with author's other published work. |

## 14. Implications for agent-express Design

### 14.1 Ideas to anchor on

- **Pluggable filesystem backend.** This is a clean abstraction with a concrete payoff: one agent definition → `StateBackend` for tests, `SandboxBackend` for prod, `LangSmithStore` for cross-thread memory. The `BackendProtocol` is exactly the right shape — narrow, tool-friendly, swappable. agent-express already has `SessionStore` as a similar shape; an analogous `FilesystemBackend` (or extension to existing `search.file()` / `tools.function()`) would let agents ship with virtual FS without committing to one storage.
- **Planning tool as middleware (`memory.plan()`).** The "no-op planning tool" insight is genuinely useful: a `write_todos`-style tool whose only effect is to write to a state slot the model re-reads. Cheap to build, demonstrably effective for long-horizon work. Fits agent-express's middleware namespace cleanly: `memory.plan()` returning a `write_todos` tool plus state binding.
- **Sub-agent declaration as data, not classes.** `SubAgent` TypedDict is the right ergonomic — easy to serialise, easy to generate, easy to test. Worth mirroring as a TypeScript type and a `subagents` parameter on `Agent`/`Session` rather than a class hierarchy.
- **Shared workspace via state.** The "files channel is shared, messages are isolated" pattern is a cleaner way to do sub-agent communication than message passing. Worth considering as the recommended pattern: parent and child read/write a shared store; child returns a short summary.
- **Required middleware concept.** The "you cannot exclude `FilesystemMiddleware` and `SubAgentMiddleware`" guarantee is a small but important design touch — it prevents silently broken agents. agent-express's `defaults: false` opt-out should consider making certain middlewares non-removable when their tools are referenced.
- **Per-model tuning via profiles.** `HarnessProfile` lets users register model-specific prompt/middleware overrides. Worth considering for `model.router()` extensions.

### 14.2 Conflicts with current direction

- **agent-express is provider-flat.** Deep Agents leans heavily on LangChain's model abstraction (`init_chat_model` + provider-prefixed strings); agent-express uses `@ai-sdk/provider` V3. Translating Deep Agents idioms requires keeping the provider boundary clean — fine, but means we can't directly import LangChain middleware.
- **Deep Agents' "compile" model vs agent-express's runtime composition.** Deep Agents builds a graph at construction time and you `.invoke()` it. agent-express has runtime middleware composition with onion hooks. The two models can interop but require different mental shapes for HITL: Deep Agents uses `interrupt`/`Command`; agent-express uses `guard.approve()`. Not worth changing.
- **Single-graph vs multi-process.** Deep Agents Deploy is a server; agent-express is a library. The "multi-tenancy = scoped threads + per-user sandboxes + RBAC" feature set lives in Deep Agents Deploy, not in the SDK. agent-express v0.5 (Go server) needs an explicit story here: do we provide a similar deployment artefact, or do we expect users to wire it themselves?
- **"Middleware" naming collision.** LangChain middleware (`AgentMiddleware` with `before_model`/`wrap_tool_call`/etc.) and agent-express middleware (`Middleware` with the 5-hook interface) share a name and a concept but are not source-compatible. We should keep our shape but be aware that users coming from Deep Agents will expect `before_model`-style hooks; our naming should clearly map.

### 14.3 Whether to adopt Deep Agents primitives directly

| Primitive | Adopt? | How |
|---|---|---|
| Planning tool (`write_todos`-style) | **Yes** | Add `memory.plan()` middleware. Tool writes to `state['memory:plan']`. State surfaces in system prompt. |
| Virtual filesystem with backend protocol | **Yes** | Either extend `tools.function()` with a "files" tool factory or add `tools.fs(backend)` middleware. Backends: in-memory (default), `SessionStore`-backed, sandbox-backed. |
| Sub-agent as TypedDict + `task` tool | **Yes** | Add `Subagent` type + `agent.use(memory.subagent(spec))` or similar. Sub-agent runs as a child `Agent` with shared session state. |
| Required-middleware guarantee | **Yes** | Lightweight. Mark middleware as `required: true`; throw on opt-out if referenced. |
| HarnessProfile (per-model bundle) | **Maybe** | Already partially covered by `model.router()`. Could extend to bundle prompt/tool overrides. |
| Deep Agents Deploy server | **Defer** | This is the v0.5 Go server's territory. Mirror the *features* (HITL endpoint, memory endpoint, MCP endpoint, A2A endpoint, scoped threads) but not the implementation. |
| `apply_patch` first-class tool | **No** | OpenAI-specific. agent-express stays model-agnostic. Provide as user-supplied tool if needed. |
| `Manifest`-style declarative workspace | **Maybe defer** | Useful if/when we ship sandbox integration. Not v0.4. |

### 14.4 Net assessment

Deep Agents is closer to agent-express in spirit than the other two harnesses — both are middleware-stack frameworks with pluggable adapters and a "batteries-included" defaults story. The biggest single takeaway is **the planning tool + virtual filesystem + sub-agent triad as a *composable* unit** (each independently useful, jointly emergent). agent-express already has the middleware substrate; adding these three middlewares (`memory.plan`, `tools.fs`, `memory.subagent`) would put us at near-feature-parity with Deep Agents on the agent-loop axis, while keeping our model-provider neutrality and our 5-hook interface.

The features that *don't* translate are the LangSmith deployment server (different scope; v0.5 territory) and the LangGraph-specific durability semantics (we have our own session model). We should not try to wrap LangGraph; we should learn from its abstractions.

## 15. Source Citations

**Primary — official LangChain materials:**
- LangChain blog, "Deep Agents" — https://www.langchain.com/blog/deep-agents (orig: blog.langchain.com/deep-agents/)
- LangChain blog, "Deep Agents Deploy: an open alternative to Claude Managed Agents" — https://www.langchain.com/blog/deep-agents-deploy-an-open-alternative-to-claude-managed-agents
- LangChain product page — https://www.langchain.com/deep-agents
- Deep Agents (Python) docs overview — https://docs.langchain.com/oss/python/deepagents/
- Deep Agents Python docs, Customization — https://docs.langchain.com/oss/python/deepagents/customization
- Deep Agents Python docs, Comparison with Claude Agent SDK — https://docs.langchain.com/oss/python/deepagents/comparison
- Deep Agents (JavaScript) docs — https://docs.langchain.com/oss/javascript/deepagents/
- Python API reference — https://reference.langchain.com/python/deepagents/
- Filesystem backend reference — https://reference.langchain.com/python/deepagents/backends/filesystem
- LangGraph durable execution docs — https://docs.langchain.com/oss/python/langgraph/durable-execution

**Primary — source code:**
- langchain-ai/deepagents (Python) — https://github.com/langchain-ai/deepagents
  - `libs/deepagents/deepagents/graph.py` — `create_deep_agent`, BASE_AGENT_PROMPT, middleware ordering
  - `libs/deepagents/deepagents/middleware/subagents.py` — `SubAgent`, `CompiledSubAgent`, `TASK_TOOL_DESCRIPTION`, `_EXCLUDED_STATE_KEYS`
  - `libs/deepagents/deepagents/middleware/filesystem.py` — `FilesystemState`, `FilesystemPermission`, `_file_data_reducer`
  - `libs/deepagents/deepagents/backends/protocol.py` — `FileData`, `BackendProtocol`, `SandboxBackendProtocol`
  - `libs/deepagents/deepagents/backends/state.py` — `StateBackend`
  - `libs/deepagents/deepagents/_models.py` — model resolution
- langchain-ai/deepagentsjs (TypeScript) — https://github.com/langchain-ai/deepagentsjs
  - `libs/deepagents/src/agent.ts` — `createDeepAgent`, BASE_AGENT_PROMPT, BUILTIN_TOOL_NAMES, isAnthropicModel
  - `libs/deepagents/src/types.ts` — `CreateDeepAgentParams`, `DeepAgentTypeConfig`, `AnySubAgent`
  - `libs/deepagents/src/middleware/subagents.ts` — `SubAgent` (TS), `_EXCLUDED_STATE_KEYS`

**Secondary — third-party comparative analysis:**
- Hightower, R. "Choosing Your Agent Harness: An Architectural Comparison of Claude Managed Agents, LangChain Deep Agents, and the OpenAI Agents SDK." Towards AI, Apr 2026. — https://pub.towardsai.net/choosing-your-agent-harness-an-architectural-comparison-of-claude-managed-agents-langchain-deep-a0762804ec07
- Karhade, M. "LangChain Deep Agents: The Open-Source Claude Code Alternative That Works With Any Model." Towards AI, Mar 2026. — https://pub.towardsai.net/langchain-deep-agents-the-open-source-claude-code-alternative-that-works-with-any-model-2477aba5cb96
- Phansiri, L. "AI Agent Harness Comparison: Deep Agents or Claude Agent SDK for local models?" Medium, Mar 2026. — https://medium.com/@phansiri/ai-agent-harness-comparison-deep-agents-or-claude-agent-sdk-for-local-models-dd2dd1e3aaff
- Chawla, A. "The Anatomy of an Agent Harness." Daily Dose of DS. — https://blog.dailydoseofds.com/p/the-anatomy-of-an-agent-harness
- Flowtivity. "Why LangChain Deep Agents Might Be the Agent Framework You Actually Need." — https://flowtivity.ai/blog/langchain-deep-agents-framework-review/
- QubitTool. "2026 AI Agent Framework Showdown: Claude Agent SDK vs Strands vs LangGraph vs OpenAI Agents SDK." — https://qubittool.com/blog/ai-agent-framework-comparison-2026

**Secondary — community deepwiki references:**
- DeepWiki, Deep Agents — `create_deep_agent` — https://deepwiki.com/langchain-ai/deepagents/5.1-create_deep_agent
- DeepWiki, Deep Agents — Middleware System — https://deepwiki.com/langchain-ai/deepagents/2.2-middleware-system
- DeepWiki, Deep Agents — Custom Middleware Development — https://deepwiki.com/langchain-ai/deepagents/4.5-custom-middleware-development

**Cross-reference research docs in this repository:**
- `docs/research/anthropic-managed-agents.md` — Anthropic Brain/Hands/Session architecture
- `docs/research/openai-agents-sdk.md` — OpenAI Agents SDK + Codex architecture
