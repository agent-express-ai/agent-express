# OpenAI Agents SDK + Codex — Architectural Reference

Reverse-engineered from publicly available materials, generated 2026-04-30.
Used as design reference for agent-express v0.4 framework + v0.5 Go server.

## 1. Executive Summary

- The April 2026 evolution of OpenAI's **Agents SDK** is structurally a `harness ↔ sandbox` split. The harness is the *control plane* (model loop, credentials, memory, orchestration); the sandbox is the *compute plane* (filesystem, shell, packages, ports, tool execution). Model-generated code never runs in the harness; credentials never leave the harness. This is the same architectural move Anthropic made with Brain/Hands, arrived at independently and described in nearly identical language.
- The SDK introduces a declarative **Manifest** that describes the agent's workspace — files, mounts (S3/GCS/R2/Azure Blob), git repos, environment, users — without coupling to a compute provider. Eight sandbox backends are first-class: **Blaxel, Cloudflare, Daytona, Docker, E2B, Modal, Runloop, Unix-local, Vercel**. BYO is supported via a sandbox-client interface.
- Durability is provided through **snapshot/rehydrate**: harness state (the `RunState`) is persisted; sandbox state can be checkpointed and rehydrated into a fresh container. Three state surfaces are explicit in the docs: `RunState` (harness), `session_state` (provider-side serialized sandbox session), and `snapshot` (workspace contents).
- The harness is described as **"model-native"** and ships the same primitives that power **Codex**: `apply_patch` for file edits, a shell tool for code execution, **Skills** (progressive disclosure of capabilities), **Memory** (cross-run learning via `memory_summary.md` / `MEMORY.md`), and **AGENTS.md** for instructions. **MCP** is the canonical extension surface; Codex itself is exposed to the SDK via `codex mcp-server`.
- **Codex Web** (chatgpt.com/codex) is the productized form of the same primitives running on OpenAI-managed cloud sandboxes — 12-hour container cache, default no-network during agent phase, GitHub-integrated PR-driven workflow. **Codex CLI** is the local form, using OS sandbox primitives (Seatbelt on macOS, bubblewrap+seccomp on Linux, Windows native sandbox).

In one paragraph: OpenAI's stack is a **declarative Manifest** describing a workspace, a **pluggable sandbox** that materialises it (8 first-class providers + BYO), a **stateless model-native harness** that drives the model loop and dispatches `apply_patch`/shell/MCP tool calls into the sandbox, an **externalised RunState** that survives container loss via snapshot+rehydrate, and a set of standard files (**AGENTS.md** for instructions, **SKILL.md** for capabilities, **MEMORY.md** for cross-run state) that travel with the workspace. Codex CLI and Codex Web are two deployments of the same primitives.

## 2. Core Conceptual Model

| Primitive | OpenAI's definition (quoted where available) | Scope |
|---|---|---|
| **Agent** | "LLMs equipped with instructions and tools" (Python SDK docs); a `new Agent({ name, instructions, tools, handoffs, guardrails })` in TS | Reasoning unit. Pure config object. Not a process. |
| **Run / Runner** | `Runner.run_sync(agent, prompt)` (Py); `await run(agent, prompt)` returning `RunResult` or `StreamedRunResult` (TS) | One execution of the model→tool→model loop. Ends with a final output (or streams items). |
| **RunState** | "Harness-side state such as model items, tool state, approvals" (Sandbox Agents docs) | The control-plane state. Externalisable. Survives across containers. |
| **Session** | "A persistent memory layer for maintaining working context within an agent loop" (Py docs); SDK provides `SQLiteSession`, `OpenAIConversationsSession`, custom via `SessionABC` (`get_items`, `add_items`, `pop_item`, `clear_session`) | Conversation memory across `Run`s. Storage-pluggable. |
| **Manifest** | "describes the desired starting contents and layout for a fresh sandbox workspace, including files, repos, input artifacts, helper files, mounts, output directories, and environment setup" | Declarative workspace spec. Portable across sandbox providers. |
| **Sandbox** | "an isolated, Unix-like execution environment with a filesystem, shell, installed packages, mounted data, exposed ports, snapshots, and controlled access to external systems" | Compute plane. Provisioned per-session. |
| **Sandbox Agent** | "Run specialists inside real isolated workspaces with manifest-defined files" (Py docs) | The composition `Agent + Manifest + Capabilities → bound-to-sandbox`. |
| **Capability** | Default set is `Filesystem()`, `Shell()`, `Compaction()`. Available: `Shell`, `Filesystem`, `Skills`, `Memory`, `Compaction` | Modular harness features the agent can call into. Explicitly attached. |
| **Handoff** | `Handoff` class; `handoff()` factory; `RunHandoffCallItem`, `RunHandoffOutputItem`; "agents to delegate to other agents for specific tasks" | Multi-agent transfer. Modeled as a special tool call returning a new `Agent` to drive the loop. |
| **Guardrail** | `InputGuardrail`, `OutputGuardrail`, `ToolInputGuardrail`, `ToolOutputGuardrail`; `defineOutputGuardrail()`, `defineToolInputGuardrail()` | Validation hooks at four boundaries. |
| **Tool** | Three categories: **hosted** (`webSearchTool`, `computerTool`, `codeInterpreterTool`, `fileSearchTool`, `imageGenerationTool`, `toolSearchTool`, `applyPatchTool`), **function** (`tool()`, `toolNamespace()`), **MCP** (`MCPServerStdio`, `MCPServerSSE`, `MCPServerStreamableHttp`, `connectMcpServers`, `mcpToFunctionTool`) | Three-layer tool surface. |
| **apply_patch** | "create, update, and delete files in your codebase using structured diffs" — first-class tool, model emits patch operations using V4A diff format | First-class because file editing is the dominant action mode for coding agents; a tool-call surface that's symmetric with how Codex was trained. |
| **Shell tool** | "code execution using the shell tool" — model issues shell commands inside the sandbox | Code execution. Approval-gated by mode. |
| **Skill** | "A skill is a directory with a `SKILL.md` file plus optional scripts and references. The `SKILL.md` file must include `name` and `description`." Loaded via progressive disclosure. | Capability bundle. Lazy-loaded. |
| **AGENTS.md** | "open, simple, and tool-agnostic format for providing project-specific guidance" — read on every run, hierarchical lookup, `~/.codex/AGENTS.md` global, `AGENTS.override.md` overrides, concatenation root-down | Instruction file. Portable across coding agents (also used by Claude Code, Gemini CLI). |
| **MEMORY.md / memory_summary.md** | Memory artifacts under `workspace/memories/` — `memory_summary.md`, `MEMORY.md`, `raw_memories.md` | Cross-run learning. Read at start, regenerated at end, "progressive disclosure" pattern. |
| **Tracing** | `Trace` = end-to-end workflow operation; `Span` = timed sub-operation; auto-wraps `Runner.run`; `add_trace_processor`/`set_trace_processors`; 25+ processor integrations (W&B, Phoenix, MLflow, Braintrust, Logfire, LangSmith, Langfuse, Datadog, PostHog) | Observability primitive. On by default; per-run/global disable; pluggable backends. |

## 3. The API Surface

### TypeScript SDK — `@openai/agents`

```ts
import { Agent, run, tool, handoff, webSearchTool, applyPatchTool } from '@openai/agents';
import { MCPServerStdio } from '@openai/agents/mcp';

const agent = new Agent({
  name: 'Assistant',
  instructions: '...',
  tools: [webSearchTool(), applyPatchTool(), myFunctionTool],
  handoffs: [otherAgent],
  guardrails: { input: [...], output: [...] },
  modelSettings: { model: 'gpt-5.5', temperature: 0.2 },
});

const result = await run(agent, 'prompt');
// result: RunResult { finalOutput, runItems[], state, traceId }
```

Top-level exports observed on the docs site:

- Classes: `Agent`, `Runner`, `Handoff`, `AgentHooks`
- Functions: `run`, `tool`, `toolNamespace`, `handoff`, `getHandoff`, `withTrace`, `createAgentSpan`, `createHandoffSpan`, `withHandoffSpan`
- Hosted tool factories: `webSearchTool`, `computerTool`, `codeInterpreterTool`, `fileSearchTool`, `imageGenerationTool`, `toolSearchTool`, `applyPatchTool`
- MCP transports: `MCPServerStdio`, `MCPServerSSE`, `MCPServerStreamableHttp`; helpers `connectMcpServers`, `mcpToFunctionTool`
- Guardrail factories: `defineOutputGuardrail`, `defineToolInputGuardrail` (and presumably symmetric input/tool-output forms)
- Run items: `RunItem`, `RunHandoffCallItem`, `RunHandoffOutputItem`, `ApplyPatchCallItem`, `ApplyPatchResult`
- Sessions: `MemorySession`, `OpenAIConversationsSession`, custom via `Session` interface
- Types: `RunResult`, `StreamedRunResult`, `RunState`, `ModelSettings`, `AgentConfiguration`, `FunctionTool`, `FunctionToolResult`, `HandoffEnabledFunction`, `HandoffInputData`, `HandoffSpanData`, `ApplyPatchOperation`, `ToolOptionsWithGuardrails`, `ToolInputGuardrailDefinition`, `ToolOutputGuardrailDefinition`, `SerializedHandoff`

