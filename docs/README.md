---
title: Documentation
audience: contributors
last-revised: 2026-05-07
---

# agent-express Documentation

Documentation for contributors to agent-express. For end-user docs
(install, getting started, recipes), see the README in the repo root.

## Where to find what

| Directory | Purpose |
|-----------|---------|
| [`design/`](design/) | Architectural design documents — the *why* behind the framework |
| [`research/`](research/) | Reverse-engineering notes on adjacent agent frameworks |
| [`roadmap.md`](roadmap.md) | What we've shipped and what's planned |

## Quick links

**For new contributors** — start with the design doc reading order:

1. [`design/agent-express-concept.md`](design/agent-express-concept.md) — what we're building and why
2. [`design/middleware-interface.md`](design/middleware-interface.md) — the `(ctx, next)` contract
3. [`design/agent-loop.md`](design/agent-loop.md) — the 5-level lifecycle and inner loop
4. [`design/event-log.md`](design/event-log.md) — the v0.4 substrate

**For someone adding a new feature** — the relevant design doc is the
one that names the subsystem you're touching. If your change cuts
across (e.g., a new middleware that emits new event types), update
multiple docs and add cross-references between them.

**For someone evaluating agent-express vs. alternatives** — the
[7-framework comparison table](design/agent-express-concept.md#7-architecture-comparison)
in the concept doc and [`research/`](research/) are the most direct
inputs.

## Conventions

- All design and research docs use frontmatter (`title`, `status`,
  `audience`, `last-revised`).
- Cross-references between docs use relative paths so they work both
  on GitHub and in local Markdown previews.
- The user-facing website (<https://agent-express.ai>) hosts the
  end-user documentation. The files in this directory are the
  contributor-facing docs — design rationale, research notes, roadmap.
