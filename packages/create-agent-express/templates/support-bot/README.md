# Support Bot

A customer support agent for a fictional e-commerce store, built with [Agent Express](https://github.com/agent-express/agent-express).

## Features

- **Order lookup** -- Look up orders by ID from a fake database
- **Refund processing** -- Process refunds with human-in-the-loop approval
- **Prompt injection guard** -- Blocks common injection patterns
- **Budget cap** -- $1.00 USD cost limit per session
- **Memory compaction** -- Keeps context window under 4096 tokens
- **Structured logging** -- JSON log events for observability

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and add your API key:

```bash
cp .env.example .env
```

3. Run the agent in development mode:

```bash
npm run dev
```

4. Run tests:

```bash
npm test
```

## Middleware stack

| Middleware | Purpose |
|---|---|
| `tools.function(lookup_order)` | Order database lookup |
| `tools.function(process_refund)` | Refund processing (requires approval) |
| `guard.budget({ limit: 1.0 })` | Cost cap at $1.00 |
| `guard.approve(...)` | Auto-approves refunds under $100 |
| `guard.input(...)` | Blocks prompt injection |
| `memory.compaction(...)` | Context window at 4096 tokens |
| `observe.log()` | Structured JSON logging |

## Project structure

```
src/agent.ts              -- Agent definition with all middleware
tests/agent.agent.test.ts -- Agent tests using TestModel
```
