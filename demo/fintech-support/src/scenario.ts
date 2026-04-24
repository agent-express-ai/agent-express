/**
 * NeoBank — Scripted demo scenario
 *
 * Runs a 4-turn fraud report conversation to demonstrate all middleware.
 * Run: OPENAI_API_KEY=... npx tsx demo/fintech-support/src/scenario.ts
 */

import { Agent, search, tools, memory, dev } from "../../../dist/index.js"
import { supportBot } from "../../../packages/preset-support/src/index.js"
import { llamaindexRetriever } from "../../../packages/search-llamaindex/src/index.js"
import { openaiEmbed } from "../../../packages/embed-openai/src/index.js"
import { sqliteStore } from "../../../packages/session-sqlite/src/index.js"
import { z } from "zod"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Mock data
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

// RAG
const retrieve = llamaindexRetriever({
  sources: [join(__dirname, "..", "knowledge")],
  embed: openaiEmbed({ model: "text-embedding-3-small" }),
  topK: 3,
})

// Agent
const agent = new Agent({
  name: "NeoBank",
  model: "openai/gpt-4o",
  instructions: `You are a virtual assistant for NeoBank.
Be concise, helpful, and empathetic.
IMPORTANT: The current authenticated customer is John Smith with account_id "john". Always use "john" as account_id when calling tools — do NOT ask the customer for their account ID.
Use search_knowledge to look up bank policies before answering policy questions.
Use check_balance and transaction_history proactively when customer mentions charges.
Use block_card immediately when customer reports fraud — do not hesitate.
Use escalate_to_human only for truly complex issues you cannot resolve.`,
})

agent.use(supportBot({
  tone: "empathetic",
  pii: { types: ["creditCard", "email", "ssn"] },
  budget: 0.50,
  timeout: 30_000,
  rateLimit: { maxPerMinute: 20 },
  fileSearch: search.file({ retrieve, mode: "tool", topK: 3 }),
  sessionStore: memory.store({ backend: sqliteStore({ path: join(__dirname, "..", "sessions.db") }) }),
  escalation: tools.function({
    name: "escalate_to_human",
    description: "Transfer customer to a live agent",
    schema: z.object({ reason: z.string(), priority: z.enum(["normal", "high", "urgent"]) }),
    execute: async ({ reason, priority }) =>
      `Customer transferred. Reason: ${reason}. Priority: ${priority}. Wait: ${priority === "urgent" ? "~30s" : "~2min"}.`,
  }),
}))

agent.use(tools.function({
  name: "check_balance",
  description: "Check account balance",
  schema: z.object({ account_id: z.string() }),
  execute: async ({ account_id }) => {
    const acc = accounts[account_id as string]
    if (!acc) return "Account not found"
    return JSON.stringify({ customer: acc.name, balance: `$${acc.balance.toLocaleString("en-US")}`, card: acc.card, status: acc.blocked ? "BLOCKED" : "Active" })
  },
}))

agent.use(tools.function({
  name: "transaction_history",
  description: "Show recent transactions",
  schema: z.object({ account_id: z.string() }),
  execute: async () => transactions.map(t => `${t.date} | ${t.description} | ${t.amount > 0 ? "+" : ""}$${Math.abs(t.amount).toFixed(2)}`).join("\n"),
}))

// dev.console() for full lifecycle trace
agent.use(dev.console())

agent.use(tools.function({
  name: "block_card",
  description: "Block card for fraud/loss",
  schema: z.object({ account_id: z.string(), reason: z.enum(["lost", "stolen", "fraud", "damaged"]) }),
  execute: async ({ account_id, reason }) => {
    const acc = accounts[account_id as string]
    if (!acc) return "Account not found"
    acc.blocked = true
    return `Card ${acc.card} BLOCKED. Reason: ${reason}. Virtual card issued instantly. Physical card in 3-5 days.`
  },
}))

// Scenario
const scenario = [
  "Hi, I see a $89.99 charge from Amazon on my account that I didn't make. Can you check my recent transactions?",
  "I definitely did not make that Amazon purchase. Please block my card immediately — this is fraud!",
  "How do I get a replacement card? And can I get the $89.99 back?",
  "Thank you for your help!",
]

async function main() {
  console.log("\n══════════════════════════════════════════")
  console.log("  NeoBank — Support Bot Demo")
  console.log("══════════════════════════════════════════\n")

  await agent.init()
  const session = agent.session()

  for (const msg of scenario) {
    console.log(`\x1b[36mCustomer:\x1b[0m ${msg}\n`)

    const run = session.run(msg)
    for await (const event of run) {
      if (event.type === "tool:start") {
        console.log(`  \x1b[33m⚙ ${event.tool}(${JSON.stringify(event.args).slice(0, 80)})\x1b[0m`)
      }
    }
    const { text, state } = await run.result
    console.log(`\n\x1b[35mNeoBank:\x1b[0m ${text}\n`)
    console.log("─".repeat(60) + "\n")
  }

  // Summary
  const lastRun = session.run("bye")
  const { state } = await lastRun.result
  console.log("══════════════════════════════════════════")
  console.log("  Session Summary")
  console.log("══════════════════════════════════════════")
  if (state["guard:budget:totalCost"]) console.log(`  Total cost: $${(state["guard:budget:totalCost"] as number).toFixed(4)}`)
  if (state["search:file:sources"]) console.log(`  Knowledge base queries: ${(state["search:file:sources"] as unknown[]).length}`)
  if (state["support:escalation"]) console.log(`  Escalation: ${JSON.stringify(state["support:escalation"])}`)
  console.log("══════════════════════════════════════════\n")

  await session.close()
  await agent.dispose()
}

main().catch(console.error)
