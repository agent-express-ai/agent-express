import type { LanguageModelV3 } from "@ai-sdk/provider"

/**
 * Resolves a model identifier string to a `LanguageModelV3` instance.
 *
 * Dynamically imports the corresponding `@ai-sdk/{provider}` package for any
 * provider. Provider packages are optional peer dependencies — users install
 * only what they need.
 *
 * @param modelId - Model string like `"anthropic/claude-sonnet-4-6"`, `"google/gemini-2.0-flash"`, or `"openai/gpt-4o"`
 * @returns Resolved LanguageModelV3 instance
 * @throws Error if format is invalid, provider package is not installed, or provider export is incompatible
 *
 * @example
 * ```typescript
 * const model = await resolveModel("google/gemini-2.0-flash")
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

  // Validate provider name — prevent path traversal and arbitrary package loading
  if (!/^[a-z][a-z0-9-]*$/.test(provider)) {
    throw new Error(
      `Invalid provider name: "${provider}". Provider must be a lowercase package name (letters, digits, hyphens).`,
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mod: any
  try {
    mod = await import(`@ai-sdk/${provider}`)
  } catch (err) {
    const code = (err as { code?: string }).code
    const msg = (err as Error).message ?? ""
    if (code === "ERR_MODULE_NOT_FOUND" ||
        code === "MODULE_NOT_FOUND" ||
        msg.includes("Failed to load url") ||
        msg.includes("Cannot find module")) {
      throw new Error(
        `Provider package @ai-sdk/${provider} is not installed. Run: npm install @ai-sdk/${provider}`,
      )
    }
    throw err
  }

  // AI SDK providers export a factory function — try default export,
  // then named export matching the provider name (without hyphens).
  const providerKey = provider.replace(/-/g, "")
  const createModel = mod.default ?? mod[provider] ?? mod[providerKey]

  if (typeof createModel !== "function") {
    throw new Error(
      `Provider package @ai-sdk/${provider} does not export a model factory function. ` +
      `Pass a LanguageModelV3 object directly instead of a string.`,
    )
  }

  return createModel(modelName) as unknown as LanguageModelV3
}
