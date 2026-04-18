/**
 * @agent-express/embed-openai
 *
 * OpenAI embedding adapter for agent-express search middleware.
 * Provides an `embed` function for use with search.file() retriever adapters.
 *
 * @module embed-openai
 */

/**
 * Configuration for the OpenAI embedding adapter.
 */
export interface OpenAIEmbedConfig {
  /** OpenAI API key. Default: process.env.OPENAI_API_KEY. */
  apiKey?: string
  /** Embedding model. Default: "text-embedding-3-small". */
  model?: string
}

/**
 * Creates an OpenAI embedding function.
 *
 * @param config - API key and model options
 * @returns Embed function: `(text: string) => Promise<number[]>`
 *
 * @example
 * ```typescript
 * import { openaiEmbed } from "@agent-express/embed-openai"
 *
 * const embed = openaiEmbed()
 * const vector = await embed("Hello world")
 * ```
 */
export function openaiEmbed(config?: OpenAIEmbedConfig): (text: string) => Promise<number[]> {
  const apiKey = config?.apiKey ?? process.env["OPENAI_API_KEY"]
  const model = config?.model ?? "text-embedding-3-small"

  if (!apiKey) {
    throw new Error(
      "OpenAI API key required. Set OPENAI_API_KEY environment variable or pass apiKey option.",
    )
  }

  return async (text: string): Promise<number[]> => {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: text,
        model,
      }),
    })

    if (!response.ok) {
      throw new Error(`OpenAI embedding failed: ${response.status} ${response.statusText}`)
    }

    const data = await response.json() as { data: Array<{ embedding: number[] }> }
    return data.data[0]!.embedding
  }
}