### Python SDK — `openai-agents`

```python
from agents import Agent, Runner
from agents.sandbox import Manifest, File, GitRepo, S3Mount, SandboxAgent
from agents.sandbox.capabilities import Shell, Filesystem, Skills, Memory, Compaction
from agents.sandbox.providers import E2BSandboxClient

manifest = Manifest(
    entries=[
        GitRepo(path='repo', url='https://github.com/...'),
        File(path='input.txt', contents='...'),
        S3Mount(path='data', bucket='...', prefix='...'),
    ],
    environment={'NODE_ENV': 'test'},
    users=[...],
)

agent = SandboxAgent(
    name='coder',
    instructions='...',
    capabilities=[Filesystem(), Shell(), Skills(), Memory(), Compaction()],
    sandbox_client=E2BSandboxClient(),
    manifest=manifest,
)

result = Runner.run_sync(agent, 'fix the failing test')
# Resume:
result = Runner.run_sync(agent, 'continue', state=result.state)
```

### Session interface (Python)

```python
class SessionABC:
    async def get_items(self, limit: int | None = None) -> list[TResponseInputItem]: ...
    async def add_items(self, items: list[TResponseInputItem]) -> None: ...
    async def pop_item(self) -> TResponseInputItem | None: ...
    async def clear_session(self) -> None: ...
```

### REST surface

The Agents SDK is built on the **Responses API** (the canonical OpenAI inference surface). Hosted tools, `apply_patch`, function calls, MCP tool proxying, structured output, and tracing all flow through Responses. Conversations API (server-side message storage) backs `OpenAIConversationsSession`. The `apply_patch` tool ships across **Responses API, Chat Completions, and Assistants APIs** (per `tools-apply-patch` guide), with `apply_patch_call` outputs and `apply_patch_call_output` event inputs.

### Resumability methods

- **Within harness**: `Runner.run(agent, prompt, state=prior.state)` — resumes from `RunState`. The state object is serializable.
- **Sandbox layer**: `session_state` — provider-serialized sandbox session token (re-attach to live container if still alive); `snapshot` — saved workspace contents (re-create from scratch); resolution order is "live session → resumed RunState → explicit session_state → fresh manifest-based creation".
- **Codex MCP**: `codex` (start) returns a `threadId`; `codex-reply(threadId, prompt)` continues. This is a thread-style resume identical in shape to the Conversations API.

### Failure semantics

- Tool errors surface as `tool_result` items with non-empty error fields; the loop continues, the model can self-correct.
- `apply_patch_call_output` carries `status: "completed" | "failed"` plus optional `output` for diagnostics.
- Sandbox container loss: the orchestrator detects, provisions a new container, restores from the last checkpoint, and continues — quote from coverage: *"as an agent progresses through a multi-step task, the SDK periodically writes checkpoints to the connected storage backend"* and *"the orchestrator detects the interruption, provisions a new container, restores the last checkpoint, and continues execution from that point."*
- Guardrail violation: typed errors propagated to caller; can short-circuit the run.

## 4. Data Model

The SDK explicitly distinguishes **three state surfaces** — this is the core data model claim:

```
┌────────────────────────────────────────────────────────────────────┐
│ RunState  (HARNESS, control plane)                                 │
│   - model items (messages, tool calls, tool results)               │
│   - tool state                                                     │
│   - pending approvals                                              │
│   - guardrail state                                                │
│   - serializable; survives container death                         │
├────────────────────────────────────────────────────────────────────┤
│ session_state  (PROVIDER-SIDE, live attachment)                    │
│   - opaque sandbox-provider session handle                         │
│   - lets harness re-attach to a still-running container            │
├────────────────────────────────────────────────────────────────────┤
│ snapshot  (PROVIDER-SIDE, workspace contents)                      │
│   - filesystem snapshot saved by sandbox provider                  │
│   - seeds a *fresh* container if session_state is gone             │
└────────────────────────────────────────────────────────────────────┘
```

**Resolution order on resume:** live session → resumed `RunState` → explicit `session_state` → fresh manifest-based creation (verbatim, from Sandbox Agents docs).

**Conversation history** — separate from `RunState`. Lives in `Session` (SQLite, OpenAI Conversations, or custom). Items are `TResponseInputItem` (the canonical Responses-API item type — messages, tool calls, tool results).

**Workspace memory** — lives *inside the sandbox filesystem* under a fixed layout:

```
workspace/
  sessions/
    <rollout-id>.jsonl          # rollout / replay log
  memories/
    memory_summary.md           # 1-line summary, loaded eagerly
    MEMORY.md                   # human-readable cross-run notes
    raw_memories.md             # full memory log
```

Schema versioning is not documented publicly. The `Manifest` schema appears stable (consistent entry types across docs and reporting) but the published spec is the SDK source of truth, not a JSON Schema document.

**Persistence options** — fully user-controlled:

| Layer | OpenAI-hosted option | Self-hosted options |
|---|---|---|
| Conversation history | `OpenAIConversationsSession` | `SQLiteSession`, custom `SessionABC` |
| `RunState` | (none documented; serialize and store yourself) | Any blob store |
| Sandbox snapshots | (provider-dependent) | S3, GCS, R2, Azure Blob, local FS — wired via Manifest mount entries |

**Multi-tenancy** is at the **session boundary** (each `Session` has an ID), at the **sandbox boundary** (each `SandboxAgent` provisions its own container), and at the **credential boundary** (credentials live in the harness, not in the sandbox).

## 5. Execution Flow

```
   App                Agents SDK             Sandbox Provider          Model API
    │                  (harness)                  (E2B etc.)         (Responses)
    │                     │                          │                    │
    │ run(agent, prompt) │                          │                    │
    ├────────────────────►│                          │                    │
    │                     │  provision(manifest)     │                    │
    │                     ├─────────────────────────►│                    │
    │                     │◄─── sandbox_id ──────────┤                    │
    │                     │                          │                    │
    │                     │  load AGENTS.md, skills index, memory_summary │
    │                     │                          │                    │
    │                     │                  responses.create(            │
    │                     │                    tools=[apply_patch,        │
    │                     │                           shell, ...],        │
    │                     │                    messages=[...] )           │
    │                     ├─────────────────────────────────────────────► │
    │                     │◄──── tool_call: apply_patch / shell / ... ────│
    │                     │                          │                    │
    │                     │  dispatch tool call      │                    │
    │                     ├─────────────────────────►│                    │
    │                     │  execute (apply diff,    │                    │
    │                     │   run shell, etc.)       │                    │
    │                     │◄─── tool_result ─────────┤                    │
    │                     │  append to RunState                            │
    │                     │  checkpoint (periodic)                         │
    │                     │                                                │
    │                     │  responses.create(... + tool_result ...)       │
    │                     ├─────────────────────────────────────────────► │
    │                     │  (loop until final output or handoff)         │
    │                     │                                                │
    │ ◄─── RunResult ─────┤                                                │
    │                     │  (sandbox kept alive for follow-up,            │
    │                     │   or torn down on session close)               │
```

Approvals (when `approval-policy != never`) inject a synchronous pause: the harness emits an approval event, awaits resolution from the application, and only then proceeds with the gated tool call.

Handoffs are modeled as a tool call whose effect is to *swap the active agent*. The runner unwinds, picks up the new agent's instructions/tools/handoffs, and continues the loop with the same conversation history.

## 6. Sandbox Architecture

### Provisioning model

- **Lazy** — sandbox materialises when the first sandbox-touching tool call (apply_patch, shell, filesystem) fires; pure-LLM agents never provision.
- **Per-session** — one sandbox per `SandboxAgent` run scope. Re-runs against the same `RunState` re-attach if `session_state` is still live, otherwise rehydrate from snapshot, otherwise fresh from `Manifest`.
- **BYO + 9 first-class clients**: `BlaxelSandboxClient`, `CloudflareSandboxClient`, `DaytonaSandboxClient`, `DockerSandboxClient`, `E2BSandboxClient`, `ModalSandboxClient`, `RunloopSandboxClient`, `UnixLocalSandboxClient`, `VercelSandboxClient`. Custom providers implement the same client interface.

### Lifecycle

```
fresh:   Manifest → provider.create(manifest) → SandboxSession
resume:  RunState + session_state → provider.attach(session_state)
            ↳ if dead → provider.create_from_snapshot(snapshot)
                          ↳ if no snapshot → provider.create(manifest)
close:   provider.close(session) [snapshot first if configured]
```

