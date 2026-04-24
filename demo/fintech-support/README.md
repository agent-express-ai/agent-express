# NeoBank Support Bot Demo

A production-grade fintech support bot built with [agent-express](https://github.com/agent-express-ai/agent-express).

## What it demonstrates

A digital bank customer support agent that can:

| Capability | Powered by |
|---|---|
| **Answer policy questions** from a knowledge base (plans, fees, chargebacks) | `search.file()` + `@agent-express/search-llamaindex` + `@agent-express/embed-openai` |
| **Look up account info** — balance, recent transactions | `tools.function()` — custom business tools |
| **Take action on fraud** — block card instantly | `tools.function()` with `block_card` tool |
| **Escalate to a human** when the bot can't help | `tools.function()` (model-driven) + escalation safety net (auto after 5 idle turns) |
| **Stay on-brand** — empathetic tone even during fraud calls | `guard.tone({ style: "empathetic" })` |
| **Protect customer data** — card numbers, phones, emails masked before LLM | `guard.piiRedact()` |
| **Control costs** — $0.50 cap, 30s timeout, 20 req/min | `guard.budget()` + `guard.timeout()` + `guard.rateLimit()` |
| **Remember context** — conversation persisted across turns | `memory.store()` + `@agent-express/session-sqlite` |

## Agent Configuration

```typescript
import { Agent, search, tools, memory, dev } from "agent-express"
import { supportBot } from "@agent-express/preset-support"
import { llamaindexRetriever } from "@agent-express/search-llamaindex"
import { openaiEmbed } from "@agent-express/embed-openai"
import { sqliteStore } from "@agent-express/session-sqlite"

const agent = new Agent({
  name: "NeoBank",
  model: "openai/gpt-4o",
  instructions: "You are a virtual assistant for NeoBank...",
})

// One preset wires up all safety guards
agent.use(supportBot({
  tone: "empathetic",
  pii: { types: ["creditCard", "phone", "email"] },
  budget: 0.50,
  timeout: 30_000,
  rateLimit: { maxPerMinute: 20 },
  // RAG from markdown knowledge base
  fileSearch: search.file({
    retrieve: llamaindexRetriever({
      sources: ["./knowledge"],
      embed: openaiEmbed({ model: "text-embedding-3-small" }),
    }),
    mode: "tool",
  }),
  // Session persistence
  sessionStore: memory.store({
    backend: sqliteStore({ path: "./sessions.db" }),
  }),
  // Escalation to human operator
  escalation: tools.function({
    name: "escalate_to_human",
    description: "Transfer customer to a live agent",
    schema: z.object({ reason: z.string(), priority: z.enum(["normal", "high", "urgent"]) }),
    execute: async ({ reason, priority }) => `Transferred. Priority: ${priority}.`,
  }),
}))

// Business-specific tools
agent.use(tools.function({ name: "check_balance", ... }))
agent.use(tools.function({ name: "transaction_history", ... }))
agent.use(tools.function({ name: "block_card", ... }))

// Lifecycle trace for development
agent.use(dev.console())
```

## Quick Start

```bash
# From repo root — build first
npm run build

# Run scripted demo scenario (4-turn fraud report)
OPENAI_API_KEY=sk-... npx tsx demo/fintech-support/src/scenario.ts

# Run interactive chat
OPENAI_API_KEY=sk-... npx tsx demo/fintech-support/src/index.ts
```

## Demo Scenario

The scripted scenario simulates a customer reporting a fraudulent charge:

1. **"I see a $89.99 charge from Amazon I didn't make"**
   - Agent calls `transaction_history` to pull recent activity
2. **"Block my card — this is fraud!"**
   - Agent calls `block_card(reason: "fraud")` immediately
   - Agent calls `escalate_to_human(priority: "urgent")`
3. **"How do I get a new card? Can I get the money back?"**
   - Agent searches knowledge base for replacement card process and chargeback policy
   - Responds: virtual card issued instantly, physical in 3-5 days, 120-day chargeback window
4. **"Thank you!"**
   - Session summary: cost, RAG queries, escalation status

## What to ask (interactive mode)

Try these prompts to exercise different capabilities:

- "What are your card plans?" — triggers RAG search
- "Show me my recent transactions" — calls `transaction_history`
- "What's my balance?" — calls `check_balance`
- "Someone stole my card!" — calls `block_card` + `escalate_to_human`
- "My email is john@example.com" — PII gets redacted before LLM sees it
- "I want to talk to a real person" — calls `escalate_to_human`
- "How do I dispute a charge?" — RAG search for chargeback policy

## Knowledge Base

Three markdown files in `knowledge/`:

| File | Content |
|---|---|
| `tariffs.md` | Card plans (Standard/Premium/Credit), transfer fees, ATM limits |
| `faq.md` | Card blocking, chargebacks, limits, contact info |
| `security.md` | Fraud signs, what to do if scammed, insurance, 2FA |

## Example Output

```
Customer: I see a $89.99 charge from Amazon I didn't make.

┌ session edef1cbc-...
│  → turn #0
│  │  → model.call  openai/gpt-4o  tokens:344→44  1867ms
│  → turn #0 done

NeoBank: I'm really sorry about this unexpected charge...

Customer: Block my card — this is fraud!

│  → turn #1
│  │  → model.call  openai/gpt-4o  tokens:405→56  tools:2
│  │  → tool.exec   transaction_history  1ms
│  │  → tool.exec   block_card  0ms
│  │  → tool.exec   escalate_to_human  0ms

NeoBank: I've escalated this to a human agent who will be with you momentarily...

══════════════════════════════════════════
  Session Summary: Cost $0.0172, 6 RAG queries
══════════════════════════════════════════
```

## Architecture

```
src/
  index.ts      — interactive chat (readline)
  scenario.ts   — scripted 4-turn demo
knowledge/
  tariffs.md    — plans & pricing
  faq.md        — frequently asked questions
  security.md   — fraud & security info
sessions.db     — SQLite session storage (auto-created)
```
