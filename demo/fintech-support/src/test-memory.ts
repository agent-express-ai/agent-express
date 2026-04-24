/**
 * Quick test: does memory.store() persist history across sessions?
 */
import { Agent, memory } from "../../../dist/index.js"
import { sqliteStore } from "../../../packages/session-sqlite/src/index.js"
import type { LanguageModelV3, LanguageModelV3GenerateResult } from "@ai-sdk/provider"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const dbPath = join(__dirname, "..", "test-sessions.db")

const store = sqliteStore({ path: dbPath })

// Minimal mock model — no vitest dependency
const model: LanguageModelV3 = {
  specificationVersion: "v3",
  provider: "mock",
  modelId: "mock",
  supportedUrls: {},
  async doGenerate(opts): Promise<LanguageModelV3GenerateResult> {
    // Check if history contains "Alice" to simulate memory recall
    const prompt = JSON.stringify((opts as any).prompt ?? [])
    const text = prompt.includes("Alice")
      ? "Your name is Alice!"
      : "Got it!"
    return {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 5, text: 5, reasoning: 0 },
      },
      warnings: [],
    }
  },
  async doStream() { throw new Error("not implemented") },
}

async function run() {
  const agent = new Agent({ name: "test", model, instructions: "You are helpful.", defaults: false })
  agent.use(memory.store({ backend: store }))

  await agent.init()

  // Session 1: send two messages
  console.log("=== Session 1 ===")
  const s1 = agent.session({ id: "test-session" })
  await s1.run("My name is Alice").result
  await s1.run("I live in Paris").result
  await s1.close()
  console.log("Sent 2 messages, closed session")

  // Check what's in the store
  const saved = await store.load("test-session")
  console.log(`Store has ${saved?.history.length ?? 0} messages`)
  for (const msg of saved?.history ?? []) {
    console.log(`  [${msg.role}] ${typeof msg.content === "string" ? msg.content.slice(0, 50) : "..."}`)
  }

  // Session 2: resume — should have history
  console.log("\n=== Session 2 (resume) ===")
  const s2 = agent.session({ id: "test-session" })
  const { text, state } = await s2.run("What is my name?").result
  await s2.close()
  console.log(`Response: ${text}`)

  // Check final store state
  const final = await store.load("test-session")
  console.log(`Store now has ${final?.history.length ?? 0} messages`)

  await agent.dispose()

  // Cleanup
  const { unlinkSync } = await import("fs")
  unlinkSync(dbPath)
  console.log("\nDone!")
}

run().catch(console.error)