### Filesystem semantics

- Workspace-rooted. **Manifest entry paths are workspace-relative; absolute paths and `..` traversal are rejected** ("keeps the workspace contract portable across local, Docker, and hosted clients").
- Mount types map directly to remote storage: `S3Mount`, `GCSMount`, `R2Mount`, `AzureBlobMount`, `BoxMount`, `S3FilesMount`, plus `LocalFile`, `LocalDir`, `GitRepo`, `File`, `Dir`.
- Reserved/protected paths in Codex sandboxes: `.git`, `.agents`, `.codex` are read-only even in writable modes.

### Network policy

- **Default deny during agent execution** for cloud sandboxes (Codex Web pattern: "By default, Codex cloud agents have no internet access during runtime to help protect against security and safety risks like prompt injection"; HTTP/HTTPS proxy gates explicit egress).
- **Setup phase has network**, agent phase does not (Codex cloud env): "Internet access is available during setup but disabled by default during agent execution."
- **Local CLI**: configurable via approval mode; `read-only` blocks, `workspace-write` blocks (default), `danger-full-access` opens.
- **MCP servers** are the canonical way to give the agent network-mediated capabilities — they run *outside* the sandbox and the agent calls them through the harness, so credentials stay in MCP scope, not in the sandbox.

### Sandbox technology referenced

| Backend | Technology |
|---|---|
| Codex CLI macOS | Apple Seatbelt (`sandbox-exec`) |
| Codex CLI Linux/WSL2 | `bubblewrap` (user namespaces) + `seccomp` |
| Codex CLI Windows | Windows native sandbox / WSL2 |
| Codex Web / cloud | OpenAI-managed containers (image: `codex-universal`); 12-hour cache |
| E2B / Modal / Daytona / Runloop / Blaxel | Vendor microVMs/containers |
| Cloudflare / Vercel | Edge isolates / sandboxes |
| Docker | Local containers |
| Unix-local | Direct host execution (development only) |

## 7. Codex / Codex Web Architecture

### Codex CLI (`@openai/codex`, Rust binary, ~80k stars on GitHub as of fetch)

- **Process model**: single Rust binary, runs locally, talks directly to the Responses API.
- **Sandbox**: uses OS-native primitives (Seatbelt / bubblewrap+seccomp / Windows sandbox). The sandbox has three modes:
  - `read-only` — inspect only
  - `workspace-write` — read full FS, write inside workspace, network blocked (default)
  - `danger-full-access` — no restrictions
- **Approval policies**: `untrusted` (approve non-safe), `on-request` (approve when the model asks to escape sandbox), `never` (no prompts; sandbox still enforces). Granular `approval_policy = { granular = { ... } }` lets admins per-category configure.
- **Auto reviewer**: `approvals_reviewer = "auto_review"` routes approvals through an LLM evaluator that checks for exfiltration / credential probing / destructive actions.
- **AGENTS.md chain**: rebuilt on every run / TUI session start; `~/.codex/AGENTS.override.md` → `~/.codex/AGENTS.md` → walk from project root downward to CWD checking each level. Concatenated root-first, joined by blank lines, capped at `project_doc_max_bytes` (default 32 KiB). `project_doc_fallback_filenames` allows alternates.
- **Skills**: discovered from `$CWD/.agents/skills`, parent dirs, `$REPO_ROOT/.agents/skills`, `$HOME/.agents/skills`, `/etc/codex/skills`, plus bundled system skills. Progressive disclosure: only `name`, `description`, `path` injected initially (~2% of context); full `SKILL.md` loaded on use.
- **MCP server mode**: `codex mcp-server` exposes Codex itself as an MCP-callable tool (`codex` + `codex-reply` actions, threaded by `threadId`). This is the integration path with the Agents SDK.
- **Exec mode**: `codex exec` runs a one-shot non-interactive task — used in CI and as the building block for Codex Web's headless workers.

### Codex Web (`chatgpt.com/codex`)

What's documented:

- **App Server + cloud container**: web UI runs the App Server; tasks dispatch to OpenAI-managed cloud containers.
- **Container image**: defaults to `universal` (open-source: `openai/codex-universal`). Includes runtimes for npm/yarn/pnpm/pip/pipenv/poetry. Setup scripts allow user-installed extras.
- **GitHub integration**: connects a GitHub account; Codex checks out the selected repo at the chosen branch/SHA, then either pushes a branch and opens a PR, or just publishes a diff for review. `@codex` mentions in issues/PRs spin up tasks.
- **Caching**: "Codex caches container state for up to 12 hours to speed up new tasks and follow-ups."
- **Network policy**: **internet access during setup, disabled during agent execution by default**. Egress is gated by an HTTP/HTTPS proxy. Users can opt into network access per environment.
- **Secrets**: encrypted at rest; available **only during setup**; explicitly stripped before agent phase begins.
- **Concurrency**: tasks run "in the background (including in parallel)" — multi-tenant cloud workers.
- **IDE delegation**: tasks can be initiated from VS Code/Cursor/Windsurf extensions, monitored remotely, then diffs applied locally.

What's inferred:

- The cloud uses the same `codex exec` core as the CLI, wrapped in an orchestrator that manages container lifecycle, GitHub OAuth, and the PR workflow.
- The 12-hour cache implies a snapshot-and-rehydrate cycle on the OpenAI side that's structurally identical to what the new Agents SDK exposes — but Codex Web exposes it as "follow-up tasks" rather than as a programmable primitive.
- "Code Review" mode (visible in the Codex CLI `codex` skill description) and "Challenge" mode are higher-level workflows on top of the same primitives.

## Section 7-bis: Computer Use / Responses API Computer Environment

This section covers a track that's *adjacent* to but *distinct* from the Sandbox Agents / Codex story above. There are actually **two different products** that both get called "computer use" in OpenAI's surface area, and the disambiguation matters for design:

1. **Responses API Computer Environment** (March 2026 announcement, `equip-responses-api-computer-environment`) — a *hosted container* workspace with the **shell tool**, skills, and compaction. This is OpenAI's first-party answer to "where does the agent's compute actually run" when the developer doesn't bring their own E2B/Modal/Daytona. Closer in spirit to Section 6's Sandbox Agents than to anything visual.
2. **Computer Use** / `computer_use_preview` tool + `computer-use-preview` model (March 2025, originated as Operator in January 2025) — a **visual GUI control loop**: the model sees a screenshot, emits click/type/scroll actions, gets a new screenshot back, repeats. This is OpenAI's analog to Anthropic's Claude 3.5 Sonnet "computer use" feature.

Both are relevant; we cover them in order.

### 7-bis.1 Core thesis — Computer Environment (hosted container)

OpenAI's framing in the March 2026 blog: *"From model to agent: Equipping the Responses API with a computer environment"* — paraphrased from VentureBeat / InfoQ / sitepoint coverage since the OpenAI blog post itself was 403-walled to fetch — *"the Responses API provides orchestration, the shell tool provides executable actions, the hosted container provides persistent runtime context, skills layer reusable workflow logic, and compaction allows an agent to run for a long time with the context it needs."* **[PUBLIC, paraphrased]**

How it differs from Codex (Section 7) and from Sandbox Agents (Section 6):

- **Codex** is a *coding-agent product* layered on top of these primitives — `apply_patch` first-class, GitHub-PR workflow, AGENTS.md. The Computer Environment is the *primitive layer* underneath; you can use it for any agent, not just coding.
- **Sandbox Agents** are *BYO compute* — you pick E2B / Modal / Daytona / etc. The Computer Environment is *OpenAI-hosted compute* — the `container_auto` mode provisions a Debian 12 environment without you ever touching a sandbox vendor.

In other words: Sandbox Agents = "harness with pluggable compute providers"; Computer Environment = "harness with first-party compute provider as a built-in option". They fit together — `container_auto` is effectively a 9th first-class sandbox client, but one that's hosted by OpenAI on the same plane as `web_search` or `code_interpreter`.

### 7-bis.2 Named primitives — Computer Environment

