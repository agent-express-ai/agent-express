import * as p from "@clack/prompts"

export interface ScaffoldConfig {
  projectName: string
  provider: "anthropic" | "openai"
  model: string
  mode: "template"
  template?: "default" | "support-bot" | "research" | "coding"
}

const MODELS: Record<string, string[]> = {
  anthropic: ["claude-sonnet-4-6", "claude-haiku-4-5", "claude-opus-4-6"],
  openai: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
}

/**
 * Run interactive prompts to gather scaffold configuration.
 */
export async function runPrompts(): Promise<ScaffoldConfig> {
  p.intro("create-agent-express")

  const projectName = (await p.text({
    message: "Project name:",
    placeholder: "my-agent",
    defaultValue: "my-agent",
    validate: (v) => (!v.trim() ? "Project name is required" : undefined),
  })) as string

  if (p.isCancel(projectName)) process.exit(0)

  const provider = (await p.select({
    message: "LLM provider:",
    options: [
      { value: "anthropic", label: "Anthropic", hint: "Claude models" },
      { value: "openai", label: "OpenAI", hint: "GPT models" },
    ],
  })) as "anthropic" | "openai"

  if (p.isCancel(provider)) process.exit(0)

  const model = (await p.select({
    message: "Model:",
    options: MODELS[provider]!.map((m) => ({ value: m, label: m })),
  })) as string

  if (p.isCancel(model)) process.exit(0)

  const template = (await p.select({
    message: "Template:",
    options: [
      { value: "default", label: "Default", hint: "Simple demo agent" },
      { value: "support-bot", label: "Support Bot", hint: "Order lookup + refunds + budget" },
      { value: "research", label: "Research Agent", hint: "Web search + model routing" },
      { value: "coding", label: "Coding Assistant", hint: "File tools + approval + trace" },
    ],
  })) as ScaffoldConfig["template"]

  if (p.isCancel(template)) process.exit(0)

  return { projectName: projectName.trim(), provider, model, mode: "template", template }
}
