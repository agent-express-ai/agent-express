# create-agent-express

AI-powered project scaffolder for [agent-express](https://github.com/agent-express/agent-express).

Even our CLI is an agent. Describe what you want — the scaffolder generates it.

## Usage

```bash
# AI-powered (needs API key)
npx create-agent-express "support bot that handles order lookups and refunds"

# Static templates (offline, no API key)
npx create-agent-express --template support-bot
npx create-agent-express --template research
npx create-agent-express --template coding
npx create-agent-express --default

# Interactive
npx create-agent-express
```

## Templates

| Template | Middleware demonstrated |
|----------|----------------------|
| default | tools.function, defaults() |
| support-bot | tools.function, guard.budget, guard.approve, guard.input, memory.compaction, observe.log |
| research | tools.function, model.router, guard.output, guard.timeout |
| coding | tools.function, guard.approve, guard.budget, dev.console |

## Part of the agent-express monorepo

This package is published separately as `create-agent-express` to support the `npx create-agent-express` convention. It generates projects that use `agent-express` as a dependency.
