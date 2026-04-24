/**
 * NeoBank — Fintech Support Bot Demo
 *
 * Demonstrates agent-express Phase 010:
 * - supportBot() preset (budget, timeout, PII, tone, escalation, rate limit)
 * - search.file() RAG with LlamaIndex + OpenAI embeddings
 * - search.web() for real-time information
 * - session-sqlite persistence
 * - Business tools: check_balance, transaction_history, block_card
 * - Escalation to human operator
 *
 * Run: OPENAI_API_KEY=... npm start
 */

import { Agent, search, tools, memory } from "../../../dist/index.js"
import { supportBot } from "../../../packages/preset-support/src/index.js"
import { llamaindexRetriever } from "../../../packages/search-llamaindex/src/index.js"
import { openaiEmbed } from "../../../packages/embed-openai/src/index.js"
import { sqliteStore } from "../../../packages/session-sqlite/src/index.js"
import { z } from "zod"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import * as readline from "readline"

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── Mock data (simulates database) ─────────────────

const accounts: Record<string, { name: string; balance: number; card: string; blocked: boolean }> = {
  john: { name: "John Smith", balance: 12_450.75, card: "4276 **** **** 1234", blocked: false },
}

const transactions = [
  { date: "2026-04-20", description: "Amazon.com", amount: -89.99 },
  { date: "2026-04-19", description: "Payroll - Acme Corp", amount: 3_500 },
  { date: "2026-04-18", description: "Whole Foods", amount: -67.30 },
  { date: "2026-04-17", description: "Transfer to Alex K.", amount: -250 },
  { date: "2026-04-15", description: "Spotify subscription", amount: -9.99 },
]

// ─── RAG: LlamaIndex + OpenAI embeddings ────────────

const knowledgeDir = join(__dirname, "..", "knowledge")

const retrieve = llamaindexRetriever({
  sources: [knowledgeDir],
  embed: openaiEmbed({ model: "text-embedding-3-small" }),
  topK: 3,
})

// ─── Session persistence (SQLite) ───────────────────

const sessionStore = sqliteStore({
  path: join(__dirname, "..", "sessions.db"),
})

// ─── Business tools ─────────────────────────────────

const checkBalance = tools.function({
  name: "check_balance",
  description: "Check the customer's account balance and card status",
  schema: z.object({ account_id: z.string() }),
  execute: async ({ account_id }) => {
    const acc = accounts[account_id as string]
    if (!acc) return "Account not found"
    return JSON.stringify({
      customer: acc.name,
      balance: `$${acc.balance.toLocaleString("en-US")}`,
      card: acc.card,
      status: acc.blocked ? "BLOCKED" : "Active",
    })
  },
})

const transactionHistory = tools.function({
  name: "transaction_history",
  description: "Show the customer's recent transactions",
  schema: z.object({ account_id: z.string(), limit: z.number().optional() }),
  execute: async ({ limit }) => {
    const n = (limit as number) ?? 5
    return transactions.slice(0, n).map(t =>
      `${t.date} | ${t.description} | ${t.amount > 0 ? "+" : ""}$${Math.abs(t.amount).toFixed(2)}`
    ).join("\n")
  },
})

const blockCard = tools.function({
  name: "block_card",
  description: "Block the customer's card due to loss, theft, or fraud",
  schema: z.object({
    account_id: z.string(),
    reason: z.enum(["lost", "stolen", "fraud", "damaged"]),
  }),
  execute: async ({ account_id, reason }) => {
    const acc = accounts[account_id as string]
    if (!acc) return "Account not found"
    acc.blocked = true
    return `Card ${acc.card} has been BLOCKED. Reason: ${reason}. A virtual card has been issued instantly. New physical card will arrive in 3-5 business days.`
  },
})

const escalate = tools.function({
  name: "escalate_to_human",
  description: "Transfer the customer to a live agent for complex issues or fraud cases",
  schema: z.object({
    reason: z.string().describe("Reason for escalation"),
    priority: z.enum(["normal", "high", "urgent"]),
  }),
  execute: async ({ reason, priority }) =>
    `Customer transferred to live agent. Reason: ${reason}. Priority: ${priority}. Estimated wait: ${priority === "urgent" ? "~30 seconds" : "~2 minutes"}.`,
})

// ─── Agent ───────────────────────────────────────────

const agent = new Agent({
  name: "NeoBank",
  model: "openai/gpt-4o-mini",
  instructions: `You are a virtual assistant for NeoBank, a modern digital bank.

Rules:
- Be concise, helpful, and empathetic — especially for card issues or fraud
- Use search_knowledge to find information in the bank's knowledge base (plans, FAQ, security)
- Use check_balance to look up the customer's account
- Use transaction_history to show recent transactions
- Use block_card immediately if the customer reports fraud or a lost/stolen card
- Use escalate_to_human for complex complaints or when you cannot resolve the issue
- Never reveal full card numbers
- Current customer: John Smith (account_id: "john")`,
})

// All guards via supportBot() preset
agent.use(supportBot({
  tone: "empathetic",
  pii: { types: ["creditCard", "email", "ssn"] },
  budget: 0.50,
  timeout: 30_000,
  rateLimit: { maxPerMinute: 20 },
  fileSearch: search.file({ retrieve, mode: "tool", topK: 3 }),
  sessionStore: memory.store({ backend: sessionStore }),
  escalation: escalate,
}))

// Business tools
agent.use(checkBalance)
agent.use(transactionHistory)
agent.use(blockCard)

// ─── Interactive chat ────────────────────────────────

async function main() {
  console.log("\n══════════════════════════════════════════")
  console.log("  NeoBank — Virtual Assistant (demo)")
  console.log("══════════════════════════════════════════")
  console.log("  Type /quit to exit\n")

  await agent.init()
  const session = agent.session()

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  rl.on("close", async () => {
    await session.close()
    await agent.dispose()
    console.log("\nGoodbye!\n")
    process.exit(0)
  })

  const ask = () => {
    rl.question("\x1b[36mYou: \x1b[0m", async (input) => {
      if (!input?.trim() || input === "/quit") {
        rl.close()
        return
      }

      try {
        const run = session.run(input)
        for await (const event of run) {
          if (event.type === "tool:start") {
            console.log(`  \x1b[33m⚙ ${event.tool}(${JSON.stringify(event.args).slice(0, 100)})\x1b[0m`)
          }
        }
        const { text } = await run.result
        console.log(`\x1b[35mNeoBank:\x1b[0m ${text}\n`)
      } catch (err) {
        console.error(`\x1b[31mError: ${(err as Error).message}\x1b[0m\n`)
      }

      ask()
    })
  }

  ask()
}

main().catch(console.error)
