---
title: Research References
audience: contributors
last-revised: 2026-05-07
---

# Research References

Reverse-engineering notes on adjacent agent frameworks. Each file extracts
the architectural primitives, the customization unit, and the trade-offs
made by that framework, then maps them to the agent-express position.
These are the inputs that shaped our design choices in
[`../design/`](../design/).

## Architectural references

| File | Subject | What it informs |
|------|---------|-----------------|
| [`anthropic-managed-agents.md`](anthropic-managed-agents.md) | Anthropic Managed Agents — Brain/Hands/Session, procedural API, MCP credential proxy | Event log substrate, `SessionStore` contract, `wake`/replay model |
| [`openai-codex.md`](openai-codex.md) | OpenAI Codex (`codex-rs/`): app-server JSON-RPC protocol, `ThreadStore` (Local/Remote/InMemory), rollout JSONL persistence, sandbox tech | Event log layout, idempotency, ord-based ordering, multi-process resume |
| [`openai-agents-sdk.md`](openai-agents-sdk.md) | OpenAI Agents SDK (April 2026): Manifest, three state surfaces, Capabilities, 8 sandbox providers, AGENTS.md, `apply_patch`, Computer Use | Manifest-style declarative config trade-offs |
| [`langchain-deep-agents.md`](langchain-deep-agents.md) | LangChain Deep Agents — planning tool, virtual filesystem with `BackendProtocol`, sub-agents on shared filesystem channel | Middleware-as-API insight, sub-agent composition |
| [`openclaw-resident-agents.md`](openclaw-resident-agents.md) | OpenClaw + resident/personal agent category — channel/brain/body, signed skill manifests RFC, eBPF | Trust boundaries, host-resident agent category |

## External references that inform positioning

### Anthropic Engineering — *"Scaling Managed Agents: Decoupling the brain from the hands"* (2026)
<https://www.anthropic.com/engineering/managed-agents>

Primary source for Brain/Hands/Session triad and the 6 procedural
methods. Quoted extensively in [`anthropic-managed-agents.md`](anthropic-managed-agents.md).
The central insight — *"the session provides this same benefit, serving
as a context object that lives outside Claude's context window"* —
shaped the v0.4 [event log substrate](../design/event-log.md).

### OpenAI — *"The next evolution of the Agents SDK"* (April 2026)
<https://openai.com/index/the-next-evolution-of-the-agents-sdk/>

Primary source for the new Agents SDK with Manifest, Sandbox Agents,
three state surfaces, Capabilities composition, AGENTS.md hierarchy.
Quoted extensively in [`openai-agents-sdk.md`](openai-agents-sdk.md).

### LangChain Blog — *"Deep Agents"* (2026)
<https://blog.langchain.com/deep-agents/>

Primary source for the four-pillar Deep Agents pattern (planning tool /
virtual filesystem / sub-agents / detailed system prompt). Quoted in
[`langchain-deep-agents.md`](langchain-deep-agents.md). Validates the
"middleware-as-API" insight that agent-express makes the framework's
single primitive.

### *Towards AI* — Salvatore Raieli, *"Choosing your agent harness: an architectural comparison of Claude Managed Agents, LangChain Deep Agents, and OpenAI Agents SDK"* (2026)
<https://pub.towardsai.net/choosing-your-agent-harness-an-architectural-comparison-of-claude-managed-agents-langchain-deep-a0762804ec07>

Industry framing that positions the *agent harness* as the unit of
value. Comparison axes: architecture, security boundaries, economics,
strategic lock-in.

### arXiv 2604.14228 — Liu et al., *"Dive into Claude Code: The Design Space of Today's and Future AI Agent Systems"* (April 2026)
<https://arxiv.org/pdf/2604.14228>

Key insight: *"1.6% AI logic, 98.4% infrastructure"* — almost all the
value of an agent system is in the harness/runtime, not the model
layer. 7 components × 5 layers analysis.

## Cross-references to design docs

The research above flows into specific design choices:

- [`../design/agent-express-concept.md`](../design/agent-express-concept.md) — overall framework positioning
- [`../design/agent-loop.md`](../design/agent-loop.md) — 5-level lifecycle nesting and the inner model→tool→model loop
- [`../design/event-log.md`](../design/event-log.md) — § 17 maps each design choice to its source
- [`../design/middleware-interface.md`](../design/middleware-interface.md) — single-interface design vs ADK's 8+ callback types
