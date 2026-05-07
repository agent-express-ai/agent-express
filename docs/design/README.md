---
title: Design Documents
audience: contributors
last-revised: 2026-05-07
---

# Design Documents

Architectural design documents for agent-express. These describe the
*why* behind the framework: the design choices, trade-offs against the
alternatives, and how each subsystem fits into the whole. Each document
is self-contained but cross-references siblings.

For the *what* and *how-to-use* (public API, code examples, recipes)
see the source TSDoc and the README in the repo root.

## Reading order for new contributors

1. [`agent-express-concept.md`](agent-express-concept.md) — what we're
   building and why (position in the agent-tooling landscape, the
   `agent session` primitive, framework-vs-runtime distinction,
   competitor architecture comparison)
2. [`middleware-interface.md`](middleware-interface.md) — the single
   `Middleware` interface and `(ctx, next)` onion pattern
3. [`agent-loop.md`](agent-loop.md) — the 5-level lifecycle nesting
   and the model→tool→model loop within a turn
4. [`event-log.md`](event-log.md) — the v0.4 substrate: typed events
   as the canonical session record, durability, adapter contract

After this stack you can read the others in any order, depending on
what you're working on.

## Index

| Document | Status | Ships with | What it covers |
|----------|--------|------------|----------------|
| [`agent-express-concept.md`](agent-express-concept.md) | shipped | v0.4.0+ | Framework position, agent session primitive, why middleware beats graphs, 7-framework comparison table |
| [`middleware-interface.md`](middleware-interface.md) | shipped | v0.4.0+ | Single `Middleware` interface, 5 hooks, `(ctx, next)` onion, context types, alternatives considered |
| [`agent-loop.md`](agent-loop.md) | shipped | v0.4.0+ | 5-level lifecycle nesting (agent / session / turn / model / tool), inner loop, two onions (model + tool), control flow primitives |
| [`event-log.md`](event-log.md) | shipped | v0.4.0+ | Event log substrate, `EventLog` / `Writer` / `AgentRun` mechanics, `SessionStore` contract, idempotency, design rationale |
| [`providers.md`](providers.md) | shipped | v0.2.0+ | `"provider/model"` string resolution, peer-deps + dynamic-import pattern, security guards |
| [`adapters.md`](adapters.md) | shipped | v0.2.0+ | Three adapter families (session / embed / search), contracts, conventions, custom-adapter walkthrough |
| [`observability.md`](observability.md) | shipped | v0.2.0+ | Six observability middlewares, OpenTelemetry integration (Meter + Tracer), GenAI semantic conventions |
| [`testing.md`](testing.md) | shipped | v0.1.0+ | `testAgent` / `FunctionModel` / `TestModel` / recorder cassettes / capture / `ALLOW_REAL_REQUESTS` guard |

## Conventions

- **Frontmatter** — every doc has `title`, `status`, `ships-with`,
  `last-revised`, `audience`. `status: shipped` means the doc
  describes code that lives on `main`.
- **Cross-references** — each doc has a "Sibling design documents"
  section near the end. If you change a doc, run a quick check that
  references to it from other docs still make sense.
- **Source code links** — design docs link to source files using
  relative paths from the doc location (typically `../../src/...`).
- **Research references** — for the external sources (Anthropic,
  OpenAI Codex, LangChain) that influenced these designs see
  [`../research/`](../research/).
