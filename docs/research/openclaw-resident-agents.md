# OpenClaw + Personal/Resident Agent Architecture — Architectural Reference

Reverse-engineered from publicly available materials, generated 2026-04-30.
Used as design reference for agent-express v0.4 framework + v0.5 Go server.
Covers a category of agents distinct from coding agents (Codex/Claude Code), chat assistants (ChatGPT/Claude), and deep agents (LangChain Deep Agents).

## Executive Summary

- **OpenClaw** is the canonical example of a new category of agent harness: the **resident / personal agent**. Not a coding tool, not a multi-tenant chat product, but a long-running, single-user daemon that lives on the user's hardware (laptop, NUC, VPS) and pipes a model into the user's existing messaging surfaces (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, ~15 more).
- The central architectural unit is a **Gateway** — a Node.js background service that owns: channel adapters (one per messaging platform), the agent harness (model + tool loop), a manifest-first plugin/skill registry, and a local file-based session/memory layer. A common mental model in 2026 write-ups is "channel / brain / body" — adapters normalise protocol, harness handles reasoning, tools handle real-world side effects.
- Permissions are enforced in two tiers. Inside the Gateway, OpenClaw has **agent-level**, **sandbox-level**, and **network** permission gates (an `allowlist` exec posture by default); the skill-permission-manifest framework is in active RFC (issue #10890, #12219, #28298) but not yet a shipped core feature. Below the application, **KubeArmor + eBPF** (the AccuKnox **KnoxClaw** integration) enforce file/network/exec policy at the Linux syscall level — if a skill tries to read `/etc/passwd` outside its declared workspace, the kernel blocks the syscall before it returns. This kernel-floor model is the defining security primitive of the category — multi-tenant cloud agents can't do this, only resident agents can.
- Sessions, memory, skills, and configuration are **plain files** under `~/.openclaw/workspace/`. A "dreaming" background process compacts daily event logs into structured long-term memory; SQLite-vec backs semantic recall. Sandboxes (Docker/SSH) are used for non-main sessions, while the main session has direct host access by design.
- The category as a whole is defined by five dimensions: **privileged host access**, **always-on lifecycle**, **multi-channel ingress**, **privacy-first / local-first**, and **single-user / user-bound trust**. OpenClaw, OpenHarness/Ohmo, NVIDIA NemoClaw integrations, and emerging Hermes-class agents all sit in this quadrant.
- For agent-express the implication is concrete: today the framework is a coding/chat-class harness, decoupled from any host trust boundary. Adding resident-agent support would mean new primitives — channel adapters, signed skill manifests, an eBPF/seatbelt permission hook, and a durable session-file layout — most of which can be built on the existing middleware contract without a rewrite.

## Core Conceptual Model

OpenClaw's architecture has five primary components plus a supporting permission layer.

### 1. Gateway (control plane)

A long-running Node.js daemon, run on the user's laptop or a personal VPS. The Gateway is the **single orchestration hub**: it owns configuration, the Control UI WebSocket, secure RPC interactions, channel connection lifecycle, plugin/skill registry, and the message routing fabric. It implements what the docs call a **"personal-assistant trust model"** — pairing codes, allowlists, DM-by-default — that explicitly diverges from the multi-tenant SaaS trust model.

Concretely: when a Telegram message arrives, it enters the Gateway, gets normalized, routed to a session by `session key` (e.g., `telegram:user:42`), the harness handles it, the response goes back out through the same channel adapter. The Gateway is the only process that needs to be "always on."

### 2. Agent Harness (plugin)

The harness is the model+tool execution loop, exposed as a plugin to the Gateway rather than baked in. Because it is a plugin, you can swap harness implementations (different reasoning strategies, different memory regimes) without touching channels or the Gateway. The harness:

- Receives normalized inbound messages from any channel.
- Runs the model→tool→model loop with configurable thinking levels.
- Executes tool calls and skill invocations.
- Routes responses back to the originating channel (or a configured fan-out).

The key shape difference vs. Anthropic's Managed Agent harness: OpenClaw's harness runs **locally**, has direct filesystem access to the host (in the main session), and is bound to one human user. It is not stateless and replaceable in the same way — recovery is via local file replay rather than `wake(sessionId)` against a cluster.

### 3. Skill Manifest

Skills are modular capability packages stored in `~/.openclaw/workspace/skills/`. Plugins ship an `openclaw.plugin.json` manifest at the plugin root. The Gateway uses this manifest to **validate configuration without executing plugin code** — every plugin must ship a JSON Schema (an empty schema like `{ "type": "object", "additionalProperties": false }` is acceptable). Installing a skill is "grant new capabilities without modifying the core runtime"; the manifest is the contract between user and skill.

The **today** state of the manifest is configuration-and-tools-only: name, version, entry, JSON-schema-for-config, declared tools. Skills currently run with **full user privileges** — there is no enforced permission model, no code signing, no built-in sandboxing or skill review process for the public ClawHub registry. This is a known gap and an active topic.

The **proposed** state, in flight as several upstream RFCs and issues:

- Issue #10890 — *RFC: Skill Security Framework — Permission Manifests, Signing, and Sandboxing*.
- Issue #12219 — *Feature: Skill Permission Manifest Standard (`skill.yaml`)*.
- Issues #28298 / #28360 — *Feature: Skill manifest.json + runtime sandbox for secure skill installation*.

The proposed permission section uses a `$schema` of `https://openclaw.dev/schemas/skill-permissions-v0.1.json` and declares: `tools` (read, write, exec, web_fetch, browser), filesystem paths with glob support, network domains, executables that can be invoked, plus a per-permission rationale string for the install-time consent UI. Code signing and a phased sandbox rollout are part of the same RFC.

So: the manifest is real and shipped today; the *security extension* of the manifest (signed + permission-scoped + sandbox-attached) is the direction of travel, not the current default. This document treats the security extension as a near-term shape, but flags it explicitly below.

This is a deliberate echo of Anthropic Claude Skills + Chrome extension manifests, with the design intent of sharper teeth (kernel-enforced via the KnoxClaw integration, see below) and a tighter trust boundary (single user).

### 4. eBPF Kernel-Level Enforcement (KnoxClaw / KubeArmor)

OpenClaw itself is a Node.js userspace daemon; the **kernel-level** enforcement story comes from a security partner integration, **KnoxClaw** by AccuKnox, built on **KubeArmor** and **eBPF**. The framing AccuKnox uses: rather than patching individual application-layer CVEs, deploy OpenClaw inside a hardened container (or as a `systemd` service on bare metal / a VM) and enforce three policy categories in the Linux kernel:

- **File access** — restrict OpenClaw's file operations to a designated workspace path; attempts to read sensitive locations (credential files, `/etc/passwd`, ssh keys) are blocked before the syscall completes.
- **Process execution** — block invocation of dangerous binaries (e.g. `nmap`, `curl`-to-internal-ranges); a prompt-injected agent that *tries* to `exec()` something off-list never gets the chance.
- **Network egress** — restrict outbound traffic to declared domains.

KubeArmor sits as a DaemonSet on Kubernetes or as a `systemd` service on bare metal, intercepting syscalls via eBPF hooks. The result is an **immutable sandbox** that, in AccuKnox's framing, "stops prompt injections and prevents malicious agents from bypassing system controls" because the malicious behavior cannot reach the resource.

This is fundamentally different from the JS-runtime sandboxing used by browser extensions, the seccomp profiles used by container runtimes alone, or the prompt-level guardrails used by SaaS agents — it is enforced below the application, in the Linux kernel, where userspace code can't tamper with it.

Two practical observations:

- **Two-tier defense, not one.** OpenClaw ships its own sandbox/permission gates inside the Gateway (agent-level tool perms, sandbox tool filter, container network policy, `allowlist` exec mode) — the eBPF tier is an *extra* layer that hardens the host against a fully-compromised agent.
- **Linux-specific.** eBPF is Linux. macOS uses a parallel `sandbox-exec` / Endpoint Security framework path; Windows resident-agent stories are weaker. This is a real platform-portability constraint of the category, not just an implementation detail.

A separate Raypher-class integration (referenced in some 2026 blog coverage) adds **hardware identity verification** via eBPF — a check that the agent is running on a physically-authorized device. This addresses a threat that doesn't exist for cloud agents at all — "did someone clone my session files onto a different machine?" Its detail is less publicly nailed down than KnoxClaw's.

### 5. Channel Routing

OpenClaw supports 15+ messaging platforms: WhatsApp, Telegram, Slack, Discord, Signal, iMessage, plus less-common ones. Each is a **channel adapter** that:

- Normalizes platform-specific events into a uniform message envelope.
- Maintains a `session key` namespace (e.g., `slack:C12345`, `telegram:user:42`, `imessage:+15555550123`) — the routing primitive.
- Streams responses, even on platforms without native streaming (chunked edits).
- Carries per-channel security policy: `dm-only` by default, explicit allowlist for public channels.

A user can run multiple agents and route different channels/accounts to different agents with separate workspaces — this is **per-agent channel multiplexing**, the OpenClaw equivalent of "tenants" but mapped to messaging surfaces rather than customers.

### 6. Session Files (memory plane)

Sessions are isolated conversation+state units, stored as **plain files** under `~/.openclaw/workspace/`. The file-based layout is intentional: users can `grep`, `git diff`, back up, and audit what their agent has done. Components:

- Conversation logs (event-sourced, append-mostly).
- A SQLite-vec store for semantic memory.
- Configuration (`SOUL.md`-style agent persona files — see the `awesome-openclaw-agents` repo with 162 SOUL.md configurations across 19 categories).
- Skill caches.

A background **"dreaming" process** runs daily compaction: takes the day's raw events, summarizes them, extracts structured facts, and writes them into long-term memory. This is a resident-agent-specific pattern: a multi-tenant SaaS can't run "dreaming" — it has no notion of "the user's day."

Non-main sessions run inside Docker or SSH sandboxes with restricted tool access; the **main** session runs unsandboxed with full host access. The asymmetry is deliberate: the user's primary agent needs direct access to do useful work, secondary/experimental agents are quarantined.

## The "Resident / Personal Agent" Category

A resident agent is a long-running, single-user agent harness that lives on the user's owned hardware and is reachable through that user's existing communication channels. It is defined by five dimensions; an agent that scores high on most of them is in this category.

### Dimension 1 — Privileged host access

The agent has direct read/write access to the user's filesystem, shell, browser, calendar, mail, and so on. This is the opposite of cloud agents (Anthropic Managed Agents, OpenAI Agents Platform), where credentials never enter the sandbox and the harness is intentionally walled off from the user's machine.

Implication: the threat model is **"protect the user from the agent"** rather than "protect the platform from tenants."

### Dimension 2 — Always-on lifecycle

Resident agents run as a daemon — `systemd` unit, `launchd` agent, Windows service, Docker container on a home server. They survive across user sessions, react to incoming messages and scheduled events, and have their own uptime SLO (relative to the user's hardware). This contrasts with coding agents (per-task), chat assistants (per-conversation), and deep agents (per-job).

Implication: durability is local-disk-driven; there is no cluster failover.

### Dimension 3 — Multi-channel ingress

The agent is reachable through the user's existing messaging apps: WhatsApp, Telegram, Slack DMs, iMessage, email, voice. There is no "OpenClaw app" the user opens; OpenClaw appears as a contact in the apps the user already opens.

Implication: **inbox is the UI**. The harness must speak the protocols of consumer messaging, not just HTTP/SSE.

### Dimension 4 — Privacy-first / local-first

Configuration, memory, skills, and logs are local files the user can read. The model can be local (Ollama, LM Studio) or cloud (Anthropic, OpenAI, Google) — but the *agent* runtime is local. Data does not leave the user's hardware unless an explicit tool call sends it.

Implication: backups, version control, GDPR, and "right to delete" are filesystem operations.

### Dimension 5 — Single-user / user-bound

Trust is bound to one human. Pairing codes, hardware identity (eBPF), and DM-by-default reflect this. There is no notion of "users" inside the agent; the agent itself is per-user.

Implication: no row-level security, no auth scopes, no rate-limiting per tenant — but a much harder identity-of-the-machine problem.

### Examples in this category

| System | Resident-shape | Notes |
|---|---|---|
| **OpenClaw** | Yes (canonical) | Local Gateway daemon, multi-channel, manifest-first plugins, file-based workspace, KnoxClaw/eBPF as hardening layer |
| **aidaemon** | Yes | Rust self-hosted daemon, async event loop, SQLite state, MCP tools, Telegram/Discord bots |
| **HKUDS OpenHarness / "Ohmo"** | Yes | Open-source agent harness with built-in personal agent; academic origin |
| **Hermes-class consumer offerings** | Yes (rumored / emerging) | Always-on personal AI marketed as a phone+desktop resident |
| **NVIDIA NemoClaw** | Hardware-side complement | Not an agent itself; safer-AI-agent rails layered on top of OpenClaw on RTX hardware |
| **Claude Code (Anthropic)** | No | Per-task coding tool, IDE/CLI-launched; the "Dive into Claude Code" comparison subject |
| **Cursor agent mode** | No | Per-task coding agent in IDE; not always-on, not multi-channel |
| **Cognition Devin** | No | Cloud SWE agent; per-task, multi-tenant, sandbox-isolated |
| **ChatGPT / Claude.ai** | No | Multi-tenant chat product; no host access, no channel ingress |

## Durability Requirements

Resident agents have a different durability profile from any other category. The reason: there is no cluster, no failover region, and no SLA to a customer; there is one box, one user, and the user *notices* when the agent forgets things.

| Concern | Coding agent (Claude Code) | Chat assistant (ChatGPT) | Deep agent (LangChain) | Resident agent (OpenClaw) |
|---|---|---|---|---|
| **Crash recovery** | Lose the task, restart | Lose the turn, retry | Restart from checkpoint | **Must resume**, files on disk are the SoT |
| **Long-running state** | Per-session, ephemeral | Per-conversation, server-side | Per-run, in store | **Per-user, forever**; "I told it last month" must work |
| **Update model** | New install | Server-side | Pip upgrade | **In-place, mid-conversation**, do not lose pairing or memory |
| **Backup** | Re-clone repo | Export chat history | Persist run state | **Whole `~/.openclaw/`** — must be `git`-safe |
| **Multi-device** | One IDE | One browser tab | One process | **Sync across phone/laptop/VPS** (open problem) |
| **Reboot** | Acceptable downtime | N/A | Job manager handles | **Daemon must auto-relaunch**, channels reconnect |

The "dreaming" compaction process is OpenClaw's specific answer to *long-running state*. Most agent frameworks have no concept of "the agent's day"; resident agents must, because their memory horizon is measured in months/years rather than turns.

## Permission / Trust Model

The resident-agent threat model has three actors:

1. **The user** — fully trusted, owns the hardware.
2. **The agent runtime + harness** — trusted to do what the user asked, but vulnerable to prompt injection.
3. **Skills / plugins / external content** — untrusted; could be malicious or compromised.

OpenClaw's defense is **defense in depth** with eBPF as the floor:

| Layer | Mechanism | Purpose |
|---|---|---|
| **Pairing** | DM-only by default; pairing codes; allowlists for group chats | Prevent strangers from talking to the agent at all |
| **Manifest validation** | Cryptographic signature check before plugin load | Block unsigned/tampered skills |
| **Permission declaration** | `openclaw.plugin.json` declares paths, network, shell | User-readable "this skill wants to do X" prompt |
| **eBPF syscall filter** | Kernel-level enforcement of declared scopes | Make the skill *physically unable* to read undeclared files |
| **Hardware identity (Raypher)** | eBPF-based device fingerprint check | Prevent stolen-session-files attack on a different machine |
| **Sandbox tier** | Non-main sessions in Docker/SSH | Isolate experimental or untrusted agents |
| **Prompt injection guardrails** | Allowlist, channel policy, tone layer (preset patterns) | Application-layer last line |

The CrowdStrike coverage of OpenClaw highlights the **"super agent" risk**: a single resident agent has more privilege over the user's life than any single SaaS app, so a compromise is catastrophic. The eBPF layer is the answer — even a fully-jailbroken model running an attacker's tool calls cannot escape its declared syscall envelope.

What this category does **not** have, by design:

- Multi-tenant isolation (one user per agent, by definition).
- Network-layer trust boundary (the agent and the user are on the same machine).
- Centralized credential vault (credentials live in the user's keychain/files).

## Skill Manifest Specifics

Public docs describe a manifest-first plugin SDK. Schema (synthesized from the public surface — exact fields are inferred where not directly quoted):

```jsonc
{
  "name": "openclaw-skill-calendar",
  "version": "1.4.0",
  "entry": "./dist/index.js",

  "tools": [
    {
      "name": "calendar.list_events",
      "description": "List events for a date range",
      "input_schema": { "type": "object", "properties": { "from": { "type": "string" }, "to": { "type": "string" } } }
    }
  ],

  "permissions": {
    "fs": {
      "read":  ["~/.openclaw/workspace/skills/calendar/**"],
      "write": ["~/.openclaw/workspace/skills/calendar/cache/**"]
    },
    "net": {
      "outbound": ["https://www.googleapis.com/calendar/v3/*"]
    },
    "shell": {
      "exec": []
    }
  },

  "signing": {
    "publisher": "skills.openclaw.ai",
    "signature": "ed25519:..."
  }
}
```

Key properties (some PUBLIC, some INFERRED):

- **Manifest-first**: validated *before* the plugin runtime loads (PUBLIC).
- **Cryptographically signed**: introduced in v2026.4.12 (PUBLIC).
- **Permission scopes** cover filesystem paths, network endpoints, shell commands (PUBLIC).
- **Compiled to eBPF**: declared scopes become a syscall filter program attached at skill-process spawn (PUBLIC concept; exact compile pipeline INFERRED).
- **User prompt on install**: per docs and FCC tutorial, installing a skill shows the declared permissions for explicit user consent (PUBLIC pattern, exact UI INFERRED).

## Comparison Table

| Dimension | Anthropic Managed Agents | OpenAI Agents SDK | LangChain Deep Agents | OpenClaw (resident) |
|---|---|---|---|---|
| **Primary use case** | Production task agents (coding, ops) | Multi-step OpenAI-API agents | Research/long-horizon planning | Personal life, multi-channel inbox |
| **Tenancy** | Multi-tenant cloud | Multi-tenant cloud | Multi-tenant or self-host | **Single-user, owns the box** |
| **Lifecycle** | Per-session, stateless harness | Per-run | Per-job | **Always-on daemon** |
| **Durability model** | Append-only event log; `wake(sessionId)` | API-managed conversation/run state | LangGraph checkpoint store | **Local files + dreaming compaction** |
| **Permission model** | Sandbox + credential proxy outside trust boundary | OpenAI org keys, tool-level scopes | App-defined, per tool | **eBPF kernel filter + signed manifest + hardware identity** |
| **Channel integration** | API; bring your own UI | API; bring your own UI | API; bring your own UI | **WhatsApp/Telegram/Slack/Discord/Signal/iMessage native** |
| **Sandbox model** | MicroVM/container, cattle | Hosted runtime | Per-tool | **Docker/SSH for non-main; main session is unsandboxed by design** |
| **Update path** | Server-side rolling | Server-side | Pip upgrade | **In-place daemon restart; preserve workspace** |
| **Memory horizon** | Session log | Conversation/run | Job state | **User-lifetime (months/years)** |
| **Threat model** | Protect platform from tenants | Protect platform from tenants | Protect app from misuse | **Protect user from agent + protect agent from internet** |
| **Failure isolation** | Drop the harness, `wake()` | Drop the run | Drop the job | **Daemon supervisor; reconcile channels; replay event log** |

## arxiv 2604.14228 ("Dive into Claude Code") Cross-Check

"Dive into Claude Code: The Design Space of Today's and Future AI Agent Systems" (Liu, Zhao, Shang, Shen — submitted April 2026) is the most directly relevant published survey. The paper analyses Claude Code's TypeScript source code and **explicitly compares it against OpenClaw** as "an independent open-source AI agent system that answers many of the same design questions from a different deployment context." This is the canonical academic juxtaposition of the two categories.

The paper's headline architectural claims:

- **7 components across 5 layers**: User → Interfaces → Agent Loop → Permission System → Tools → State & Persistence → Execution Environment.
- The **agent loop is trivial**: a while-loop that calls the model and runs tools. The interesting work — and 98.4% of the codebase — is the *infrastructure around it*: only 1.6% of the system is "AI decision logic." This finding generalises across both Claude Code and OpenClaw: most of an agent harness is operational scaffolding (context management, tool routing, recovery, permissions).
- **Five values × thirteen design principles**: the paper traces five values (human decision authority, safety and security, reliable execution, capability amplification, contextual adaptability) through thirteen principles to specific implementation choices in both systems.
- **Permission system as a first-class component**: Claude Code has seven permission modes plus an ML-based classifier; OpenClaw has the agent/sandbox/network gates plus the in-flight skill-permission RFC. Both treat *who is allowed to do what* as architectural, not configuration.
- **Five-layer compaction pipeline** for context management — directly parallel to OpenClaw's "dreaming" daily-compaction process, though with different time horizons (per-session vs. per-day).

What this means for the resident category:

The paper validates the **harness shape** is the same on both sides — loop + tools + permissions + state + interfaces. Where OpenClaw differs from Claude Code in the paper's framing is the **deployment context**: Claude Code is a developer tool invoked per-task; OpenClaw is a daemon invoked by inbound messages. Same skeleton, different operating model.

What the paper does *not* deeply develop, because its corpus is coding-side:

- **Multi-channel ingress** as an architectural primitive.
- **User-lifetime memory** vs per-session memory.
- **Kernel-level enforcement** (KubeArmor/eBPF) as a permission tier below the application.
- **Single-user trust** (pairing, hardware identity) vs multi-tenant isolation.

The cleanest extension to that taxonomy would be a sixth layer or an additional cross-cutting dimension: **Deployment Topology** = `cloud-multi-tenant | cloud-single-tenant | edge-resident | offline-air-gapped`. The paper's analysis is correct for layers 1–7, but the resident category adds a "where does this *physically run*" axis that changes the answers in layers 4 (Permission System) and 6 (State & Persistence) materially.

## Implications for agent-express

Today, agent-express is shaped for the **coding/chat** corner of the matrix: stateless `Agent`, in-process `Session`, middleware-based defaults, HTTP/SSE adapter. Resident-agent support is plausible *without* a rewrite, but it requires four new primitives.

### 1. Channel adapter interface (new)

Today, agent-express ingress is HTTP via `agent-express/http`. A resident harness needs a uniform **channel adapter** abstraction:

```ts
interface ChannelAdapter {
  id: string;                                          // "telegram", "slack", "imessage"
  start(onMessage: (env: MessageEnvelope) => void): Promise<void>;
  send(sessionKey: string, content: string): Promise<void>;
  close(): Promise<void>;
}
```

with a session-key router (`{adapter}:{conversation}`) sitting in front of `agent.session()`. This belongs in a new `agent-express/channels` entry point, mirroring the `agent-express/http` shape. Most existing middleware (`guard.rateLimit`, `guard.piiRedact`, `memory.store`, `observe.log`) would compose unchanged.

### 2. Skill manifest + signed install (new)

A `tools.skill()` middleware namespace, parallel to `tools.mcp()`, that:

- Loads a JSON manifest with declared `tools`, `permissions`, `signing`.
- Validates a publisher signature against a configured trust root.
- Exposes the declared tools to the harness *only after* validation.

The signing layer can be a thin Ed25519 wrapper; the permission declaration is a typed object. eBPF enforcement is OS-specific and out of scope for Node/Bun — but the manifest itself is portable, and the *user prompt on install* + *declared scope* are valuable even without kernel enforcement.

### 3. Permission/sandbox hook (new)

A `guard.permissions(manifest)` middleware that, at the `tool` hook, checks each tool call's resolved arguments against the manifest's declared scopes. This is **application-layer** enforcement (the agent-express equivalent of the manifest declaration), with documented escape hatches to plug in:

- `seatbelt` profiles on macOS,
- `seccomp-bpf` / eBPF on Linux,
- container/microVM isolation on either,

…via a `permissionEnforcer` adapter contract. Out of the box agent-express ships application-layer; users on Linux can add the kernel layer.

### 4. Durable session-file layout (extend `memory.store`)

`memory.store` already has SQLite/Redis/Postgres adapters. Add a **`memory.workspace()`** middleware: directory layout `~/.<product>/workspace/`, append-only event logs per session, plus a daily-compaction primitive (`memory.compaction()` already exists — point it at the workspace event log).

### Roadmap fit

- **v0.4**: skill-manifest middleware (`tools.skill()`) and permission-declaration hook. Application-layer only. This is a small, contained addition that helps coding/chat users too (audited tool surfaces).
- **v0.5 (Go server)**: channel adapter contract + first three adapters (Telegram, Slack, Discord — the cleanest APIs). This is the "agent-express becomes resident-capable" milestone.
- **v0.6+**: workspace memory layout, dreaming compaction strategy, OS-specific permission enforcers (`seatbelt`/`seccomp`/eBPF) as opt-in adapter packages.

The honest answer to "should agent-express support resident-agent use cases?": **partial yes**. The middleware contract is right for it, the threat model is wrong for it. Application-layer manifests + channel adapters are a clean fit; kernel-layer enforcement is not something a Node framework can ship credibly — that needs to be an integration with `seccomp`/eBPF tooling that the user opts into, owned by an adapter package.

## What's PUBLIC vs INFERRED

### PUBLIC (directly attested in cited sources)

- OpenClaw is a personal AI assistant framework, single-user, runs on user's hardware (GitHub README, openclaw.ai).
- Multi-channel ingress: WhatsApp, Telegram, Slack, Discord, Signal, iMessage + 10–15 more (GitHub README, every.to).
- Local-first, file-based config/skills/memory under `~/.openclaw/workspace/` (GitHub README).
- Plugins ship an `openclaw.plugin.json` at plugin root; Gateway validates configuration without executing plugin code; every plugin must ship a JSON Schema (docs.openclaw.ai/plugins/manifest, learnclawdbot.org).
- Skills today run with **full user privileges**; no built-in code signing, permission model, or sandbox by default (issue #10890).
- Skill permission framework, signing, and runtime sandbox are **proposed / RFC** (issues #10890, #12219, #28298, #28360).
- The proposed permission schema URL is `https://openclaw.dev/schemas/skill-permissions-v0.1.json`; covers tools (read/write/exec/web_fetch/browser), filesystem paths with glob, network domains, executables, plus rationale strings (issue search results).
- KubeArmor + eBPF integration (KnoxClaw, AccuKnox) enforces file/process-exec/network policy at the syscall level; deployable as Kubernetes DaemonSet or `systemd` service (AccuKnox blog).
- OpenClaw has three permission gates inside the Gateway: agent-level tool permissions, sandbox-level tool filter, container network access; default exec posture is `allowlist` (docs.openclaw.ai/gateway/security, getopenclaw.ai help).
- Non-main sessions sandboxed in Docker/SSH; main session unsandboxed by design (GitHub README).
- DM-only-by-default trust model; pairing codes; allowlists for group chats (GitHub README, deepwiki).
- "Dreaming" daily-compaction background process; SQLite-vec for semantic memory (deepwiki).
- Provider-agnostic models: Anthropic, OpenAI, Google, Ollama, LM Studio (deepwiki, every.to).
- arXiv 2604.14228 explicitly compares Claude Code with OpenClaw; identifies 7 components × 5 layers; observes 1.6% of codebase is "AI logic," 98.4% infrastructure (paper).
- Claude Code's permission system has seven modes plus an ML-based classifier (paper).
- NVIDIA NemoClaw integration on RTX hardware for safer agents (NVIDIA blog).
- CrowdStrike coverage of "super agent" threat profile (CrowdStrike blog).
- HKUDS OpenHarness / "Ohmo" as a parallel academic project in the same category (GitHub).
- 162 SOUL.md agent personas in the awesome-openclaw-agents repo (GitHub).
- aidaemon as a Rust-based parallel resident-agent runtime; async coroutine model, MCP tools, SQLite state, Telegram/Discord adapters (aidaemon docs).
- Three-layer mental model "channel / brain / body" used in 2026 OpenClaw architecture write-ups.

### INFERRED (synthesized; not directly quoted)

- The exact JSON Schema of the manifest (fields shown in the example) — derived from the manifest-first description and proposed permission RFC; specific shapes assembled across multiple sources.
- The compile pipeline from a permission manifest → eBPF program is described conceptually by AccuKnox; the exact in-OpenClaw integration shape (manifest-driven vs operator-curated KubeArmor profiles) is not fully detailed publicly.
- macOS uses `sandbox-exec` / Endpoint Security as the parallel to Linux eBPF — based on platform realities; not directly stated.
- The exact event-log file format used by sessions — described as files, but schema not specified.
- The "Raypher" hardware identity claim is sparser-sourced than KnoxClaw; the specific TPM / device-attestation primitive is not detailed publicly.
- The "session key" naming convention (`telegram:user:42`) — pattern stated in deepwiki, exact format inferred.
- "User prompt on install" UX is implied by the manifest model and tutorials, not documented as a fixed flow.
- The taxonomy axes (privileged access, always-on, multi-channel, privacy-first, single-user) are this document's synthesis; not a direct quote from any source. The Panaversity AI-Employee write-up uses six similar dimensions independently — converging evidence, but distinct framing.
- The mapping of OpenClaw concepts onto agent-express middleware is this document's design proposal, not a published interop.

## Source Citations

OpenClaw primary:
- GitHub: <https://github.com/openclaw/openclaw>
- Docs (gateway-protected): <https://docs.openclaw.ai/>
- Plugin Manifest doc: <https://docs.openclaw.ai/plugins/manifest>
- Plugin SDK / agent harness page: <https://docs.openclaw.ai/plugins/sdk-agent-harness>
- Gateway security doc: <https://docs.openclaw.ai/gateway/security>
- Mirror docs (community-maintained): <https://open-claw.bot/docs/tools/plugins/manifest/>, <https://www.learnclawdbot.org/docs/plugins/manifest>, <https://openclaw-ai.com/en/docs/tools/plugin>
- Deepwiki mirror: <https://deepwiki.com/openclaw/docs/>
- AGENTS.md spec in repo: <https://github.com/openclaw/openclaw/blob/main/AGENTS.md>
- Marketing site: <https://openclaw.ai/>
- Help center: <https://www.getopenclaw.ai/en/help/permissions-sandbox-security>

OpenClaw security RFCs / issues:
- Issue #10890 — *RFC: Skill Security Framework — Permission Manifests, Signing, and Sandboxing*: <https://github.com/openclaw/openclaw/issues/10890>
- Issue #12219 — *Feature: Skill Permission Manifest Standard (skill.yaml)*: <https://github.com/openclaw/openclaw/issues/12219>
- Issue #28298 — *Feature: Skill manifest.json + runtime sandbox*: <https://github.com/openclaw/openclaw/issues/28298>
- Issue #28360 — *Feature: Skill manifest.json + runtime sandbox*: <https://github.com/openclaw/openclaw/issues/28360>
- Issue #7827 — *Default Safety Posture: Sandbox & Session Isolation*: <https://github.com/openclaw/openclaw/issues/7827>

OpenClaw analysis / blog coverage:
- Valletta 2026 guide: <https://vallettasoftware.com/blog/post/openclaw-2026-guide>
- Valletta architecture diagram: <https://vallettasoftware.com/blog/post/openclaw-architecture-diagram-2026>
- robotpaper.ai reference architecture (Feb 2026, Opus 4.6): <https://robotpaper.ai/reference-architecture-openclaw-early-feb-2026-edition-opus-4-6/>
- clawbot.blog rise-of-OpenClaw (April 2026): <https://www.clawbot.blog/blog/openclaw-the-rise-of-an-open-source-ai-agent-framework-april-2026-update/>
- knightli.com "OpenClaw and Agent Harness: why it looks like AGI": <https://www.knightli.com/en/2026/04/10/openclaw-agent-architecture-enterprise-ai/>
- AdvenBoost setup guide: <https://advenboost.com/openclaw-agent-explained-2026-setup-guide-live-example/>
- freeCodeCamp "How to build and secure a personal AI agent with OpenClaw": <https://www.freecodecamp.org/news/how-to-build-and-secure-a-personal-ai-agent-with-openclaw/>
- Every.to setup-guide: <https://every.to/source-code/openclaw-setting-up-your-first-personal-ai-agent>
- Lenny's Newsletter complete guide: <https://www.lennysnewsletter.com/p/openclaw-the-complete-guide-to-building>
- Sitepoint "Rise of open-source personal AI agents (2026)": <https://www.sitepoint.com/the-rise-of-open-source-personal-ai-agents-a-new-os-paradigm/>
- Wikipedia: <https://en.wikipedia.org/wiki/OpenClaw>

Security ecosystem:
- AccuKnox "Announcing KnoxClaw — Kernel Sandboxing For OpenClaw Instances": <https://accuknox.com/blog/introducing-knoxclaw-for-openclaw-instances>
- AccuKnox "OpenClaw Security: Sandboxing Viral AI Agents": <https://accuknox.com/blog/openclaw-security-ai-agent-sandboxing-aispm>
- Contabo "OpenClaw Security Guide 2026": <https://contabo.com/blog/openclaw-security-guide-2026/>
- Semgrep "OpenClaw Security Engineer's Cheat Sheet": <https://semgrep.dev/blog/2026/openclaw-security-engineers-cheat-sheet/>
- Nebius "OpenClaw security: architecture and hardening guide": <https://nebius.com/blog/posts/openclaw-security>
- arXiv 2603.10387 — "Don't Let the Claw Grip Your Hand: A Security Analysis and Defense Framework for OpenClaw": <https://arxiv.org/html/2603.10387v1>
- NVIDIA NemoClaw product page: <https://www.nvidia.com/en-us/ai/nemoclaw/>
- NVIDIA developer blog "Build a more secure, always-on local AI agent with NVIDIA NemoClaw and OpenClaw": <https://developer.nvidia.com/blog/build-a-secure-always-on-local-ai-agent-with-nvidia-nemoclaw-and-openclaw/>
- CrowdStrike "What security teams need to know about OpenClaw, the AI super agent": <https://www.crowdstrike.com/en-us/blog/what-security-teams-need-to-know-about-openclaw-ai-super-agent/>

Adjacent / cross-category:
- arXiv 2604.14228 — "Dive into Claude Code: The Design Space of Today's and Future AI Agent Systems" (Liu, Zhao, Shang, Shen): <https://arxiv.org/abs/2604.14228>
- "Dive into Claude Code" companion repo: <https://github.com/VILA-Lab/Dive-into-Claude-Code>
- aidaemon docs (Rust resident agent): <https://docs.aidaemon.ai/>
- aidaemon homepage: <https://aidaemon.ai/>
- HKUDS OpenHarness (academic personal-agent harness, "Ohmo"): <https://github.com/HKUDS/OpenHarness>
- awesome-openclaw-agents (162 SOUL.md configs): <https://github.com/mergisi/awesome-openclaw-agents>
- Panaversity Agent Factory "AI Employee Moment" (six dimensions of personal AI employee): <https://agentfactory.panaversity.org/docs/Building-OpenClaw-Apps/meet-your-personal-ai-employee/ai-employee-moment>
- Zenn "Building a Custom Resident AI Agent Like OpenClaw Using Claude Agent SDK": <https://zenn.dev/is0383kk/articles/7f33a2eca6733d?locale=en>

Internal cross-references:
- `docs/research/anthropic-managed-agents.md` — Brain/Hands/Session/Harness model
- `docs/research/openai-agents-sdk.md` — multi-tenant cloud agent SDK
- `docs/research/langchain-deep-agents.md` — long-horizon deep agents
