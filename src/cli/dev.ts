import * as readline from "node:readline"
import { resolve, dirname, extname } from "node:path"
import { watch } from "node:fs"
import { existsSync } from "node:fs"

/**
 * Run the agent-express development server.
 *
 * - Loads agent from entry file
 * - Interactive terminal chat (readline)
 * - Shows dev.console() middleware output
 * - Hot reload on file changes (re-import with cache busting)
 * - Graceful shutdown on Ctrl+C
 */
export async function runDev(entry: string, _opts: { trace: boolean }): Promise<void> {
  const entryPath = resolve(process.cwd(), entry)

  // Validate entry path exists and has .ts/.js extension
  const ext = extname(entryPath)
  if (ext !== ".ts" && ext !== ".js") {
    console.error(`\n❌ Entry file must have .ts or .js extension, got: ${ext || "(none)"}`)
    process.exit(1)
  }
  if (!existsSync(entryPath)) {
    console.error(`\n❌ Entry file not found: ${entryPath}`)
    process.exit(1)
  }

  console.log(`\n🤖 Loading agent from ${entry}...`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let agentModule: any
  try {
    agentModule = await import(entryPath)
  } catch (err) {
    console.error(`\n❌ Could not load agent from ${entry}`)
    console.error(`   Make sure the file exports an Agent instance as default or named 'agent'.`)
    console.error(`   Error: ${(err as Error).message}`)
    process.exit(1)
  }

  // Use let so hot reload can replace the agent reference
  let agent = agentModule.default ?? agentModule.agent
  if (!agent || typeof agent.init !== "function") {
    console.error(`\n❌ ${entry} does not export an Agent instance.`)
    console.error(`   Export your agent as: export default agent or export const agent = ...`)
    process.exit(1)
  }

  try {
    await agent.init()
  } catch (err) {
    console.error(`\n❌ Agent initialization failed: ${(err as Error).message}`)
    process.exit(1)
  }

  const modelId = agent.name ?? "agent"
  console.log(`✓ Agent "${modelId}" ready`)
  console.log(`  Type a message, or /quit to exit, /clear to reset session\n`)

  let session = agent.session()

  // Hot reload: watch source directory for changes
  const watchDir = dirname(entryPath)
  let reloadPending = false
  watch(watchDir, { recursive: true }, (eventType, filename) => {
    if (!filename?.endsWith(".ts") && !filename?.endsWith(".js")) return
    if (reloadPending) return
    reloadPending = true
    setTimeout(() => {
      reloadPending = false
      console.log(`\n🔄 File changed: ${filename} — reloading agent...`)
      // Replace agent ref on hot reload
      void (async () => {
        try {
          await session.close()
          await agent.dispose()
          // Re-import with cache busting
          const freshModule = await import(`${entryPath}?t=${Date.now()}`)
          const freshAgent = freshModule.default ?? freshModule.agent
          await freshAgent.init()
          // Replace agent and session for next message
          agent = freshAgent
          session = agent.session()
          console.log(`✓ Reloaded\n`)
        } catch (err) {
          console.error(`❌ Reload failed: ${(err as Error).message}\n`)
        }
      })()
    }, 100) // debounce
  })

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "You: ",
  })

  rl.prompt()

  rl.on("line", (line: string) => {
    const input = line.trim()
    if (!input) {
      rl.prompt()
      return
    }

    void (async () => {
      if (input === "/quit" || input === "/exit") {
        console.log("\n👋 Goodbye")
        await session.close()
        await agent.dispose()
        rl.close()
        process.exit(0)
      }

      if (input === "/clear") {
        await session.close()
        session = agent.session()
        console.log("🔄 Session cleared\n")
        rl.prompt()
        return
      }

      if (input === "/history") {
        console.log("\n📝 Session history:")
        for (const msg of session.history) {
          const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
          console.log(`  [${msg.role}] ${content.slice(0, 200)}`)
        }
        console.log()
        rl.prompt()
        return
      }

      try {
        const result = await session.run(input).result
        console.log(`\nBot: ${result.text}\n`)
      } catch (err) {
        console.error(`\n❌ Error: ${(err as Error).message}\n`)
      }

      rl.prompt()
    })()
  })

  rl.on("close", () => {
    void (async () => {
      await session.close()
      await agent.dispose()
      process.exit(0)
    })()
  })

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n\n👋 Shutting down...")
    void (async () => {
      await session.close()
      await agent.dispose()
      process.exit(0)
    })()
  })
}
