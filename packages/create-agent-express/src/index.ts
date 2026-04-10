#!/usr/bin/env node

/**
 * create-agent-express — project scaffolder for agent-express.
 *
 * Usage:
 *   npx create-agent-express                        # interactive prompts
 *   npx create-agent-express --template support-bot  # static template (offline)
 *   npx create-agent-express --default              # default template, zero prompts
 */

import { Command } from "commander"
import { existsSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"
import * as p from "@clack/prompts"
import { runPrompts, type ScaffoldConfig } from "./prompts.js"
import { scaffoldFromTemplate } from "./template-scaffold.js"

const program = new Command()
  .name("create-agent-express")
  .description("Create agent-express projects from templates")
  .version("0.1.2")
  .option("--template <name>", "Use a template: default, support-bot, research, coding")
  .option("--default", "Use default template with zero prompts")
  .option("--name <name>", "Project name (default: my-agent)")
  .option("--provider <provider>", "LLM provider: anthropic, openai (default: anthropic)")
  .option("--model <model>", "Model name (default: claude-sonnet-4-6)")
  .action(async (opts: any) => {
    try {
      await run(opts)
    } catch (err) {
      p.cancel(`Error: ${(err as Error).message}`)
      process.exit(1)
    }
  })

program.parse()

async function run(opts: any): Promise<void> {
  let config: ScaffoldConfig

  if (opts.default) {
    config = {
      projectName: opts.name ?? "my-agent",
      provider: opts.provider ?? "anthropic",
      model: opts.model ?? "claude-sonnet-4-6",
      mode: "template",
      template: "default",
    }
  } else if (opts.template) {
    config = {
      projectName: opts.name ?? "my-agent",
      provider: opts.provider ?? "anthropic",
      model: opts.model ?? "claude-sonnet-4-6",
      mode: "template",
      template: opts.template,
    }
  } else {
    config = await runPrompts()
  }

  const projectDir = resolve(process.cwd(), config.projectName)

  if (existsSync(projectDir)) {
    const overwrite = await p.confirm({ message: `Directory ${config.projectName} already exists. Overwrite?` })
    if (p.isCancel(overwrite) || !overwrite) process.exit(0)
  }

  mkdirSync(projectDir, { recursive: true })

  const template = config.template ?? "default"
  const s = p.spinner()
  s.start(`Scaffolding from template: ${template}`)
  await scaffoldFromTemplate(projectDir, template, config)
  s.stop(`Created project from template: ${template}`)

  p.note(
    [
      `cd ${config.projectName}`,
      `npm install`,
      `# Set your API key in .env`,
      `npm run dev     # chat with your agent`,
      `npm test        # run agent tests (no API key needed)`,
    ].join("\n"),
    "Next steps",
  )

  p.outro("Happy building!")
}
