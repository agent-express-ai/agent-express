import type { LanguageModelV3 } from "@ai-sdk/provider"

/**
 * Resolves a model identifier string to a `LanguageModelV3` instance.
 *
 * Parses the `"provider/model-name"` format and dynamically imports the
 * corresponding AI SDK provider package. Provider packages (`@ai-sdk/anthropic`,
 * `@ai-sdk/openai`) are peer dependencies that the user installs.
 *
 * @param modelId - Model string like `"anthropic/claude-sonnet-4-6"` or `"openai/gpt-4o"`
 * @returns Resolved LanguageModelV3 instance
 * @throws Error if format is invalid, provider is unknown, or package is not installed
 *
 * @example
 * ```typescript
 * const model = await resolveModel("anthropic/claude-sonnet-4-6")
 * const result = await model.doGenerate({ prompt: [...] })
 * ```
 */
export async function resolveModel(modelId: string): Promise<LanguageModelV3> {
  // Guard: block real API calls when ALLOW_REAL_REQUESTS is false
  try {
    const { ALLOW_REAL_REQUESTS } = await import("../test/allow-real-requests.js")
    if (!ALLOW_REAL_REQUESTS) {
      throw new Error(
        `Real LLM requests are blocked (ALLOW_REAL_REQUESTS = false). ` +
        `Use TestModel or FunctionModel from "agent-express/test" instead of "${modelId}".`,
      )
    }
  } catch (err) {
    if ((err as Error).message?.includes("ALLOW_REAL_REQUESTS")) throw err
    // Module not available — allow (test module may not be loaded)
  }

  const slashIndex = modelId.indexOf("/")
  if (slashIndex === -1) {
    throw new Error(
      `Invalid model identifier: "${modelId}". Expected "provider/model-name" format (e.g., "anthropic/claude-sonnet-4-6").`,
    )
  }

  const provider = modelId.slice(0, slashIndex)
  const modelName = modelId.slice(slashIndex + 1)

  try {
    if (provider === "anthropic") {
      const mod = await import("@ai-sdk/anthropic")
      return mod.anthropic(modelName) as unknown as LanguageModelV3
    } else if (provider === "openai") {
      const mod = await import("@ai-sdk/openai")
      return mod.openai(modelName) as unknown as LanguageModelV3
    } else {
      throw new Error(
        `Unknown model provider: "${provider}". Supported: anthropic, openai. Or pass a LanguageModelV3 object directly.`,
      )
    }
  } catch (err) {
    if ((err as { code?: string }).code === "ERR_MODULE_NOT_FOUND") {
      throw new Error(
        `Provider package @ai-sdk/${provider} is not installed. Run: npm install @ai-sdk/${provider}`,
      )
    }
    throw err
  }
}
