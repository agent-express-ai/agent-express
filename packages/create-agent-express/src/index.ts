#!/usr/bin/env node

/**
 * create-agent-express — AI-powered project scaffolder for agent-express.
 *
 * Even our CLI is an agent. Describe what you want — the scaffolder generates it.
 *
 * Usage:
 *   npx create-agent-express "description"        # AI-powered (needs API key)
 *   npx create-agent-express --template support-bot  # static template (offline)
 *   npx create-agent-express --default              # default template, zero prompts
 *   npx create-agent-express                        # interactive prompts
 */

import { Command } from "commander"
import { existsSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"
import * as p from "@clack/prompts"
import { runPrompts, type ScaffoldConfig } from "./prompts.js"
import { scaffoldFromTemplate } from "./template-scaffold.js"
import { openKeyPage } from "./browser-auth.js"

const program = new Command()
  .name("create-agent-express")
  .description("Create agent-express projects — AI-powered or from templates")
  .version("0.1.0")
  .argument("[description]", "Natural language description of your agent (AI-powered mode)")
  .option("--template <name>", "Use a static template: default, support-bot, research, coding")
  .option("--default", "Use default template with zero prompts")
  .option("--name <name>", "Project name (default: my-agent)")
  .option("--provider <provider>", "LLM provider: anthropic, openai (default: anthropic)")
  .option("--model <model>", "Model name (default: claude-sonnet-4-6)")
  .action(async (description: string | undefined, opts: any) => {
    try {
      await run(description, opts)
    } catch (err) {
      p.cancel(`Error: ${(err as Error).message}`)
      process.exit(1)
    }
  })

program.parse()

async function run(description: string | undefined, opts: any): Promise<void> {
  let config: ScaffoldConfig

  if (opts.default) {
    // Zero-prompt mode
    config = {
      projectName: opts.name ?? "my-agent",
      provider: opts.provider ?? "anthropic",
      model: opts.model ?? "claude-sonnet-4-6",
      mode: "template",
      template: "default",
    }
  } else if (opts.template) {
    // Template mode
    config = {
      projectName: opts.name ?? "my-agent",
      provider: opts.provider ?? "anthropic",
      model: opts.model ?? "claude-sonnet-4-6",
      mode: "template",
      template: opts.template,
    }
  } else if (description) {
    // AI mode
    config = {
      projectName: opts.name ?? "my-agent",
      provider: opts.provider ?? "anthropic",
      model: opts.model ?? "claude-sonnet-4-6",
      mode: "ai",
      description,
    }

    // Ensure API key
    const envKey = config.provider === "anthropic"
      ? process.env.ANTHROPIC_API_KEY
      : process.env.OPENAI_API_KEY

    if (!envKey) {
      await openKeyPage(config.provider)
      const key = await p.text({
        message: "Paste your API key:",
        placeholder: "sk-...",
        validate: (v) => (!v.trim() ? "API key is required for AI mode. Use --template for offline." : undefined),
      })
      if (p.isCancel(key)) process.exit(0)
      config.apiKey = key as string
    } else {
      config.apiKey = envKey
    }
  } else {
    // Interactive mode
    config = await runPrompts()
  }

  const projectDir = resolve(process.cwd(), config.projectName)

  // Check target directory
  if (existsSync(projectDir)) {
    const overwrite = await p.confirm({ message: `Directory ${config.projectName} already exists. Overwrite?` })
    if (p.isCancel(overwrite) || !overwrite) process.exit(0)
  }

  mkdirSync(projectDir, { recursive: true })

  if (config.mode === "ai" && config.description && config.apiKey) {
    const { scaffoldWithAI } = await import("./ai-scaffold.js")
    await scaffoldWithAI(projectDir, config.description, {
      projectName: config.projectName,
      provider: config.provider,
      model: config.model,
      apiKey: config.apiKey,
    })
  } else {
    const template = config.template ?? "default"
    const s = p.spinner()
    s.start(`Scaffolding from template: ${template}`)
    await scaffoldFromTemplate(projectDir, template, config)
    s.stop(`Created project from template: ${template}`)
  }

  // Post-scaffold instructions
  p.note(
    [
      `cd ${config.projectName}`,
      `npm install`,
      config.apiKey ? "" : `# Set your API key in .env`,
      `npm run dev     # chat with your agent`,
      `npm test        # run agent tests (no API key needed)`,
    ].filter(Boolean).join("\n"),
    "Next steps",
  )

  p.outro("Happy building! 🤖")
}