| Primitive | What it is | Source |
|---|---|---|
| **Shell tool** (`{"type": "shell"}`) | Hosted shell tool — model emits shell commands, Responses API forwards to container runtime, streams stdout/stderr back, feeds into next turn | `developers.openai.com/api/docs/guides/tools-shell` **[PUBLIC]** |
| **Local shell tool** (`{"type": "local_shell"}`) | Same shape but executor runs on the developer's machine, not OpenAI's container | `developers.openai.com/api/docs/guides/tools-local-shell` **[PUBLIC]** |
| **Hosted container** (`container_auto`) | OpenAI-managed Debian 12 environment; Python 3.11, Node.js 22, Java 17, Go 1.23, Ruby 3.1 pre-installed; `/mnt/data` for persistent storage; SQLite available; restricted network access | InfoQ / VentureBeat coverage **[PUBLIC, paraphrased]** |
| **Skills** (`tools-skills`) | Same SKILL.md format as Codex (Section 7) — a folder with `SKILL.md` plus assets/scripts/specs. Loaded via progressive disclosure | `developers.openai.com/api/docs/guides/tools-skills` **[PUBLIC]** |
| **Server-side compaction** | Automatic context-window management; conversation history summarised in-place. Triple Whale reported a Moby-agent run with **5M tokens / 150 tool calls without accuracy drop** | InfoQ / VentureBeat coverage **[PUBLIC, paraphrased]** |

The composition is the same shape as Section 6 (manifest + capabilities), but OpenAI is now offering the *full vertical slice*: their model, their orchestrator, their container, their persistence, their compaction, their skills loader. A developer can ship an agent without picking any sandbox vendor.

### 7-bis.3 Core thesis — Computer Use (visual GUI agent)

The `computer_use_preview` tool is a different product entirely: it's the **screenshot-action loop** for controlling a browser or VM via simulated mouse/keyboard. It powers Operator (the consumer-facing web agent at `operator.chatgpt.com`). The model is `computer-use-preview` — a specialised SKU trained against pixel screenshots and UI grounding, with **8,192-token context** and **1,024 max output tokens** **[PUBLIC]**, knowledge cutoff **October 1, 2023** **[PUBLIC]**, $3/M input + $12/M output, **Tier 3+ access required (3,000 RPM minimum)** **[PUBLIC]**.

OpenAI describes the underlying CUA (Computer-Using Agent) as combining *"GPT-4o's vision capabilities with advanced reasoning through reinforcement learning"* **[PUBLIC, paraphrased from `openai.com/index/computer-using-agent/`]**. The training-data note: the model was trained on a small set of simple apps (calculators, text editors) but generalised to apps it never saw, the same generalisation claim Anthropic made for their computer-use model.

### 7-bis.4 Named primitives — Computer Use

**Tool definition shape** **[PUBLIC]**:

```ts
{
  type: "computer_use_preview",
  display_width: 1024,
  display_height: 768,
  environment: "browser" | "mac" | "windows" | "ubuntu"
}
```

**Action types** the model can emit **[PUBLIC]**:

| Action | Args | Notes |
|---|---|---|
| `click` | `x, y, button` (left/right/middle), optional `keys[]` modifiers | `CTRL` normalised to `Control` |
| `double_click` | `x, y` | |
| `drag` | `path: [{x,y}, ...]` (≥2 points) | |
| `move` | `x, y` | |
| `scroll` | `x, y, scrollX, scrollY` | |
| `keypress` | `keys[]` | Standalone keyboard input, not chained with click |
| `type` | `text` | Text into focused field |
| `wait` | `ms?` | Pauses execution |
| `screenshot` | — | Explicit re-capture |

**Loop pattern** **[PUBLIC]**:

```
1. Send prompt with tools=[{type:"computer_use_preview", ...}]
2. Model returns `computer_call` items, each with one or more actions
3. Executor runs all actions in order in the browser/VM
4. Capture screenshot, base64-encode (recommended detail: "original" — preserves up to 10.24M pixels, improves click accuracy)
5. POST `computer_call_output` referencing `call_id`, with image + acknowledged_safety_checks
6. Repeat until model stops emitting `computer_call`
```

**Safety checks (acknowledgement protocol)** **[PUBLIC]**:

- The API surfaces `pending_safety_checks` on a `computer_call` when it detects: malicious instruction injection, irrelevant-domain navigation, sensitive-domain navigation.
- The harness **must** echo them back as `acknowledged_safety_checks` on the next `computer_call_output`, otherwise the API errors with `unsupported_safety_acknowledgement` (the OpenAI sample app explicitly notes this is **not** implemented out of the box).
- This is the human-in-the-loop hook for risky actions like form submissions or credential entry.

### 7-bis.5 Architecture — where does the computer environment run?

| Mode | Compute location | Network | Surface |
|---|---|---|---|
| **Computer Use, native (Operator-style)** | OpenAI-hosted Chromium VM | Yes (the agent IS browsing) | `operator.chatgpt.com` |
| **Computer Use, BYO browser** | Customer-managed Playwright/Selenium browser | Customer-controlled | `computer_use_preview` tool, `environment: "browser"` |
| **Computer Use, BYO VM** | Customer-managed Docker/VM with Xvfb + x11vnc + Firefox | Customer-controlled | `environment: "ubuntu"` etc. |
| **Computer Environment, hosted** | OpenAI-managed Debian 12 container (`container_auto`) | Restricted | Shell tool + container API |
| **Computer Environment, local** | Developer's machine | Open | `local_shell` tool |

