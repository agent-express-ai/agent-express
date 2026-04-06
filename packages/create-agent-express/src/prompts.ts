import * as p from "@clack/prompts"

export interface ScaffoldConfig {
  projectName: string
  provider: "anthropic" | "openai"
  model: string
  apiKey?: string
  mode: "ai" | "template" | "default"
  template?: "default" | "support-bot" | "research" | "coding"
  description?: string
}

const MODELS: Record<string, string[]> = {
  anthropic: ["claude-sonnet-4-6", "claude-haiku-4-5", "claude-opus-4-6"],
  openai: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
}

const KEY_URLS: Record<string, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
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

  const mode = (await p.select({
    message: "How to create your agent:",
    options: [
      { value: "ai", label: "Describe in natural language", hint: "AI generates your agent (needs API key)" },
      { value: "template", label: "Choose a template", hint: "Pre-built examples (no API key needed)" },
    ],
  })) as "ai" | "template"

  if (p.isCancel(mode)) process.exit(0)

  let template: ScaffoldConfig["template"]
  let description: string | undefined
  let apiKey: string | undefined

  if (mode === "template") {
    template = (await p.select({
      message: "Template:",
      options: [
        { value: "default", label: "Default", hint: "Simple demo agent" },
        { value: "support-bot", label: "Support Bot", hint: "Order lookup + refunds + budget" },
        { value: "research", label: "Research Agent", hint: "Web search + model routing" },
        { value: "coding", label: "Coding Assistant", hint: "File tools + approval + trace" },
      ],
    })) as ScaffoldConfig["template"]

    if (p.isCancel(template)) process.exit(0)
  } else {
    description = (await p.text({
      message: "Describe your agent:",
      placeholder: "support bot that handles order lookups and refunds with a $1 budget",
    })) as string

    if (p.isCancel(description)) process.exit(0)
  }

  // API key — needed for AI mode, optional for template mode
  const envKey = provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY
  if (!envKey) {
    apiKey = (await p.text({
      message: `${provider === "anthropic" ? "Anthropic" : "OpenAI"} API key (or press Enter to set later in .env):`,
      placeholder: `sk-...`,
    })) as string

    if (p.isCancel(apiKey)) process.exit(0)
    if (!apiKey?.trim()) apiKey = undefined
  } else {
    apiKey = envKey
  }

  return { projectName: projectName.trim(), provider, model, apiKey, mode, template, description }
}

/** Get the URL for creating API keys for a provider. */
export function getKeyUrl(provider: string): string {
  return KEY_URLS[provider] ?? KEY_URLS.anthropic!
}
