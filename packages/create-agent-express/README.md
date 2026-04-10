# create-agent-express

Project scaffolder for [agent-express](https://github.com/agent-express-ai/agent-express).

## Usage

```bash
# Interactive wizard
npx create-agent-express

# Pick a template
npx create-agent-express --template support-bot
npx create-agent-express --template research
npx create-agent-express --template coding

# Default template, zero prompts
npx create-agent-express --default
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
