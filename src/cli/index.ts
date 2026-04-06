/**
 * agent-express CLI — dev server and test runner for AI agents.
 *
 * Commands:
 *   agent-express dev [entry]   Start development server with hot reload
 *   agent-express test          Run agent tests with safety guards
 */

import { Command } from "commander"

const program = new Command()
  .name("agent-express")
  .description("CLI for agent-express — the middleware framework for AI agents")
  .version("0.1.0")

program
  .command("dev [entry]")
  .description("Start development server with hot reload and terminal chat")
  .option("--no-trace", "Disable dev.console() middleware output")
  .action(async (entry: string | undefined, opts: { trace: boolean }) => {
    const { runDev } = await import("./dev.js")
    await runDev(entry ?? "src/agent.ts", opts)
  })

program
  .command("test")
  .description("Run agent tests (blocks real API calls automatically)")
  .option("--ci", "Output JUnit XML for CI systems")
  .option("--pattern <glob>", "Test file pattern", "**/*.agent.test.ts")
  .action(async (opts: { ci: boolean; pattern: string }) => {
    const { runTest } = await import("./test.js")
    await runTest(opts)
  })

const isDirectRun =
  process.argv[1]?.endsWith("/agent-express") ||
  process.argv[1]?.endsWith("/cli/index.js") ||
  process.argv[1]?.endsWith("/cli/index.ts")

if (isDirectRun) {
  program.parse(process.argv)
}