The split: Computer **Use** is a tool-call surface that *requires the customer to operate the browser/VM* in the BYO case (OpenAI doesn't ship the executor); the OpenAI-hosted version is reserved for Operator. Computer **Environment** is a tool-call surface where *OpenAI runs the container*. Both flow through the same Responses API.

### 7-bis.6 Browser-only vs full-desktop

- **Operator (consumer product)**: browser-only. Single Chromium VM per session. **[PUBLIC]**
- **`computer_use_preview` API**: explicitly supports `environment: "browser" | "mac" | "windows" | "ubuntu"` **[PUBLIC]**. The latter three imply full-desktop, but **OpenAI doesn't host them — the customer provides the VM**. The OpenAI sample app (`openai/openai-cua-sample-app`) is "intentionally browser-focused" **[PUBLIC, verbatim]**.
- **Codex desktop's computer use feature** (different product, see Section 7): macOS-only at launch, "Full Computer Use support for Codex Desktop on Windows" tracked as feature request **[PUBLIC]**, not yet shipped at the time of this fetch.

So: **OpenAI ships browser-only on its hosted side; full-desktop is a BYO-VM exercise**. The model-side (`computer-use-preview`) supports the full taxonomy; the platform-side hosting is browser-first.

### 7-bis.7 Comparison to Anthropic Computer Use

Both shipped the same loop pattern within ~5 months of each other (Anthropic October 2024 with Claude 3.5 Sonnet new; OpenAI January 2025 with Operator/CUA). Differences:

| Axis | Anthropic Computer Use | OpenAI Computer Use |
|---|---|---|
| Sandbox stance | Customer provides Docker/VM (reference impl is Docker + Xvfb) | Operator is OpenAI-hosted Chromium; API is BYO browser/VM |
| Default surface | Full desktop (the demo controls a Linux VM end-to-end) | Browser-first (Operator), full-desktop available via env=ubuntu/mac/windows but BYO |
| Action API | `computer_20241022` tool, screenshot returned as `tool_result` | `computer_use_preview` tool, screenshot returned as `computer_call_output` |
| Safety hooks | Customer responsibility (Anthropic ships guidance, not enforcement on action stream) | Built-in `pending_safety_checks` / `acknowledged_safety_checks` protocol enforced by API |
| Model SKU | General-purpose Claude with computer-use training | Dedicated `computer-use-preview` SKU (separate model, lower context, lower max-output) |
| Consumer product | None — pure API | Operator (chatgpt.com surface) |
| Generalisation claim | "Trained on simple apps, generalised to never-seen apps" | Same claim, different vocabulary |

**Convergence**: same pixel-grounded action loop, same screenshot-feedback cycle, same coordinate-based action vocabulary. **Divergence**: OpenAI ships a consumer product on top of the API (Operator); Anthropic stays at the API layer. OpenAI ships safety-check enforcement as a protocol; Anthropic delegates to the customer.

### 7-bis.8 Implications for agent-express design

- **`tools.computerUse()` middleware — yes, but later.** This is a v0.5 candidate, not v0.4. Reason: the executor side requires a real browser/VM in the user's environment, which is sandboxing scope. Until we have v0.5's `SandboxClient` interface, shipping `tools.computerUse()` would force users to bring their own Playwright + safety-check loop with no help from the framework.
- **`tools.shell()` middleware — also v0.5.** OpenAI's shell tool is symmetric with our existing `tools.function()` shape (one tool, one verb, structured output). The tricky part is the *executor* — local-shell mode wants a host-side process; hosted mode wants the OpenAI container. We don't have either today.
- **Hand abstraction impact**: Computer Use IS a Hand, but with a *non-text feedback channel* (image bytes). Our current middleware/tool plumbing assumes structured text in/out. Adding image returns is a real schema change in the executor — `ToolContext.result` would need to carry image content blocks, not just strings. This is the hidden cost.
- **Safety-check protocol is reusable**. Even before we ship computer-use, the `pending_safety_checks` / `acknowledged_safety_checks` pattern is a clean fit for our existing `guard.approve()` middleware. The interaction shape — model emits gated action, harness pauses, asks application, resumes — is exactly what `guard.approve()` does. We should align state-key naming so a future `tools.computerUse()` can plug in without a new approval system.
- **Hosted-container envy is real but premature**. OpenAI's `container_auto` is the closest thing to a managed-runtime competitor for our v0.5 server. We should *not* try to replicate it — that's an infra moat we can't beat. We should instead make our Manifest/Sandbox layer pluggable enough that someone could implement a `ContainerAutoSandboxClient` that proxies to OpenAI's container API if they want hosted compute on the OpenAI side.
- **Phase placement summary**:
  - **v0.4 (current)**: align `guard.approve()` semantics with the safety-check echo pattern. Document the alignment so users can write their own computer-use middleware against our hooks.
  - **v0.5 (Go server, sandboxing)**: ship `tools.computerUse()` and `tools.shell()` as opt-in middlewares once `SandboxClient` exists. First implementations target Playwright (browser) and Docker-with-Xvfb (full desktop).
  - **Beyond v0.5**: a `tools.operator()` thin wrapper that calls the hosted Operator API, if/when OpenAI exposes it as an API rather than a consumer product.

### 7-bis.9 What's PUBLIC vs INFERRED

| Claim | Status | Source |
|---|---|---|
| `computer_use_preview` tool with `environment: browser/mac/windows/ubuntu` and `display_width/height` | **[PUBLIC]** | `tools-computer-use` guide |
| `computer-use-preview` model — 8K context, 1K output, $3/$12, Oct 2023 cutoff, Tier 3+ | **[PUBLIC]** | `models/computer-use-preview` |
| Action vocabulary: click, double_click, drag, move, scroll, keypress, type, wait, screenshot | **[PUBLIC]** | `tools-computer-use` guide |
| Screenshot loop with `computer_call` ↔ `computer_call_output` | **[PUBLIC]** | `tools-computer-use` guide |
| `pending_safety_checks` → `acknowledged_safety_checks` echo protocol | **[PUBLIC]** | `safety-checks` guide; community threads |
| Operator runs on OpenAI-hosted Chromium VM | **[PUBLIC]** | `openai.com/index/computer-using-agent/` |
| Sample app is browser-focused, safety acks not implemented | **[PUBLIC, verbatim]** | `openai/openai-cua-sample-app` README |
| March 2026 Computer Environment = shell tool + hosted container + skills + compaction | **[PUBLIC, paraphrased]** | OpenAI blog post (403-walled to direct fetch); InfoQ, VentureBeat, sitepoint coverage |
| `container_auto` = OpenAI-hosted Debian 12 with Python/Node/Java/Go/Ruby | **[PUBLIC, paraphrased]** | InfoQ / VentureBeat coverage |
| `/mnt/data` persistent storage in hosted container | **[PUBLIC, paraphrased]** | Coverage articles |
| Triple Whale Moby agent: 5M tokens / 150 tool calls with compaction | **[PUBLIC, paraphrased]** | OpenAI blog post coverage |
| `local_shell` runs on developer's machine | **[PUBLIC]** | `tools-local-shell` guide |
| Computer Use BYO-VM full-desktop architecture | **[INFERRED]** | Implied by `environment: ubuntu/mac/windows`; no first-party hosting beyond Operator |
| Computer Environment is structurally a 9th sandbox client | **[INFERRED]** | Same shape as Section 6 sandbox clients; OpenAI doesn't list it that way |
| Codex Desktop "Computer Use" reuses the same `computer_use_preview` underneath | **[INFERRED]** | Not explicitly documented; consistent with platform pattern |

### 7-bis.10 Source citations

- [Computer use guide — OpenAI Developers](https://developers.openai.com/api/docs/guides/tools-computer-use)
- [computer-use-preview model — OpenAI Developers](https://developers.openai.com/api/docs/models/computer-use-preview)
- [Computer-Using Agent (CUA / Operator launch) — OpenAI](https://openai.com/index/computer-using-agent/) — 403 to direct fetch; quoted via search-engine excerpts
- [From model to agent: Equipping the Responses API with a computer environment — OpenAI](https://openai.com/index/equip-responses-api-computer-environment/) — primary source for §7-bis.1–§7-bis.2; 403 to direct fetch, reconstructed from coverage
- [Russian-locale equivalent of the same blog post](https://openai.com/ru-RU/index/equip-responses-api-computer-environment/) — same content, locale-redirected
- [Shell tool — OpenAI Developers](https://developers.openai.com/api/docs/guides/tools-shell)
- [Local shell tool — OpenAI Developers](https://developers.openai.com/api/docs/guides/tools-local-shell)
- [Skills tool — OpenAI Developers](https://developers.openai.com/api/docs/guides/tools-skills)
- [Safety checks — OpenAI Developers](https://developers.openai.com/api/docs/guides/safety-checks)
- [Computer Use in Codex Desktop — OpenAI Developers](https://developers.openai.com/codex/app/computer-use)
- [openai/openai-cua-sample-app — GitHub](https://github.com/openai/openai-cua-sample-app)
- [OpenAI upgrades its Responses API to support agent skills and a complete terminal shell — VentureBeat](https://venturebeat.com/orchestration/openai-upgrades-its-responses-api-to-support-agent-skills-and-a-complete) — March 2026 coverage
- [OpenAI Extends the Responses API to Serve as a Foundation for Autonomous Agents — InfoQ](https://www.infoq.com/news/2026/03/openai-responses-api-agents/) — March 2026 coverage
- [Shell + Skills + Compaction tips — OpenAI Developers blog](https://developers.openai.com/blog/skills-shell-tips)
- [Anthropic's Computer Use vs OpenAI's CUA — WorkOS](https://workos.com/blog/anthropics-computer-use-versus-openais-computer-using-agent-cua) — comparison source
- [Introducing computer use, a new Claude 3.5 Sonnet — Anthropic](https://www.anthropic.com/news/3-5-models-and-computer-use) — Anthropic's reference point

---

## 8. Manifest Specifics

### File location, name, format

The Manifest is a **Python (or TS) data structure passed at SDK call site**, *not* a free-standing file on disk. It is constructed in code:

```python
Manifest(
    entries=[GitRepo(...), File(...), S3Mount(...), LocalDir(...)],
    environment={"KEY": "value"},
    users=[...],
    groups=[...],
)
```

The **AGENTS.md / SKILL.md / MEMORY.md** files are the on-disk equivalent for *agent behaviour* — but the workspace shape itself is a programmatic Manifest, not a YAML/TOML file. (This contrasts with Anthropic's `Resources` parameter, which fills the same role and is also passed at provision time.)

### Schema fields known publicly

```
Manifest:
  entries: list[ManifestEntry]
  environment: dict[str, str]
  users: list[User]
  groups: list[Group]

ManifestEntry (tagged union):
  File          { path, contents }
  Dir           { path }
  LocalFile     { path, source }            # materialise host file
  LocalDir      { path, source }
  GitRepo       { path, url, ref?, depth? }
  S3Mount       { path, bucket, prefix?, region?, credentials_ref? }
  GCSMount      { path, bucket, prefix?, credentials_ref? }
  R2Mount       { path, bucket, prefix?, credentials_ref? }
  AzureBlobMount{ path, container, prefix?, credentials_ref? }
  BoxMount      { path, ... }
  S3FilesMount  { path, bucket, files: [...] }   # selective files

Constraints:
  - all `path` values are workspace-relative
  - no absolute paths, no `..` traversal
  - rejected at construction time (portability invariant)
```

### Permissions

There's a Unix-style notion (`users`, `groups` on the Manifest) for in-sandbox identity, but **harness↔sandbox permissions** are **Codex-style modes** (`read-only`, `workspace-write`, `danger-full-access`) plus **approval policies** (`untrusted`, `on-request`, `never`, `granular`). It's *not* a rich RBAC; it's a small fixed enum.

### Whether the schema is published

- **Programmatic schema** is the SDK source — versioned with the Python/TS package.
- **No standalone JSON Schema document** has been published as of April 2026.
- The set of provider clients constrains how `Manifest` entries get resolved (`S3Mount` has different semantics on Cloudflare vs. E2B), but the *Manifest schema itself* is provider-agnostic by design.

## 9. Credentials / Auth Architecture

OpenAI's stated invariant — **credentials live in the harness, never in the sandbox** — is the inverse of how a typical Docker-based agent runs. Concretely:

- **Harness layer** holds: API keys (Responses API), MCP server credentials, sandbox-provider credentials, storage credentials (S3/GCS/R2/Azure).
- **Sandbox layer** receives: only what the Manifest explicitly mounts. Credentials are not auto-injected into env vars.
- **Codex Web secrets** are decrypted only during the **setup script phase**, then **removed before agent phase starts** (verbatim from cloud env docs). This means your `OPENAI_API_KEY` or `DATABASE_URL` is gone by the time the model is in the loop.
- **MCP servers** sit outside the sandbox, behind the harness. The agent calls an MCP tool; the MCP server holds the credential; the sandbox never sees it. This is the same pattern Anthropic uses with their MCP/credential proxy.

Quote from a launch-coverage piece (with the standard caveat that this isn't OpenAI's own wording): *"The harness layer — which holds credentials, manages memory, and handles orchestration — runs in your secure environment. The compute layer — where model-generated code executes — runs in the isolated sandbox with no credentials in scope."*

**OAuth / connectors**: the Agents SDK does not (yet) ship a first-party connector framework comparable to Anthropic's. OAuth-mediated services are wired via MCP servers — `MCPServerStreamableHttp` is the standard transport for hosted MCP servers, and those servers carry their own OAuth flow.

**Multi-tenant model**: the SDK is library-shaped — the host application owns tenant isolation. Per-tenant `Session` IDs, per-tenant `SandboxAgent` instances, per-tenant credentials in the harness's secret store. There is no built-in tenant abstraction.

## 10. Long-running / Durable Agents

This is the central design move of the April 2026 update — and the single most architecturally distinctive thing about the new SDK.

**Resumability**:

```
result1 = Runner.run_sync(agent, "build the API")
# ... container dies, harness process restarts ...
result2 = Runner.run_sync(agent, "continue", state=result1.state)
# RunState replays — any pending tool calls re-issue
# Sandbox is rehydrated:
#   1. session_state still alive? → re-attach
#   2. snapshot exists?           → spin new container, restore
#   3. neither?                   → fresh from Manifest
```

**Periodic checkpointing**: the SDK writes checkpoints to a connected storage backend during multi-step runs. On failure: *"the orchestrator detects the interruption, provisions a new container, restores the last checkpoint, and continues execution from that point."*

**Cross-process resume**: `RunState` is serializable. Any process with the right credentials and a copy of the state can pick up. This is the externalised-state pattern: **harness is stateless at the process level**.

**Cross-container resume**: snapshots are sandbox-provider features; the SDK abstracts them as `snapshot` on the state surface. Provider availability varies (E2B and Daytona ship snapshot APIs; Vercel / Cloudflare are evolving).

**Cross-region / cross-cloud resume**: not directly supported — you'd need to copy `Manifest`, `RunState`, and seed the new region from snapshot. There's no single-call portability primitive.

## 11. Comparison to Anthropic Managed Agents

Both arrived at the same architectural answer. Differences are about **how the answer is exposed** and about which conventions get the first-class slot.

| Axis | Anthropic Managed Agents | OpenAI Agents SDK + Codex |
|---|---|---|
| Naming | Brain / Hands / Session | Harness / Sandbox / Session |
| Reasoning plane | Brain (Claude + harness), stateless | Harness (Agents SDK), stateless |
| Compute plane | Hands (sandboxes/tools), `execute(name, input) → string` | Sandbox (8 first-class providers + BYO) |
| State plane | Session = append-only event log | `RunState` (harness) + `session_state` (live sandbox) + `snapshot` (workspace) — three surfaces |
| Resume primitive | `wake(sessionId)` — boot fresh harness, replay event log | `Runner.run(agent, prompt, state=prior_state)` + sandbox resolution order |
| Workspace declaration | `provision({ resources })` — opaque resources | `Manifest` — typed entry union with mount taxonomy |
| Workspace declaration style | Procedural (call provision with a payload) | Declarative (data structure passed at run) |
| File editing tool | Generic `execute()` (tool name = "str_replace_editor", "view", etc.) | `apply_patch` as a **first-class hosted tool** — V4A diff format, `create_file`/`update_file`/`delete_file` ops |
| Code execution | Generic `execute()` with shell tool | `shell` tool — first-class, gated by approval policy |
| Multi-agent | Brains pass hands to one another (handoff is implicit; sandboxes are decoupled) | `Handoff` is an explicit primitive — `handoff()` factory, `RunHandoffCallItem`, hand-off span |
| Skills / progressive disclosure | Anthropic Claude Skills (announced separately) | First-class capability: `Skills()` capability + `SKILL.md` directory format + 2%-of-context disclosure rule |
| Instruction file | `CLAUDE.md` (Claude Code convention); Managed Agents inherit this | `AGENTS.md` (joint OpenAI/Google open standard); `AGENTS.override.md` for overrides; explicit hierarchy + concatenation rules; 32 KiB cap |
| Memory | Compaction events in event log; session metadata | Workspace-side `MEMORY.md` / `memory_summary.md` / `raw_memories.md`; reads at start, regenerates at end |
| Credential model | Vault + MCP credential proxy; tokens scoped by session | Credentials in harness layer; sandbox never sees; MCP servers carry their own auth; secrets stripped after setup phase |
| Tool taxonomy | Single uniform `execute(name, input)` verb — "the harness doesn't know whether the sandbox is a container, a phone, or a Pokémon emulator" | **Three explicit tiers**: hosted (web_search, computer, code_interpreter, file_search, image_gen, apply_patch), function (typed), MCP (transport-pluggable) |
| Tracing | Implicit in event log structure | Separate `Trace`/`Span` system; auto-wraps `Runner.run`; 25+ third-party processors |
| Storage of conversation | Anthropic-managed event log (also user-pluggable in SDK) | `OpenAIConversationsSession` (managed) OR `SQLiteSession` OR custom `SessionABC` |
| Sandbox providers | Anthropic-managed (mostly) | 8 third-party + Docker + Unix-local + BYO — explicitly **NOT** OpenAI-managed |

**Convergence**: stateless harness, externalised state, credentials-out-of-sandbox, MCP as the extension surface, snapshot/rehydrate for durability.

**Divergence**:

1. **Anthropic prefers a uniform `execute()` verb; OpenAI prefers a typed three-tier tool taxonomy.** OpenAI's `apply_patch` and `shell` get first-class treatment because Codex was trained against them — the harness is *model-native*, meaning the tool surface matches the training distribution.
2. **Anthropic's state is an event log; OpenAI's state is three explicit surfaces (`RunState`, `session_state`, `snapshot`).** Anthropic's model is *cleaner conceptually* (everything is an ordered event); OpenAI's is *more operationally explicit* (you can see exactly what to checkpoint, what to recover, what to rebuild).
3. **OpenAI's Manifest is declarative and typed; Anthropic's `resources` is procedural and opaque.** Manifest is closer to a Kubernetes spec; resources is closer to a constructor argument.
4. **OpenAI provides 8 first-class sandbox providers; Anthropic ships its own.** OpenAI is explicitly multi-vendor at the compute layer.
5. **Multi-agent**: OpenAI exposes `Handoff` as a typed primitive with run-item support and tracing spans; Anthropic treats it as an emergent property of stateless brains sharing hands.

## 12. Architectural Diagrams

### 12.1 High-level component diagram

```
                    ┌──────────────────────────────────────────────────────┐
                    │                  HOST APPLICATION                    │
                    │  (your TS/Python service — multi-tenant, stateful)   │
                    └──────────────────────────────────────────────────────┘
                                          │
                                          ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │                       AGENTS SDK — HARNESS (control plane)               │
   │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
   │  │  Agent   │  │  Runner  │  │  Session │  │ Guardrls │  │   Tracer   │ │
   │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └────────────┘ │
   │  ┌──────────────────────────────────────────────────────────────────┐   │
   │  │   RunState (model items, tool state, approvals, pending diffs)   │   │
   │  └──────────────────────────────────────────────────────────────────┘   │
   │      ▲                  │ tool calls                ▲                   │
   │      │ Responses API    │ (apply_patch, shell,      │ MCP calls         │
   │      ▼                  │  hosted, function)        ▼                   │
   │  ┌──────────┐            ▼                       ┌──────────┐           │
   │  │  Model   │      ┌────────────┐                │  MCP     │           │
   │  │ (GPT-5.x)│      │  Sandbox   │                │ servers  │           │
   │  └──────────┘      │  Client    │                │ (Stdio,  │           │
   │                    └────────────┘                │  SSE,    │           │
   │       CREDENTIALS  ▲                             │  HTTP)   │           │
   │       (held here)  │                             └──────────┘           │
   └────────────────────┼─────────────────────────────────────────────────────┘
                        │ provision / execute / snapshot / attach
                        ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │                         SANDBOX (compute plane)                          │
   │   E2B │ Modal │ Daytona │ Vercel │ Cloudflare │ Runloop │ Blaxel │ ...   │
   │   Docker │ Unix-local │ BYO                                              │
   │                                                                          │
   │   workspace/                                                             │
   │     <git repos>      <files>      <S3/GCS/R2/Azure mounts>               │
   │     .agents/skills/   AGENTS.md   memories/MEMORY.md                     │
   │                                                                          │
   │   Capabilities active: Filesystem, Shell, Skills, Memory, Compaction     │
   │   No credentials. Network gated by mode + approval policy.               │
   └──────────────────────────────────────────────────────────────────────────┘
```

### 12.2 API surface diagram

```
                              @openai/agents
   ┌──────────────────────────────────────────────────────────────────┐
   │  Construction          Execution          Tools                  │
   │  ─────────────         ──────────         ──────────────────     │
   │  new Agent({...})      run(agent, p)      function:              │
   │  Handoff(...)          Runner.run_sync     tool(), toolNamespace │
   │  defineGuardrail(...)  Runner.run_async   hosted:                │
   │                                            webSearchTool         │
   │                                            applyPatchTool        │
   │  Sessions              Tracing             computerTool          │
   │  ────────              ──────────          codeInterpreterTool   │
   │  MemorySession         withTrace          fileSearchTool         │
   │  OpenAIConv...Session  createAgentSpan    imageGenerationTool    │
   │  SQLiteSession         createHandoffSpan  toolSearchTool         │
   │  custom: SessionABC    add_trace_processor mcp:                  │
   │                                            MCPServerStdio        │
   │                                            MCPServerSSE          │
   │                                            MCPServerStreamableHttp│
   └──────────────────────────────────────────────────────────────────┘

                              agents.sandbox
   ┌──────────────────────────────────────────────────────────────────┐
   │  Workspace             Capabilities       Providers              │
   │  ─────────             ─────────────     ─────────────           │
   │  Manifest              Filesystem()      E2BSandboxClient        │
   │    File / Dir          Shell()           ModalSandboxClient      │
   │    LocalFile/Dir       Skills()          DaytonaSandboxClient    │
   │    GitRepo             Memory()          VercelSandboxClient     │
   │    S3Mount             Compaction()      CloudflareSandboxClient │
   │    GCSMount                              RunloopSandboxClient    │
   │    R2Mount             Composition       BlaxelSandboxClient     │
   │    AzureBlobMount      ───────────       DockerSandboxClient     │
   │  SandboxAgent          SandboxAgent(     UnixLocalSandboxClient  │
   │    (Agent + Manifest    capabilities=,   custom: SandboxClient   │
   │     + Capabilities      sandbox_client=,                         │
   │     + sandbox_client)   manifest=)                               │
   └──────────────────────────────────────────────────────────────────┘
```

### 12.3 Deployment topology — Codex Web

```
   ┌─ chatgpt.com/codex (App Server) ─────────────────────────────────┐
   │                                                                  │
   │   GitHub OAuth ────► Repo metadata cache                         │
   │                                                                  │
   │   Task queue ──┬────► Cloud worker pool (multi-tenant)           │
   │                │                                                 │
   │                │     ┌─ codex-universal container ────────────┐  │
   │                ├────►│  setup phase (network ON, secrets ON)  │  │
   │                │     │  agent phase (network OFF, secrets OFF)│  │
   │                │     │  codex exec (Codex CLI core, Rust)     │  │
   │                │     │  workspace/ ← git checkout @ ref       │  │
   │                │     └────────────────────────────────────────┘  │
   │                │              │                                  │
   │                │              ▼ on completion                    │
   │                │     git push branch + open PR via GitHub API    │
   │                │                                                 │
   │                └────► Container cache (12h TTL)                  │
   │                       (snapshot/rehydrate for follow-ups)        │
   └──────────────────────────────────────────────────────────────────┘
```

## 13. What's Public vs What's Inferred

| Claim | Status | Source |
|---|---|---|
| Harness/Sandbox split as core architecture | **[PUBLIC]** | OpenAI blog post April 2026; coverage in TechCrunch, HelpNetSecurity, blockchain.news |
| 8 first-class sandbox providers + Docker + Unix-local | **[PUBLIC]** | Sandbox Agents docs |
| Manifest with typed entry union (File, GitRepo, S3Mount, etc.) | **[PUBLIC]** | Sandbox Agents docs |
| Workspace-relative path enforcement, no `..` | **[PUBLIC]** | Sandbox Agents docs (verbatim) |
| Three state surfaces: `RunState`, `session_state`, `snapshot` | **[PUBLIC]** | Sandbox Agents docs (verbatim) |
| Resolution order: live → RunState → session_state → fresh | **[PUBLIC]** | Sandbox Agents docs (verbatim) |
| Periodic checkpointing on failure → restore in new container | **[PUBLIC, paraphrased]** | Coverage articles citing OpenAI blog |
| Credentials in harness, not sandbox | **[PUBLIC]** | OpenAI blog post + coverage; Codex cloud-env docs (secrets stripped) |
| Capabilities: Filesystem, Shell, Skills, Memory, Compaction | **[PUBLIC]** | Sandbox Agents docs |
| Workspace memory layout (`workspace/memories/...`) | **[PUBLIC]** | Sandbox Agents docs (verbatim path layout) |
| `apply_patch` as hosted tool with V4A diff format | **[PUBLIC]** | apply_patch tool guide |
| AGENTS.md hierarchy + AGENTS.override.md + 32 KiB cap | **[PUBLIC]** | Codex AGENTS.md guide |
| Skills directory format (`SKILL.md` + scripts/references/assets) | **[PUBLIC]** | Codex Skills docs |
| MCP transports: Stdio, SSE, StreamableHttp | **[PUBLIC]** | Agents JS tools guide |
| Codex CLI sandbox: Seatbelt / bubblewrap+seccomp / Win sandbox | **[PUBLIC]** | Codex sandboxing docs |
| Codex CLI three modes: read-only / workspace-write / danger | **[PUBLIC]** | Codex sandboxing docs (verbatim) |
| Codex Web container image `universal`, 12h cache | **[PUBLIC]** | Codex cloud env docs (verbatim) |
| Codex Web: setup-phase network ON, agent-phase network OFF | **[PUBLIC]** | Codex cloud env docs (verbatim) |
| Codex Web: secrets stripped before agent phase | **[PUBLIC]** | Codex cloud env docs (verbatim) |
| Codex MCP server (`codex` + `codex-reply` tools, threadId) | **[PUBLIC]** | "Use Codex with Agents SDK" guide |
| TS support "planned for a future release" (Py-first launch) | **[PUBLIC]** | OpenAI blog post April 2026 |
| Tracing: 25+ third-party processors | **[PUBLIC]** | Agents Python tracing guide |
| Manifest is a programmatic data structure, not a YAML/TOML file | **[INFERRED]** | Implied by code samples in docs; no standalone schema published |
| `RunState` is JSON-serializable | **[INFERRED]** | Implied by `state=` parameter on `Runner.run` |
| Snapshot/rehydrate is provider-implemented, SDK-abstracted | **[INFERRED]** | Implied by per-provider client interface |
| Codex Web uses `codex exec` core internally | **[INFERRED]** | CLI exposes `codex exec`; cloud described as "running Codex"; not architecturally confirmed |
| Schema versioning via Python/TS package version | **[SPECULATION]** | No public schema-version document |
| OAuth/connectors framework (à la Anthropic Connectors) | **[SPECULATION]** | Not present; pattern is "use MCP servers" |
| Cross-region resume primitive | **[SPECULATION]** | Not described; would require manual Manifest+state+snapshot copy |

## 14. Implications for agent-express Design

### What we anchor on (PUBLIC, safe to align with OpenAI patterns)

1. **Three-tier tool taxonomy is the right shape**: hosted / function / MCP. Our existing `tools.function()` + `tools.mcp()` is already aligned. We should add a thin "hosted" namespace for built-in tools (web search, file search) so the conceptual model matches both stacks.
2. **`apply_patch` belongs as a first-class tool** if/when we add coding-agent capabilities. V4A diff format is the de-facto standard, and matching it gets us interoperability with both OpenAI and Codex-trained models.
3. **AGENTS.md is the open standard**, not CLAUDE.md or any framework-specific format. Use AGENTS.md for our `dev.console()` and any future "agent project" template. This is a cross-vendor convention with OpenAI/Google/Anthropic alignment.
4. **State must be three surfaces, not one event log** — even if we keep an event log internally:
   - **RunState** = harness-side serializable state (we have this implicit in `SessionState`)
   - **session_state** = live sandbox session handle (currently absent — sandboxing is out of scope for v0.4 but the abstraction slot should exist)
   - **snapshot** = workspace contents for fresh-container resume (also out of scope but slot exists)
5. **Pluggable sandbox providers as first-class** — when we ship sandboxing, follow OpenAI's pattern: a `SandboxClient` interface + first-class implementations for E2B/Modal/Daytona/Docker. Don't try to be a sandbox vendor.
6. **Manifest as data, not config file** — declarative TS object passed to the agent, validated at construction. Workspace-relative path invariant. Mount taxonomy with typed entries.
7. **Snapshot/rehydrate as the durability primitive** — `agent.run({ state: prior.state })` pattern. We already have `Session.run` returning state; we should formalise the resume contract.
8. **MCP is the canonical extension surface for credentialed services**. We have `tools.mcp()`; keep it central.
9. **Tracing as a separate system**, not woven into the event log. Our `observe.traces()` (OTel) is correctly separated.
10. **`Handoff` as a typed primitive** with its own run-item type and tracing span — *if* we add multi-agent. Don't model it as an emergent property the way Anthropic does. Type safety wins.

### What conflicts with Anthropic-pattern alignment

1. **Anthropic's "everything is an event in a log" vs. OpenAI's "three explicit state surfaces"** — these are different mental models. If we want a unified core, the OpenAI three-surface model is more practical for resumable agents (clearer recovery semantics) but the Anthropic event-log model is cleaner for replay/audit/forking. **Recommendation**: internally keep an append-only event log (Anthropic-style), expose a three-surface API (OpenAI-style). Best of both.
2. **OpenAI's typed tool taxonomy vs. Anthropic's uniform `execute(name, input)`** — these are inverted. **Recommendation**: typed at the top (`tools.function`, `tools.mcp`, `tools.hosted`), uniform at the bottom (single dispatch verb in the executor). This is what we already do.
3. **Naming**: Anthropic says "Brain"; OpenAI says "Harness". Both are jargon. **Recommendation**: stick with our existing `Agent` / `Session` / `Middleware` — they're orthogonal to both vendors.

### What we deliberately diverge from

1. **No "model-native harness"**. We're explicitly multi-vendor (anthropic, openai, ai sdk providers). We can't ship `apply_patch` as the model's training distribution because we don't own the training. We *can* ship `apply_patch` as an OPTIONAL middleware that's enabled when the user picks an OpenAI/Codex model.
2. **No proprietary Manifest format yet**. v0.4 stays in-process; sandboxing is v0.5 server scope. When we add sandboxing, our Manifest equivalent should be TypeScript-typed (matching OpenAI's structural style) and zod-schema'd (so it can validate at edge).
3. **No first-party hosted tools**. We don't have hosted infrastructure to back `web_search` etc. — we wrap third-party (`search-brave`, `search-tavily`, `search-exa`). This is a deliberate "framework, not platform" choice and contradicts OpenAI's hosted-tool stance.
4. **Conversations API equivalent is out of scope**. Our `session-openai` package wraps it for users who want it, but our default is `session-sqlite` / `session-redis` / `session-postgres` — same shape, different storage.
5. **Stay middleware-shaped, not class-shaped**. OpenAI's `Agent({ tools, handoffs, guardrails })` is a config object with named slots. Anthropic's `wake/execute/getEvents` is a procedural surface. Our `agent.use(...)` is a middleware chain. The middleware shape lets users compose arbitrarily without us needing to add a named slot for every primitive (`approvals?`, `memory?`, `compaction?`, `tracing?`). This is our actual differentiator.

### Concrete v0.4 / v0.5 action items

- **v0.4**: align state-key naming in our middleware namespaces with OpenAI's three-surface model. Document `ctx.state` as the equivalent of `RunState`, and reserve naming room for `session_state` (sandbox handle) and `snapshot` (workspace) for v0.5.
- **v0.4**: add a `tools.applyPatch()` middleware that exposes `apply_patch` to OpenAI/Codex-compatible models when used. Accept V4A diff format. Out-of-the-box safe-mode (writes only inside a configured workspace).
- **v0.4**: support AGENTS.md auto-discovery in `dev.console()` and starter templates — read project-root + walk-down hierarchy, concatenate, cap at 32 KiB. Reuse Codex's exact convention so users can move between tools without re-authoring.
- **v0.4**: document the resumability contract — `Session.run(input, { state })` is the resume primitive, mirroring `Runner.run(agent, prompt, state=)`.
- **v0.5 (Go server)**: design `SandboxClient` interface upfront. First implementations: Docker (local dev), E2B (cloud). Match OpenAI's Manifest shape (typed entries, workspace-relative invariant, mount taxonomy).
- **v0.5**: surface three-surface state in HTTP: `GET /sessions/:id/state` (RunState), `POST /sessions/:id/snapshot` (workspace snapshot), `POST /sessions/:id/attach` (resume from session_state if alive).
- **v0.5**: ship a thin `tools.codex()` MCP wrapper that lets agent-express agents delegate to a `codex mcp-server` process — same integration pattern OpenAI documents in `Use Codex with the Agents SDK`.

## 15. Source Citations

**Primary OpenAI sources**:
- [The next evolution of the Agents SDK — OpenAI](https://openai.com/index/the-next-evolution-of-the-agents-sdk/) — primary blog post (April 2026)
- [Agents SDK overview — OpenAI Developers](https://developers.openai.com/api/docs/guides/agents)
- [Sandbox Agents — OpenAI Developers](https://developers.openai.com/api/docs/guides/agents/sandboxes)
- [apply_patch tool — OpenAI Developers](https://developers.openai.com/api/docs/guides/tools-apply-patch)
- [OpenAI Agents JS SDK home](https://openai.github.io/openai-agents-js/)
- [Tools guide — Agents JS](https://openai.github.io/openai-agents-js/guides/tools/)
- [Handoffs guide — Agents JS](https://openai.github.io/openai-agents-js/guides/handoffs/)
- [OpenAI Agents Python home](https://openai.github.io/openai-agents-python/)
- [Sessions — Agents Python](https://openai.github.io/openai-agents-python/sessions/)
- [Tracing — Agents Python](https://openai.github.io/openai-agents-python/tracing/)
- [openai/openai-agents-js GitHub](https://github.com/openai/openai-agents-js)

**Codex sources**:
- [openai/codex GitHub](https://github.com/openai/codex)
- [Codex sandboxing — OpenAI Developers](https://developers.openai.com/codex/concepts/sandboxing)
- [Codex agent approvals & security — OpenAI Developers](https://developers.openai.com/codex/agent-approvals-security)
- [Codex Web (cloud) — OpenAI Developers](https://developers.openai.com/codex/cloud)
- [Codex cloud environments — OpenAI Developers](https://developers.openai.com/codex/cloud/environments)
- [AGENTS.md guide — OpenAI Developers](https://developers.openai.com/codex/guides/agents-md)
- [Agent Skills — OpenAI Developers](https://developers.openai.com/codex/skills)
- [Use Codex with the Agents SDK — OpenAI Developers](https://developers.openai.com/codex/guides/agents-sdk)

**Coverage / cross-check (paraphrased quotes only)**:
- [OpenAI updates Agents SDK, adds sandbox — TechCrunch](https://techcrunch.com/2026/04/15/openai-updates-its-agents-sdk-to-help-enterprises-build-safer-more-capable-agents/)
- [OpenAI Agents SDK harness and sandbox — Help Net Security](https://www.helpnetsecurity.com/2026/04/16/openai-agents-sdk-harness-and-sandbox-update/)
- [Sandbox Execution and Model-Native Harness — blockchain.news](https://blockchain.news/news/openai-agents-sdk-sandbox-execution-model-native-harness)
- [OpenAI Agents SDK April 2026: Sandbox, Harness — wowhow.cloud](https://wowhow.cloud/blogs/openai-agents-sdk-sandbox-harness-april-2026)
- [Indie Maker's Practical Guide April 2026 — shareuhack.com](https://www.shareuhack.com/en/posts/openai-agents-sdk-indie-maker-guide-2026)

**Comparison source**:
- [Choosing your agent harness — towardsai (via medium)](https://pub.towardsai.net/choosing-your-agent-harness-an-architectural-comparison-of-claude-managed-agents-langchain-deep-a0762804ec07) — could not fetch directly (auth-walled redirect to Medium); referenced from other coverage and prior research only.

**Companion document**:
- [/Users/vvkuz/projects/agent-express/docs/research/anthropic-managed-agents.md](/Users/vvkuz/projects/agent-express/docs/research/anthropic-managed-agents.md) — paired Anthropic reference

---

**Note on the primary OpenAI blog post**: the canonical URL `openai.com/index/the-next-evolution-of-the-agents-sdk/` returned HTTP 403 to fetch attempts (both with and without trailing slash). The architectural claims attributed to it are reconstructed from independent press coverage of the same announcement (TechCrunch, Help Net Security, blockchain.news, wowhow, shareuhack), the official Sandbox Agents documentation page, and the SDK source/docs themselves — all of which carry the same vocabulary (model-native harness, manifest, snapshot/rehydrate, durable execution, separation of harness and compute). Any quote attributed to the blog post in this document was found verbatim in at least one of those secondary sources echoing the announcement.
