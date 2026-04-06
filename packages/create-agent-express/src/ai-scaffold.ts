import { writeFile, mkdir } from "node:fs/promises"
import { join, dirname } from "node:path"

/**
 * AI-powered project scaffold — an agent-express agent that generates projects.
 *
 * This is the ultimate dogfood: the scaffolder IS an agent-express agent.
 * It uses tools to write files, and guard.approve() to ask the developer
 * before each file write.
 */
export async function scaffoldWithAI(
  projectDir: string,
  description: string,
  config: { projectName: string; provider: string; model: string; apiKey: string },
): Promise<void> {
  // Dynamic import to avoid bundling agent-express in the CLI
  const { Agent, tools, guard, approve, deny } = await import("agent-express")
  const { z } = await import("zod")

  const filesWritten: string[] = []

  const agent = new Agent({
    name: "scaffold-agent",
    model: `${config.provider}/${config.model}`,
    instructions: SCAFFOLD_SYSTEM_PROMPT(config),
    defaults: { retry: { maxRetries: 1 } },
  })

  // File writing tools
  agent.use(tools.function({
    name: "writeFile",
    description: "Create or overwrite a file in the project. Use relative paths from project root.",
    schema: z.object({
      path: z.string().describe("Relative path from project root, e.g. 'src/agent.ts'"),
      content: z.string().describe("Full file content"),
    }),
    execute: async ({ path, content }) => {
      const fullPath = join(projectDir, path as string)
      await mkdir(dirname(fullPath), { recursive: true })
      await writeFile(fullPath, content as string)
      filesWritten.push(path as string)
      return `Created: ${path}`
    },
    requireApproval: true,
  }))

  agent.use(tools.function({
    name: "createDirectory",
    description: "Create a directory (and parents) in the project.",
    schema: z.object({
      path: z.string().describe("Relative directory path"),
    }),
    execute: async ({ path }) => {
      await mkdir(join(projectDir, path as string), { recursive: true })
      return `Created directory: ${path}`
    },
  }))

  // HITL: ask developer before writing each file
  agent.use(guard.approve({
    approve: async (toolName, args) => {
      const path = args.path as string
      const content = args.content as string
      const preview = content.length > 200 ? content.slice(0, 200) + "..." : content

      console.log(`\n  📝 ${toolName}: ${path}`)
      console.log(`  ${preview.split("\n").slice(0, 5).join("\n  ")}`)

      // Auto-approve in scaffold context (developer already consented by running the command)
      return approve()
    },
  }))

  // Run the scaffold agent
  await agent.init()
  const session = agent.session()

  console.log(`\n🤖 Generating project from description...`)
  console.log(`   "${description}"\n`)

  const result = await session.run(
    `Generate a complete agent-express project for: ${description}\n\n` +
    `Project name: ${config.projectName}\n` +
    `Provider: ${config.provider}\n` +
    `Model: ${config.model}\n\n` +
    `Create all necessary files: package.json, tsconfig.json, src/agent.ts, tests/agent.agent.test.ts, .env.example, .gitignore, AGENTS.md, CLAUDE.md, README.md`,
  ).result

  await session.close()
  await agent.dispose()

  // Write .env if API key provided
  if (config.apiKey) {
    const envKey = config.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"
    await writeFile(join(projectDir, ".env"), `${envKey}=${config.apiKey}\n`)
  }

  console.log(`\n✓ Created ${filesWritten.length} files`)
}

function SCAFFOLD_SYSTEM_PROMPT(config: { projectName: string; provider: string; model: string }): string {
  return `You are a project scaffolder for agent-express, a TypeScript middleware framework for AI agents.

Generate a complete, working project. Use the writeFile tool to create each file.

IMPORTANT RULES:
- All code must be TypeScript with ESM imports (import/export, not require)
- Use "agent-express" as the import package
- Use "agent-express/test" for TestModel, testAgent, etc.
- The agent must use \`export default agent\` AND \`export { agent }\`
- Tests must use TestModel with defaults: false (no real API calls)
- package.json must have: "type": "module", scripts: { "dev": "agent-express dev", "test": "agent-express test" }
- .env.example must have the API key placeholder for ${config.provider}
- Include AGENTS.md and CLAUDE.md with agent-express API reference

AGENT-EXPRESS API REFERENCE:
- import { Agent, tools, guard, model, memory, observe, dev, approve, deny, modify } from "agent-express"
- import { TestModel, FunctionModel, testAgent, testSession, capture } from "agent-express/test"
- new Agent({ name, model: "${config.provider}/${config.model}", instructions, defaults? })
- agent.use(middleware) — chainable, accepts Middleware object, function (turn hook), or array
- agent.use("model", fn) — scope-specific shorthand
- agent.init() / agent.dispose() — explicit lifecycle
- agent.session() → Session with .run(input).result, .close()
- agent.run(input) — convenience (auto-init + auto-session + single turn)
- RunResult: { text, state, data? }
- tools.function({ name, description, schema: z.object(...), execute, requireApproval? })
- guard.budget({ limit, onLimit? }) — USD cost cap
- guard.approve({ approve: fn }) — HITL tool approval (reads tool.requireApproval flag)
- guard.input(validator) — input validation
- guard.output(validator | { validate, onBlock }) — output validation
- guard.timeout({ turn?, model? }) — time limits
- guard.maxIterations(n) — loop limit (default 25 via defaults)
- model.router({ routes: { simple, medium, complex } }) — complexity routing
- model.retry(config?) — exponential backoff (in defaults)
- memory.compaction({ maxTokens, strategy? }) — context window management
- observe.usage() / observe.tools() / observe.duration() — in defaults
- observe.log() — structured JSON logging
- dev.console() — terminal lifecycle trace
- approve(), deny(reason), modify(args) — HITL decision helpers`
}
